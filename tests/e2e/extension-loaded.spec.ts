import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { DEFAULT_STATE } from '../../src/domain/types';

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, '../../dist');
const artifacts = resolve(here, '../../artifacts');

test('loads the built extension in an isolated Chromium profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-extension-smoke-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionInfo = await worker.evaluate(() => {
      const manifest = chrome.runtime.getManifest();
      return {
        id: chrome.runtime.id,
        version: manifest.version,
        newTab: manifest.chrome_url_overrides?.newtab,
        serviceWorker: manifest.background?.service_worker,
      };
    });
    expect(extensionInfo).toMatchObject({ version: '1.0.0', newTab: 'index.html', serviceWorker: 'background.js' });

    await expect.poll(async () => worker.evaluate(async () => Boolean(await chrome.alarms.get('quote-refresh')))).toBe(true);
    const alarm = await worker.evaluate(async () => chrome.alarms.get('quote-refresh'));
    expect(alarm?.periodInMinutes).toBe(0.5);

    await worker.evaluate(() => {
      const workerGlobal = globalThis as typeof globalThis & { __providerFetchCount: number };
      workerGlobal.__providerFetchCount = 0;
      const globals = workerGlobal as typeof workerGlobal & { __providerFetchMode: string; __providerFetchUrls: string[]; __sameTimestampMicros: number };
      globals.__providerFetchMode = 'count';
      globals.__providerFetchUrls = [];
      const realFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const requestGlobals = globalThis as typeof workerGlobal & { __providerFetchMode: string; __providerFetchUrls: string[]; __sameTimestampMicros: number };
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        requestGlobals.__providerFetchCount += 1;
        requestGlobals.__providerFetchUrls.push(url);
        if (requestGlobals.__providerFetchMode === 'fugle-equal') {
          return Promise.resolve(new Response(JSON.stringify({ lastTrade: { price: 101, time: requestGlobals.__sameTimestampMicros }, previousClose: 99 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if ((requestGlobals.__providerFetchMode === 'symbol-name' || requestGlobals.__providerFetchMode === 'budget-race') && url.includes('api.fugle.tw') && url.includes('/ticker/')) {
          const symbol = url.split('/').pop() ?? '';
          return Promise.resolve(new Response(JSON.stringify({ symbol, name: symbol === '2330' ? '台積電' : '鴻海' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (requestGlobals.__providerFetchMode === 'budget-race' && url.includes('api.fugle.tw') && url.includes('/quote/')) {
          return Promise.resolve(new Response(JSON.stringify({ lastTrade: { price: 101, time: Date.now() * 1000 }, previousClose: 99 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (requestGlobals.__providerFetchMode === 'symbol-name' && url.includes('finnhub.io')) {
          return Promise.resolve(new Response(JSON.stringify({ count: 1, result: [{ symbol: 'AAPL', displaySymbol: 'AAPL', description: 'Apple Inc.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (requestGlobals.__providerFetchMode === 'rate-limited' && url.includes('api.fugle.tw')) {
          return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '60' } }));
        }
        if (requestGlobals.__providerFetchMode === 'rate-limited' && url.includes('finnhub.io')) {
          return Promise.resolve(new Response(JSON.stringify({ c: 51, pc: 50, t: Math.floor(Date.now() / 1000) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return realFetch(input, init);
      }) as typeof fetch;
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${extensionInfo.id}/index.html`);
    await expect(page.getByRole('heading', { name: '讓時間，留給 真正重要的事。' })).toBeVisible();

    const mutation = await page.evaluate(() => chrome.runtime.sendMessage({
      type: 'STATE_MUTATE',
      operation: {
        type: 'add-stock',
        stock: {
          id: 'extension-smoke-2330', market: 'TW', symbol: '2330', name: 'Smoke 2330', order: 0,
          groupId: 'group-tw', gainDisplay: 'percent', alert: {}, alertLatches: { above: false, below: false },
          quoteStatus: 'not-connected',
        },
      },
    }));
    expect(mutation.state.stocks).toContainEqual(expect.objectContaining({ id: 'extension-smoke-2330', symbol: '2330' }));

    const persisted = await page.evaluate(async () => chrome.storage.local.get('stockDesktopState.v1'));
    expect(persisted['stockDesktopState.v1'].stocks).toContainEqual(expect.objectContaining({ id: 'extension-smoke-2330' }));

    const refresh = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    expect(refresh).toEqual({ refreshed: 0, skipped: 0 });
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __providerFetchCount: number }).__providerFetchCount)).toBe(0);

    const notification = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' }));
    expect(notification).toEqual({ error: '請先開啟瀏覽器通知權限' });

    const lookupState = {
      ...structuredClone(DEFAULT_STATE),
      settings: { ...DEFAULT_STATE.settings, fugleKey: 'fake-fugle-key', finnhubKey: 'fake-finnhub-key', notificationsEnabled: true, notificationPermission: 'granted' as const },
    };
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), lookupState);
    await worker.evaluate(() => {
      const globals = globalThis as typeof globalThis & { __providerFetchCount: number; __providerFetchMode: string; __providerFetchUrls: string[] };
      globals.__providerFetchCount = 0;
      globals.__providerFetchUrls = [];
      globals.__providerFetchMode = 'symbol-name';
    });
    await page.getByRole('button', { name: '新增股票' }).click();
    const newStockDialog = page.getByRole('dialog', { name: '新增股票' });
    await newStockDialog.getByLabel('股票代號').fill('2330');
    const nameSuffix = newStockDialog.locator('.symbol-name-suffix');
    await expect(nameSuffix).toHaveText('台積電');
    await expect(nameSuffix).toHaveAttribute('title', '台積電');
    await expect(newStockDialog.getByLabel('股票代號')).toHaveValue('2330');
    await expect(newStockDialog.getByText(/公司名稱：/)).toHaveCount(0);
    await page.evaluate(() => {
      const badge = document.createElement('div');
      badge.textContent = '測試假 API 回應 · 非即時行情';
      badge.setAttribute('data-test-fixture-label', 'true');
      badge.style.cssText = 'position:fixed;z-index:1000;left:18px;bottom:18px;padding:8px 12px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#182b24;color:white;font:12px sans-serif;';
      document.body.append(badge);
    });
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: resolve(artifacts, 'stock-name-in-input.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 375, height: 812 });
    const narrowField = await newStockDialog.locator('.symbol-input-wrap').evaluate((wrapper) => {
      const input = wrapper.querySelector('input')!;
      const suffix = wrapper.querySelector('.symbol-name-suffix')!;
      const inputBox = input.getBoundingClientRect();
      const suffixBox = suffix.getBoundingClientRect();
      return {
        inputValue: input.value,
        inputWidth: inputBox.width,
        inputRight: inputBox.right,
        inputFontSize: getComputedStyle(input).fontSize,
        suffixLeft: suffixBox.left,
        suffixFontSize: getComputedStyle(suffix).fontSize,
        suffixOverflow: getComputedStyle(suffix).overflow,
        suffixTextOverflow: getComputedStyle(suffix).textOverflow,
        suffixWhiteSpace: getComputedStyle(suffix).whiteSpace,
        wrapperRight: wrapper.getBoundingClientRect().right,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(narrowField.inputValue).toBe('2330');
    expect(narrowField.inputWidth).toBeGreaterThan(30);
    expect(narrowField.inputRight).toBeLessThanOrEqual(narrowField.suffixLeft);
    expect(narrowField.inputFontSize).toBe('14px');
    expect(narrowField.suffixFontSize).toBe('14px');
    expect(narrowField.suffixOverflow).toBe('hidden');
    expect(narrowField.suffixTextOverflow).toBe('ellipsis');
    expect(narrowField.suffixWhiteSpace).toBe('nowrap');
    expect(narrowField.wrapperRight).toBeLessThanOrEqual(375);
    expect(narrowField.horizontalOverflow).toBe(false);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __providerFetchUrls: string[] }).__providerFetchUrls)).toEqual([
      'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/2330',
    ]);
    await newStockDialog.getByRole('button', { name: '加入追蹤' }).click();
    await expect(page.getByRole('article', { name: /台積電.*2330/ })).toBeVisible();
    const savedLookupStock = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1'].stocks[0]);
    expect(savedLookupStock).toMatchObject({ symbol: '2330', name: '台積電' });

    await page.getByRole('button', { name: '新增股票' }).click();
    const cachedNameDialog = page.getByRole('dialog', { name: '新增股票' });
    await cachedNameDialog.getByLabel('股票代號').fill('2330');
    await expect(cachedNameDialog.getByText('台積電')).toBeVisible();
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __providerFetchUrls: string[] }).__providerFetchUrls)).toHaveLength(1);
    await cachedNameDialog.getByRole('button', { name: '取消' }).click();
    const lookupNotifications = await page.evaluate(() => chrome.notifications.getAll());
    expect(lookupNotifications).toEqual({});

    await worker.evaluate(() => {
      const globals = globalThis as typeof globalThis & { __providerFetchCount: number; __providerFetchMode: string; __providerFetchUrls: string[] };
      globals.__providerFetchCount = 0;
      globals.__providerFetchUrls = [];
      globals.__providerFetchMode = 'symbol-name';
    });
    await page.getByRole('button', { name: '新增股票' }).click();
    const usLookupDialog = page.getByRole('dialog', { name: '新增股票' });
    await usLookupDialog.getByLabel('市場').selectOption('US');
    await usLookupDialog.getByLabel('股票代號').fill('AAPL');
    await expect(usLookupDialog.getByText('Apple Inc.')).toBeVisible();
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { __providerFetchUrls: string[] }).__providerFetchUrls)).toEqual([
      'https://finnhub.io/api/v1/search?q=AAPL&token=fake-finnhub-key',
    ]);
    await usLookupDialog.getByRole('button', { name: '取消' }).click();
    expect(await page.evaluate(() => chrome.notifications.getAll())).toEqual({});

    const budgetRaceState = {
      ...structuredClone(DEFAULT_STATE),
      settings: { ...DEFAULT_STATE.settings, fugleKey: 'fake-fugle-key' },
      stocks: [{
        id: 'budget-race-2331', market: 'TW' as const, symbol: '2331', name: '鴻海', order: 0, groupId: 'group-tw',
        gainDisplay: 'percent' as const, alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected' as const,
      }],
    };
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), budgetRaceState);
    await page.evaluate(async () => {
      const now = Date.now();
      await chrome.storage.local.set({ 'stockDesktopScheduler.v1': {
        version: 1,
        providers: {
          TW: { recentRequests: Array(49).fill(now), cooldownUntil: 0, cursor: 0 },
          US: { recentRequests: [], cooldownUntil: 0, cursor: 0 },
        },
      } });
    });
    await worker.evaluate(() => {
      const globals = globalThis as typeof globalThis & { __providerFetchCount: number; __providerFetchMode: string; __providerFetchUrls: string[] };
      globals.__providerFetchCount = 0;
      globals.__providerFetchUrls = [];
      globals.__providerFetchMode = 'budget-race';
    });
    const [budgetRefresh, budgetLookup] = await page.evaluate(() => Promise.all([
      chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }),
      chrome.runtime.sendMessage({ type: 'LOOKUP_SYMBOL_NAME', market: 'TW', symbol: '2317' }),
    ]));
    const budgetUrls = await worker.evaluate(() => (globalThis as typeof globalThis & { __providerFetchUrls: string[] }).__providerFetchUrls);
    const schedulerAfterRace = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopScheduler.v1'))['stockDesktopScheduler.v1']);
    expect(budgetUrls).toHaveLength(1);
    expect(schedulerAfterRace.providers.TW.recentRequests).toHaveLength(50);
    const quoteUsedLastSlot = budgetRefresh.refreshed === 1 && budgetLookup.error;
    const lookupUsedLastSlot = budgetLookup.name === '鴻海' && budgetRefresh.skipped === 1;
    expect(Boolean(quoteUsedLastSlot) || Boolean(lookupUsedLastSlot)).toBe(true);
    expect(await page.evaluate(() => chrome.notifications.getAll())).toEqual({});
    await page.evaluate(async () => chrome.storage.local.set({ 'stockDesktopScheduler.v1': {
      version: 1,
      providers: {
        TW: { recentRequests: [], cooldownUntil: 0, cursor: 0 },
        US: { recentRequests: [], cooldownUntil: 0, cursor: 0 },
      },
    } }));

    const expiredTimestamp = Date.now() - 130_000;
    const pendingState = {
      ...structuredClone(DEFAULT_STATE),
      settings: { ...DEFAULT_STATE.settings, notificationsEnabled: true, notificationPermission: 'granted' as const },
      stocks: [{
        id: 'extension-pending-2330', market: 'TW' as const, symbol: '2330', name: 'Smoke 2330', order: 0,
        groupId: 'group-tw', gainDisplay: 'percent' as const, alert: { above: 90 }, alertLatches: { above: true, below: false },
        quoteStatus: 'live' as const,
        quote: { price: 100, previousClose: 99, dayChange: 1, dayChangePercent: 1, timestamp: expiredTimestamp, status: 'live' as const, source: 'Fugle' as const },
        pendingNotification: { rule: 'above' as const, threshold: 90, price: 100, quoteTimestamp: expiredTimestamp },
      }],
    };
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), pendingState);
    await expect(page.getByText('通知待送出')).toBeVisible();
    await page.getByRole('button', { name: '重試' }).click();
    await expect(page.getByText('到價條件已改變或報價已過期，通知未送出。')).toBeVisible();
    const expiredPendingState = await page.evaluate(async () => chrome.storage.local.get('stockDesktopState.v1'));
    expect(expiredPendingState['stockDesktopState.v1'].stocks[0]).toMatchObject({ quote: { price: 100, timestamp: expiredTimestamp } });
    expect(expiredPendingState['stockDesktopState.v1'].stocks[0].pendingNotification).toBeUndefined();

    const timestamp = Date.now() - 130_000;
    const staleQuoteState = {
      ...structuredClone(DEFAULT_STATE),
      settings: { ...DEFAULT_STATE.settings, fugleKey: 'fake-fugle-key' },
      stocks: [{
        id: 'extension-smoke-2330', market: 'TW', symbol: '2330', name: 'Smoke 2330', order: 0,
        groupId: 'group-tw', gainDisplay: 'percent', alert: { above: 90 }, alertLatches: { above: true, below: false },
        quoteStatus: 'closed', quote: { price: 100, previousClose: 99, dayChange: 1, dayChangePercent: 1, timestamp, status: 'live', source: 'Fugle' },
      }],
    };
    await page.evaluate((state) => chrome.runtime.sendMessage({
      type: 'STATE_MUTATE',
      operation: { type: 'replace', state },
    }), staleQuoteState);
    await worker.evaluate((quoteTimestamp) => {
      const globals = globalThis as typeof globalThis & { __providerFetchCount: number; __providerFetchMode: string; __sameTimestampMicros: number };
      globals.__providerFetchCount = 0;
      globals.__providerFetchMode = 'fugle-equal';
      globals.__sameTimestampMicros = quoteTimestamp * 1000;
    }, timestamp);
    const sameTimestampRefresh = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    expect(sameTimestampRefresh.refreshed).toBe(1);
    const sameTimestampState = await page.evaluate(async () => chrome.storage.local.get('stockDesktopState.v1'));
    expect(sameTimestampState['stockDesktopState.v1'].stocks[0]).toMatchObject({
      quoteStatus: 'stale', quote: { price: 100, timestamp }, alertLatches: { above: true, below: false },
    });

    const rateLimitState = {
      ...structuredClone(DEFAULT_STATE),
      settings: { ...DEFAULT_STATE.settings, fugleKey: 'fake-fugle-key', finnhubKey: 'fake-finnhub-key' },
      stocks: [
        ...Array.from({ length: 26 }, (_, index) => ({
          id: `tw-${index}`, market: 'TW' as const, symbol: String(3000 + index), name: `台股${index}`, order: index,
          groupId: 'group-tw', gainDisplay: 'percent' as const, alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected' as const,
        })),
        { id: 'us-aapl', market: 'US' as const, symbol: 'AAPL', name: 'Apple', order: 0, groupId: 'group-us', gainDisplay: 'percent' as const, alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected' as const },
      ],
    };
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), rateLimitState);
    await worker.evaluate(() => {
      const globals = globalThis as typeof globalThis & { __providerFetchCount: number; __providerFetchMode: string; __providerFetchUrls: string[] };
      globals.__providerFetchCount = 0;
      globals.__providerFetchUrls = [];
      globals.__providerFetchMode = 'rate-limited';
    });
    const rateLimitedRefresh = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES' }));
    const requestUrls = await worker.evaluate(() => (globalThis as typeof globalThis & { __providerFetchUrls: string[] }).__providerFetchUrls);
    expect(requestUrls.filter((url) => url.includes('api.fugle.tw'))).toHaveLength(4);
    expect(requestUrls.filter((url) => url.includes('finnhub.io'))).toHaveLength(1);
    expect(rateLimitedRefresh.refreshed).toBe(1);
    const usStock = await page.evaluate(async () => (await chrome.storage.local.get('stockDesktopState.v1'))['stockDesktopState.v1'].stocks.find((stock: { id: string }) => stock.id === 'us-aapl'));
    expect(usStock).toMatchObject({ quoteStatus: 'live', quote: { price: 51, source: 'Finnhub' } });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
