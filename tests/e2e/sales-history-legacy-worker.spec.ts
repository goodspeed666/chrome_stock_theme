import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { DEFAULT_STATE, type AppState } from '../../src/domain/types';

const builtExtension = resolve(process.cwd(), 'dist');
const STATE_KEY = 'stockDesktopState.v1';
const WORKER_ERROR = '擴充功能背景服務版本過舊或沒有回應，請重新載入擴充功能後再試。';

// This fixture intentionally models the pre-sales-history worker: it has no
// capability response, and an unknown STATE_MUTATE operation falls through to
// undefined before the old normalization path writes its default state.
const legacyWorker = `
const STATE_KEY = ${JSON.stringify(STATE_KEY)};
let legacyDefaultState;
let observedMessages = [];

function normalizeLegacyState(value) {
  return value && typeof value === 'object' && value.version === 1
    ? value
    : structuredClone(legacyDefaultState);
}

function applyLegacyOperation(previous, operation) {
  switch (operation?.type) {
    case 'replace': return operation.state;
    // This worker predates sales history and has no sell-stock case.
    default: return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LEGACY_TEST_SEED') {
    legacyDefaultState = structuredClone(message.defaultState);
    observedMessages = [];
    void chrome.storage.local.set({ [STATE_KEY]: structuredClone(message.state) }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'LEGACY_TEST_READ') {
    void chrome.storage.local.get(STATE_KEY).then((saved) => sendResponse({ state: saved[STATE_KEY], messages: observedMessages }));
    return true;
  }
  if (message?.type === 'STATE_CAPABILITIES') {
    observedMessages.push({ type: message.type });
    // The old listener does not recognize this message or reply to it.
    return false;
  }
  if (message?.type === 'STATE_MUTATE') {
    observedMessages.push({ type: message.type, operation: message.operation?.type });
    void chrome.storage.local.get(STATE_KEY).then(async (saved) => {
      const next = normalizeLegacyState(applyLegacyOperation(saved[STATE_KEY] ?? legacyDefaultState, message.operation));
      await chrome.storage.local.set({ [STATE_KEY]: next });
      sendResponse({ state: next });
    });
    return true;
  }
  return false;
});
`;

function seededState(): AppState {
  const stock: AppState['stocks'][number] = {
    id: 'active-stock-before-sale',
    market: 'TW',
    symbol: '2330',
    name: '台積電',
    order: 0,
    groupId: 'group-tw',
    averageCost: 500,
    shares: 2,
    gainDisplay: 'percent',
    alert: {},
    alertLatches: { above: false, below: false },
    quoteStatus: 'not-connected',
  };

  return {
    ...structuredClone(DEFAULT_STATE),
    stocks: [stock],
    salesHistory: [{
      id: 'expired-sale-before-upgrade',
      stock: { ...stock, id: 'previously-sold-stock', order: 0 },
      originalGroupName: '台股',
      salePrice: 600,
      saleDate: '2024-01-02',
    }],
    settings: {
      ...structuredClone(DEFAULT_STATE.settings),
      appearanceTheme: 'sky',
      quoteRefreshSeconds: 120,
    },
  };
}

test('a new UI preserves state and refuses sale writes against a legacy worker', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'chrome-stock-legacy-worker-'));
  const extension = join(temporaryRoot, 'extension');
  const profile = join(temporaryRoot, 'profile');
  let context: BrowserContext | undefined;

  try {
    await cp(builtExtension, extension, { recursive: true });
    const manifestPath = join(extension, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      background: { service_worker: string; type?: string };
    };
    manifest.background.service_worker = 'legacy-worker.js';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(extension, manifest.background.service_worker), legacyWorker);

    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = await worker.evaluate(() => chrome.runtime.id);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/index.html`);
    await expect(page.getByRole('button', { name: '設定' })).toBeVisible();

    const initial = seededState();
    const seeded = await page.evaluate(async ({ state, defaultState }) => chrome.runtime.sendMessage({
      type: 'LEGACY_TEST_SEED', state, defaultState,
    }), { state: initial, defaultState: structuredClone(DEFAULT_STATE) });
    expect(seeded?.ok).toBe(true);

    await page.reload();
    const portfolio = page.getByRole('region', { name: '台股分區' });
    const card = portfolio.getByRole('article', { name: '台積電，台股 2330' });
    await expect(card).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sky');

    const afterLoad = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'LEGACY_TEST_READ' })) as {
      state: AppState;
      messages: { type: string; operation?: string }[];
    };
    expect(afterLoad.state.stocks).toEqual(initial.stocks);
    expect(afterLoad.state.settings).toEqual(initial.settings);
    expect(afterLoad.state.salesHistory).toEqual(initial.salesHistory);
    expect(afterLoad.messages.filter((message) => message.type === 'STATE_MUTATE')).toEqual([]);

    await card.getByRole('button', { name: '台積電的操作選單' }).click();
    await page.getByRole('button', { name: '已賣出' }).click();
    const saleDialog = page.getByRole('dialog', { name: '標記為已賣出' });
    await saleDialog.getByLabel(/每股賣出價格/).fill('624.875');
    await saleDialog.getByRole('button', { name: '確認已賣出' }).click();

    await expect(page.getByRole('status').filter({ hasText: WORKER_ERROR })).toBeVisible();
    const afterSale = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'LEGACY_TEST_READ' })) as {
      state: AppState;
      messages: { type: string; operation?: string }[];
    };
    expect(afterSale.state.stocks).toEqual(initial.stocks);
    expect(afterSale.state.settings).toEqual(initial.settings);
    expect(afterSale.state.salesHistory).toEqual(initial.salesHistory);
    expect(afterSale.messages.some((message) => message.type === 'STATE_CAPABILITIES')).toBe(true);
    expect(afterSale.messages.filter((message) => message.type === 'STATE_MUTATE')).toEqual([]);
  } finally {
    if (context) await context.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
