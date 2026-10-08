import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { DEFAULT_STATE, type AppState } from '../../src/domain/types';
import { taipeiDate } from '../../src/domain/salesHistory';

const extension = resolve(process.cwd(), 'dist');
const STATE_KEY = 'stockDesktopState.v1';

function seededState(): AppState {
  const now = Date.now();
  return {
    ...structuredClone(DEFAULT_STATE),
    stocks: [{
      id: 'active-stock-before-sale', market: 'TW', symbol: '2330', name: '台積電', order: 0, groupId: 'group-tw',
      averageCost: 500.125, shares: 2.5, gainDisplay: 'money', alert: { above: 700.75, below: 450.25 },
      alertLatches: { above: true, below: false }, quoteStatus: 'live',
      quote: { price: 612.345, previousClose: 610, dayChange: 2.345, dayChangePercent: 2.345 / 610 * 100, timestamp: now, status: 'live', source: 'Fugle' },
      pendingNotification: { rule: 'above', threshold: 700.75, price: 701, quoteTimestamp: now },
      notificationFailure: 'keep out of history',
      pendingLimitNotification: { market: 'TW', symbol: '2330', direction: 'limit-up', price: 612.345, quoteTimestamp: now, tradeDate: taipeiDate() },
      limitNotificationFailure: 'keep out of history too',
    }],
  };
}

async function launchExtension(profile: string, state: AppState) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = await worker.evaluate(() => chrome.runtime.id);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/index.html`);
  await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
  const seeded = await page.evaluate(async (initial) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: initial } }), state);
  expect(seeded?.state?.stocks?.[0]?.id).toBe('active-stock-before-sale');
  await page.reload();
  await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
  return { context, page };
}

async function closeExtension(context: BrowserContext) {
  await context.close();
}

test('extension storage preserves edited sale history across reload and restores a clean active position', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-sales-history-'));
  let context: BrowserContext | undefined;
  try {
    const initial = seededState();
    const { context: opened, page } = await launchExtension(profile, initial);
    context = opened;
    const today = taipeiDate();
    const portfolio = page.getByRole('region', { name: '台股分區' });
    const card = portfolio.getByRole('article', { name: '台積電，台股 2330' });
    await card.getByRole('button', { name: '台積電的操作選單' }).click();
    await page.getByRole('button', { name: '已賣出' }).click();

    const saleDialog = page.getByRole('dialog', { name: '標記為已賣出' });
    await expect(saleDialog.getByLabel('賣出日期')).toHaveValue(today);
    await saleDialog.getByLabel(/每股賣出價格/).fill('624.875');
    await saleDialog.getByRole('button', { name: '確認已賣出' }).click();
    await expect(portfolio.getByRole('article')).toHaveCount(0);

    let saved = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STATE_KEY) as AppState;
    expect(saved.stocks).toEqual([]);
    expect(saved.salesHistory).toHaveLength(1);
    expect(saved.salesHistory[0]?.stock.id).toBe('active-stock-before-sale');
    expect(saved.salesHistory[0]?.salePrice).toBe(624.875);
    expect(saved.salesHistory[0]?.stock).not.toHaveProperty('quote');
    expect(saved.salesHistory[0]?.stock).not.toHaveProperty('pendingNotification');

    await page.getByRole('button', { name: '歷史記錄' }).click();
    let history = page.getByRole('dialog', { name: '歷史記錄' });
    await expect(history.locator('.sales-history-row')).toHaveCount(1);
    await history.getByRole('button', { name: '編輯賣出資料' }).click();
    const editDialog = page.getByRole('dialog', { name: '編輯賣出資料' });
    await editDialog.getByLabel(/每股賣出價格/).fill('626.125');
    await editDialog.getByLabel('賣出日期').fill(today);
    await editDialog.getByRole('button', { name: '儲存變更' }).click();

    saved = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STATE_KEY) as AppState;
    expect(saved.salesHistory).toHaveLength(1);
    expect(saved.salesHistory[0]?.salePrice).toBe(626.125);
    expect(saved.salesHistory[0]?.saleDate).toBe(today);
    expect(saved.stocks).toEqual([]);

    await page.reload();
    await page.getByRole('button', { name: '歷史記錄' }).click();
    history = page.getByRole('dialog', { name: '歷史記錄' });
    await expect(history.locator('.sales-history-row')).toHaveCount(1);
    await expect(history.locator('.sales-history-row')).toContainText('TWD 626');
    await history.getByRole('button', { name: '還原持倉' }).click();
    await expect(history.locator('.sales-history-row')).toHaveCount(0);

    saved = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STATE_KEY) as AppState;
    expect(saved.salesHistory).toEqual([]);
    expect(saved.stocks).toHaveLength(1);
    const restored = saved.stocks[0]!;
    expect(restored.id).not.toBe('active-stock-before-sale');
    expect(restored).toMatchObject({
      market: 'TW', symbol: '2330', groupId: 'group-tw', averageCost: 500.125, shares: 2.5,
      alert: { above: 700.75, below: 450.25 }, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected',
    });
    expect(restored).not.toHaveProperty('quote');
    expect(restored).not.toHaveProperty('quoteError');
    expect(restored).not.toHaveProperty('pendingNotification');
    expect(restored).not.toHaveProperty('notificationFailure');
    expect(restored).not.toHaveProperty('pendingLimitNotification');
    expect(restored).not.toHaveProperty('limitNotificationFailure');

    await page.reload();
    saved = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STATE_KEY) as AppState;
    expect(saved.salesHistory).toEqual([]);
    expect(saved.stocks[0]?.id).toBe(restored.id);
    expect(saved.stocks[0]).not.toHaveProperty('quote');
    expect(saved.stocks[0]).not.toHaveProperty('pendingNotification');
  } finally {
    if (context) await closeExtension(context);
    await rm(profile, { recursive: true, force: true });
  }
});

test('worker rejects unknown or malformed mutations and skips no-op pruning without local or sync writes', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-worker-guard-'));
  let context: BrowserContext | undefined;
  try {
    const initial = seededState();
    initial.settings.accountSyncEnabled = true;
    const opened = await launchExtension(profile, initial);
    context = opened.context;
    const { page } = opened;

    // Exercise the pre-reconciliation path too: with an uninitialized account-sync
    // metadata record, an invalid operation must fail before reconciliation can write.
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_STATUS' });
      const key = 'stockDesktopAccountSyncMeta.v1';
      const saved = await chrome.storage.local.get(key);
      await chrome.storage.local.set({ [key]: { ...saved[key], initialized: false } });
      await chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_STATUS' });
      const target = window as typeof window & { __storageWrites: string[] };
      target.__storageWrites = [];
      chrome.storage.onChanged.addListener((_changes, areaName) => target.__storageWrites.push(areaName));
    });

    const before = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    const responses = await page.evaluate(async () => {
      const unknown = await chrome.runtime.sendMessage({
        type: 'STATE_MUTATE', operation: { type: 'future-worker-operation' },
      });
      const malformed = await chrome.runtime.sendMessage({
        type: 'STATE_MUTATE', operation: { type: 'update-settings', settings: null },
      });
      const prune = await chrome.runtime.sendMessage({
        type: 'STATE_MUTATE', operation: { type: 'prune-sales-history' },
      });
      return {
        unknownError: unknown?.error,
        unknownHasState: Boolean(unknown?.state),
        malformedError: malformed?.error,
        malformedHasState: Boolean(malformed?.state),
        pruneError: prune?.error,
        pruneHasState: Boolean(prune?.state),
        pruneHistory: prune?.state?.salesHistory,
      };
    });
    const after = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
      writes: (window as typeof window & { __storageWrites: string[] }).__storageWrites,
    }));

    expect(responses.unknownError).toContain('不支援或格式錯誤的狀態操作');
    expect(responses.unknownHasState).toBe(false);
    expect(responses.malformedError).toContain('不支援或格式錯誤的狀態操作');
    expect(responses.malformedHasState).toBe(false);
    expect(responses.pruneError).toBeUndefined();
    expect(responses.pruneHasState).toBe(true);
    expect(responses.pruneHistory).toEqual([]);
    expect(after.local).toEqual(before.local);
    expect(after.sync).toEqual(before.sync);
    expect(after.writes).toEqual([]);
  } finally {
    if (context) await closeExtension(context);
    await rm(profile, { recursive: true, force: true });
  }
});
