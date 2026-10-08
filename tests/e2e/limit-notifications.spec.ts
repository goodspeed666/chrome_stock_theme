import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { DEFAULT_STATE } from '../../src/domain/types';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

async function installWorkerMocks(worker: Worker) {
  await worker.evaluate(() => {
    type TestGlobals = typeof globalThis & {
      __limitMode: string;
      __limitLastTime: number;
      __limitNotificationCalls: Array<{ id: string; title: string; message: string }>;
      __limitDeliveredNotifications: Record<string, { title: string; message: string }>;
      __failLimitNotifications: boolean;
    };
    const testGlobal = globalThis as TestGlobals;
    testGlobal.__limitMode = 'limit-up';
    testGlobal.__limitLastTime = 0;
    testGlobal.__limitNotificationCalls = [];
    testGlobal.__limitDeliveredNotifications = {};
    testGlobal.__failLimitNotifications = true;
    const api = chrome.notifications as typeof chrome.notifications & Record<string, unknown>;
    Object.defineProperty(api, 'getAll', {
      configurable: true,
      value: async () => ({ ...testGlobal.__limitDeliveredNotifications }),
    });
    Object.defineProperty(api, 'create', {
      configurable: true,
      value: async (id: string, options: { title?: string; message?: string }) => {
        const notification = { id, title: options.title ?? '', message: options.message ?? '' };
        testGlobal.__limitNotificationCalls.push(notification);
        if (notification.title.includes('漲停通知') && testGlobal.__failLimitNotifications) throw new Error('mock notification failure');
        testGlobal.__limitDeliveredNotifications[id] = { title: notification.title, message: notification.message };
        return id;
      },
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const current = globalThis as TestGlobals;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('api.fugle.tw/marketdata/v1.0/stock/intraday/quote/')) return realFetch(input, init);
      const mode = current.__limitMode;
      current.__limitLastTime = mode === 'stale' ? Date.now() - 130_000
        : mode === 'out-of-order' ? Date.now() - 30_000
          : Math.max(Date.now(), current.__limitLastTime + 1);
      return Promise.resolve(new Response(JSON.stringify({
        lastTrade: { price: 100, time: current.__limitLastTime * 1000 },
        previousClose: 99,
        isLimitUpPrice: mode === 'limit-up' || mode === 'both',
        isLimitDownPrice: mode === 'limit-down' || mode === 'both',
        isTrial: mode === 'trial',
        tradingHalt: { isHalted: mode === 'halted' },
        isLimitUpHalt: mode === 'limit-up-halt',
        isLimitDownHalt: mode === 'limit-down-halt',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as typeof fetch;
  });
}

async function extensionPage(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('.page-content')).toBeVisible();
  return page;
}

test('delivers only fresh Fugle limit notices once per symbol and Taipei trade day', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-limit-notice-'));
  let context: BrowserContext | undefined;
  try {
    const launch = () => chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context = await launch();
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = await worker.evaluate(() => chrome.runtime.id);
    let page = await extensionPage(context, id);
    await installWorkerMocks(worker);
    await expect.poll(async () => worker.evaluate(async () => Boolean(await chrome.alarms.get('quote-refresh')))).toBe(true);

    const stock = (stockId: string, groupId: string, order: number, alert: Record<string, number> = {}) => ({
      id: stockId, market: 'TW' as const, symbol: '2330', name: '測試台積電', order, groupId,
      gainDisplay: 'percent' as const, alert, alertLatches: { above: false, below: false }, quoteStatus: 'no-trade' as const,
    });
    const state = {
      ...structuredClone(DEFAULT_STATE),
      settings: {
        ...DEFAULT_STATE.settings,
        fugleKey: 'mock-fugle-key',
        notificationsEnabled: true,
        notificationPermission: 'granted' as const,
        limitNotificationsEnabled: true,
        quoteRefreshSeconds: 30 as const,
      },
      stocks: [stock('limit-main', 'group-tw', 0, { above: 90 }), stock('limit-duplicate', 'group-us', 0)],
    };
    await page.evaluate((next) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: next } }), state);

    const alarmChange = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'update-settings', settings: { quoteRefreshSeconds: 120 } } }));
    expect(alarmChange.state.settings.quoteRefreshSeconds).toBe(120);
    await expect.poll(async () => page.evaluate(async () => (await chrome.alarms.get('quote-refresh'))?.periodInMinutes)).toBe(2);

    const firstRefresh = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    expect(firstRefresh.refreshed).toBe(1);
    const firstCalls = await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls);
    expect(firstCalls).toHaveLength(2);
    expect(firstCalls.map((call: { title: string }) => call.title)).toEqual(expect.arrayContaining([expect.stringContaining('到價提醒'), expect.stringContaining('漲停通知')]));

    const failedState = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1']);
    expect(failedState.stocks[0]).toMatchObject({
      pendingLimitNotification: { market: 'TW', symbol: '2330', direction: 'limit-up', price: 100 },
      limitNotificationFailure: '通知傳送失敗，請重試',
    });
    expect(failedState.stocks[0].pendingNotification).toBeUndefined();
    expect(failedState.stocks[1].pendingLimitNotification).toBeUndefined();
    const beforeRetryKeys = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopLimitNotifications.v1'))['stockDesktopLimitNotifications.v1'] ?? {});
    expect(Object.keys(beforeRetryKeys)).toHaveLength(0);

    await page.waitForTimeout(5);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    const afterSameDayTick = await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls.length);
    expect(afterSameDayTick).toBe(2);

    await worker.evaluate(() => { (globalThis as typeof globalThis & { __failLimitNotifications: boolean }).__failLimitNotifications = false; });
    const retryResult = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'RETRY_NOTIFICATION', stockId: 'limit-main', kind: 'limit' }));
    expect(retryResult).toEqual({ ok: true });
    const pendingAfterRetry = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1'].stocks[0]);
    expect(pendingAfterRetry.pendingLimitNotification).toBeUndefined();
    expect(pendingAfterRetry.limitNotificationFailure).toBeUndefined();
    const deliveredKeys = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopLimitNotifications.v1'))['stockDesktopLimitNotifications.v1']);
    expect(Object.keys(deliveredKeys)).toHaveLength(1);
    expect(Object.keys(deliveredKeys)[0]).toMatch(/^TW:2330:\d{4}-\d{2}-\d{2}:limit-up$/);

    await context.close();
    context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    page = await extensionPage(context, id);
    await installWorkerMocks(worker);
    await expect.poll(async () => worker.evaluate(async () => (await chrome.alarms.get('quote-refresh'))?.periodInMinutes)).toBe(2);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'patch-stock', stockId: 'limit-main', patch: { quote: undefined, quoteStatus: 'no-trade' } } }));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'patch-stock', stockId: 'limit-duplicate', patch: { quote: undefined, quoteStatus: 'no-trade' } } }));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls)).toHaveLength(0);

    const invalidInterval = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'update-settings', settings: { quoteRefreshSeconds: 45 } } }));
    expect(invalidInterval.state.settings.quoteRefreshSeconds).toBe(30);
    await expect.poll(async () => page.evaluate(async () => (await chrome.alarms.get('quote-refresh'))?.periodInMinutes)).toBe(0.5);

    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'update-settings', settings: { limitNotificationsEnabled: false } } }));
    const disabled = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1']);
    expect(disabled.stocks.every((item: { pendingLimitNotification?: unknown; limitNotificationFailure?: unknown }) => !item.pendingLimitNotification && !item.limitNotificationFailure)).toBe(true);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('does not send limit notices while global notifications are disabled or quote flags are ambiguous', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-limit-gates-'));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = await worker.evaluate(() => chrome.runtime.id);
    const page = await extensionPage(context, id);
    await installWorkerMocks(worker);
    const state = {
      ...structuredClone(DEFAULT_STATE),
      settings: { ...DEFAULT_STATE.settings, fugleKey: 'mock-fugle-key', notificationsEnabled: false, notificationPermission: 'granted' as const, limitNotificationsEnabled: true },
      stocks: [{
        id: 'limit-gated', market: 'TW' as const, symbol: '2330', name: '測試台積電', order: 0, groupId: 'group-tw',
        gainDisplay: 'percent' as const, alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'no-trade' as const,
      }],
    };
    await page.evaluate((next) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: next } }), state);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls)).toHaveLength(0);

    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'update-settings', settings: { notificationsEnabled: true } } }));
    for (const mode of ['both', 'trial', 'halted', 'limit-up-halt', 'limit-down-halt', 'stale']) {
      await worker.evaluate((nextMode) => { (globalThis as typeof globalThis & { __limitMode: string }).__limitMode = nextMode; }, mode);
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'patch-stock', stockId: 'limit-gated', patch: { quote: undefined, quoteStatus: 'no-trade' } } }));
      await page.waitForTimeout(2);
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    }
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls)).toHaveLength(0);

    await worker.evaluate(() => { (globalThis as typeof globalThis & { __limitMode: string }).__limitMode = 'out-of-order'; });
    const newerTimestamp = Date.now() - 10_000;
    const taipeiDateParts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).formatToParts(newerTimestamp);
    const taipeiDateValues = Object.fromEntries(taipeiDateParts.map((part) => [part.type, part.value]));
    const tradeDate = `${taipeiDateValues.year}-${taipeiDateValues.month}-${taipeiDateValues.day}`;
    const retryState = {
      ...state,
      settings: { ...state.settings, notificationsEnabled: true },
      stocks: [{
        ...state.stocks[0]!,
        quoteStatus: 'live' as const,
        alert: { above: 90 },
        quote: { price: 100, previousClose: 99, dayChange: 1, dayChangePercent: 1, timestamp: newerTimestamp, status: 'live' as const, source: 'Fugle' as const, isLimitUpPrice: true, isLimitDownPrice: false },
      }],
    };
    await page.evaluate((next) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: next } }), retryState);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls)).toHaveLength(0);

    const pendingTimestamp = Date.now() - 1_000;
    const pendingTradeDateParts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).formatToParts(pendingTimestamp);
    const pendingTradeDateValues = Object.fromEntries(pendingTradeDateParts.map((part) => [part.type, part.value]));
    const pendingTradeDate = `${pendingTradeDateValues.year}-${pendingTradeDateValues.month}-${pendingTradeDateValues.day}`;
    const bothPendingState = {
      ...retryState,
      stocks: [{
        ...retryState.stocks[0]!,
        pendingNotification: { rule: 'above' as const, threshold: 90, price: 100, quoteTimestamp: pendingTimestamp },
        notificationFailure: '通知傳送失敗，請重試',
        pendingLimitNotification: { market: 'TW' as const, symbol: '2330', direction: 'limit-up' as const, price: 100, quoteTimestamp: pendingTimestamp, tradeDate: pendingTradeDate },
        limitNotificationFailure: '通知傳送失敗，請重試',
        quote: { ...retryState.stocks[0]!.quote!, timestamp: pendingTimestamp },
      }],
    };
    await page.evaluate((next) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: next } }), bothPendingState);
    await worker.evaluate(() => { (globalThis as typeof globalThis & { __failLimitNotifications: boolean }).__failLimitNotifications = false; });
    const retryBoth = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'RETRY_NOTIFICATION', stockId: 'limit-gated' }));
    expect(retryBoth).toEqual({ ok: true });
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls)).toHaveLength(2);
    const retriedState = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1'].stocks[0]);
    expect(retriedState.pendingNotification).toBeUndefined();
    expect(retriedState.pendingLimitNotification).toBeUndefined();

    const failedTimestamp = Date.now() - 1_000;
    const failedState = {
      ...retryState,
      stocks: [{
        ...retryState.stocks[0]!, id: 'limit-disable-retry', symbol: '0050', alert: {},
        pendingLimitNotification: { market: 'TW' as const, symbol: '0050', direction: 'limit-up' as const, price: 100, quoteTimestamp: failedTimestamp, tradeDate: pendingTradeDate },
        limitNotificationFailure: '通知傳送失敗，請重試',
        quote: { ...retryState.stocks[0]!.quote!, timestamp: failedTimestamp, isLimitUpPrice: true, isLimitDownPrice: false },
      }],
    };
    await page.evaluate((next) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: next } }), failedState);
    await worker.evaluate(() => { (globalThis as typeof globalThis & { __failLimitNotifications: boolean }).__failLimitNotifications = true; });
    const failedRetry = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'RETRY_NOTIFICATION', stockId: 'limit-disable-retry' }));
    expect(failedRetry.error).toContain('通知傳送失敗');
    const callsAfterFailure = await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls.length);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'update-notification-settings', notificationsEnabled: false, notificationPermission: 'granted' } }));
    const disabledPending = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1'].stocks[0]);
    expect(disabledPending.pendingLimitNotification).toBeUndefined();
    expect(disabledPending.limitNotificationFailure).toBeUndefined();
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'update-notification-settings', notificationsEnabled: true, notificationPermission: 'granted' } }));
    const retryAfterEnable = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'RETRY_NOTIFICATION', stockId: 'limit-disable-retry' }));
    expect(retryAfterEnable.error).toContain('沒有待重試的通知');
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __limitNotificationCalls: unknown[] }).__limitNotificationCalls.length)).toBe(callsAfterFailure);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
