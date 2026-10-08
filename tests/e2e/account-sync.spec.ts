import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { DEFAULT_STATE } from '../../src/domain/types';
import { ACCOUNT_SYNC_KEY, ACCOUNT_SYNC_META_KEY, createAccountSyncSnapshot } from '../../src/data/accountSync';

const extension = resolve(process.cwd(), 'dist');
const STATE_KEY = 'stockDesktopState.v1';

async function openExtension() {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-sync-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const id = await worker.evaluate(() => chrome.runtime.id);
  await page.goto(`chrome-extension://${id}/index.html`);
  await expect(page.getByRole('heading', { name: '讓時間，留給 真正重要的事。' })).toBeVisible();
  return { context, profile, worker, page };
}

async function closeExtension(context: BrowserContext, profile: string) {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

function withStock(name: string, id = 'sync-stock-2330') {
  return {
    ...structuredClone(DEFAULT_STATE),
    stocks: [{
      id, market: 'TW' as const, symbol: '2330', name, order: 0, groupId: 'group-tw',
      gainDisplay: 'percent' as const, alert: { above: 100 }, alertLatches: { above: false, below: false },
      quoteStatus: 'not-connected' as const,
    }],
  };
}

test('imports, exports only the allowlist, receives remote changes, and retries a failed write', async () => {
  const { context, profile, worker, page } = await openExtension();
  try {
    const localOnly = structuredClone(DEFAULT_STATE);
    localOnly.settings = { ...localOnly.settings, fugleKey: 'local-secret', notificationsEnabled: true, notificationPermission: 'granted' };
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), localOnly);

    const remoteState = withStock('Remote Name');
    const seededSnapshot = createAccountSyncSnapshot(remoteState, { revision: 7, deviceId: 'seed-device', updatedAt: 10 });
    await page.evaluate(async ({ key, snapshot }) => chrome.storage.sync.set({ [key]: snapshot }), { key: ACCOUNT_SYNC_KEY, snapshot: seededSnapshot });

    const enabled = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_SET_ENABLED', enabled: true }));
    expect(enabled.status).toMatchObject({ enabled: true });
    expect(enabled.state.stocks[0]).toMatchObject({ id: 'sync-stock-2330', name: 'Remote Name' });
    expect(enabled.state.settings).toMatchObject({ fugleKey: 'local-secret', notificationsEnabled: true, notificationPermission: 'granted' });

    const importedMeta = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
    const ownDeviceId = importedMeta[ACCOUNT_SYNC_META_KEY].deviceId;
    expect(ownDeviceId).not.toBe('seed-device');
    expect(importedMeta[ACCOUNT_SYNC_META_KEY].versionDeviceId).toBe('seed-device');

    const retryUnchanged = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_RETRY' }));
    expect(retryUnchanged.status.enabled).toBe(true);
    const unchangedMeta = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
    expect(unchangedMeta[ACCOUNT_SYNC_META_KEY]).toMatchObject({ deviceId: ownDeviceId, versionDeviceId: 'seed-device' });
    expect(unchangedMeta[ACCOUNT_SYNC_META_KEY].lastWrittenAt).toBeUndefined();

    const localUpdate = withStock('Local Name');
    localUpdate.settings = { ...localUpdate.settings, accountSyncEnabled: true, fugleKey: 'local-secret', notificationsEnabled: true, notificationPermission: 'granted' };
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), localUpdate);
    let savedSync = await page.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], ACCOUNT_SYNC_KEY);
    expect(savedSync).toMatchObject({ deviceId: ownDeviceId, revision: 8, stocks: [{ name: 'Local Name' }] });
    expect(JSON.stringify(savedSync)).not.toContain('local-secret');
    expect(savedSync.settings).not.toHaveProperty('notificationsEnabled');
    expect(savedSync.settings).not.toHaveProperty('notificationPermission');
    expect(savedSync.stocks[0]).not.toHaveProperty('quote');
    expect(savedSync.stocks[0]).not.toHaveProperty('alertLatches');

    const patched = await worker.evaluate(() => {
      const area = chrome.storage.sync as unknown as { set: (...args: unknown[]) => Promise<void> };
      const original = area.set.bind(area);
      try {
        Object.defineProperty(globalThis, '__accountSyncOriginalSet', { configurable: true, value: original });
        Object.defineProperty(area, 'set', { configurable: true, writable: true, value: async () => { throw new Error('forced test write failure'); } });
        return true;
      } catch { return false; }
    });
    expect(patched).toBe(true);
    const pendingLocal = structuredClone(localUpdate);
    pendingLocal.stocks[0].name = 'Pending Local';
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), pendingLocal);
    const failedWrite = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
    expect(failedWrite[ACCOUNT_SYNC_META_KEY]).toMatchObject({ pending: true, error: 'write' });
    await worker.evaluate(() => {
      const area = chrome.storage.sync as unknown as { set: (...args: unknown[]) => Promise<void> };
      const original = (globalThis as typeof globalThis & { __accountSyncOriginalSet: (...args: unknown[]) => Promise<void> }).__accountSyncOriginalSet;
      Object.defineProperty(area, 'set', { configurable: true, writable: true, value: original });
    });
    const retryWrite = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_RETRY' }));
    expect(retryWrite.status.phase).toBe('written');
    savedSync = await page.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], ACCOUNT_SYNC_KEY);
    expect(savedSync.stocks).toContainEqual(expect.objectContaining({ name: 'Pending Local' }));

    await worker.evaluate(() => {
      const area = chrome.storage.sync as unknown as { set: (...args: unknown[]) => Promise<void> };
      const original = area.set.bind(area);
      Object.defineProperty(globalThis, '__accountSyncSecondOriginalSet', { configurable: true, value: original });
      Object.defineProperty(area, 'set', { configurable: true, writable: true, value: async () => { throw new Error('forced second write failure'); } });
    });
    const pendingLocalAgain = structuredClone(pendingLocal);
    pendingLocalAgain.stocks[0].name = 'Pending Local 2';
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), pendingLocalAgain);
    const secondFailure = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
    expect(secondFailure[ACCOUNT_SYNC_META_KEY]).toMatchObject({ pending: true, error: 'write' });
    await worker.evaluate(() => {
      const area = chrome.storage.sync as unknown as { set: (...args: unknown[]) => Promise<void> };
      const original = (globalThis as typeof globalThis & { __accountSyncSecondOriginalSet: (...args: unknown[]) => Promise<void> }).__accountSyncSecondOriginalSet;
      Object.defineProperty(area, 'set', { configurable: true, writable: true, value: original });
    });
    const competingRemote = createAccountSyncSnapshot(withStock('Competing Cloud'), { revision: 50, deviceId: 'competing-device', updatedAt: 50_000 });
    await page.evaluate(async ({ key, snapshot }) => chrome.storage.sync.set({ [key]: snapshot }), { key: ACCOUNT_SYNC_KEY, snapshot: competingRemote });
    await expect.poll(async () => {
      const stored = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
      return stored[ACCOUNT_SYNC_META_KEY].conflict?.stocks[0]?.name;
    }).toBe('Competing Cloud');
    const protectedLocal = await page.evaluate((key) => chrome.storage.local.get(key), STATE_KEY);
    expect(protectedLocal[STATE_KEY].stocks[0]?.name).toBe('Pending Local 2');
    const keptLocal = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_RESOLVE', choice: 'local' }));
    expect(keptLocal.status.phase).toBe('written');
    savedSync = await page.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], ACCOUNT_SYNC_KEY);
    expect(savedSync.revision).toBeGreaterThan(50);
    expect(savedSync.stocks).toContainEqual(expect.objectContaining({ name: 'Pending Local 2' }));

    const remoteChange = withStock('Cloud Name');
    remoteChange.settings = { ...remoteChange.settings, accountSyncEnabled: true };
    const remoteSnapshot = createAccountSyncSnapshot(remoteChange, { revision: 70, deviceId: 'other-device', updatedAt: 70_000 });
    await page.evaluate(async ({ key, snapshot }) => chrome.storage.sync.set({ [key]: snapshot }), { key: ACCOUNT_SYNC_KEY, snapshot: remoteSnapshot });
    await expect.poll(async () => {
      const saved = await page.evaluate((key) => chrome.storage.local.get(key), STATE_KEY);
      return saved[STATE_KEY].stocks[0]?.name;
    }).toBe('Cloud Name');
    savedSync = await page.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], ACCOUNT_SYNC_KEY);
    expect(savedSync).toEqual(remoteSnapshot);
    const remoteMeta = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
    expect(remoteMeta[ACCOUNT_SYNC_META_KEY]).toMatchObject({ deviceId: ownDeviceId, versionDeviceId: 'other-device' });

    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_SET_ENABLED', enabled: false }));
    const ignoredRemote = createAccountSyncSnapshot(withStock('Should Not Import'), { revision: 71, deviceId: 'other-device', updatedAt: 71_000 });
    await page.evaluate(async ({ key, snapshot }) => chrome.storage.sync.set({ [key]: snapshot }), { key: ACCOUNT_SYNC_KEY, snapshot: ignoredRemote });
    await page.waitForTimeout(150);
    const disabledState = await page.evaluate((key) => chrome.storage.local.get(key), STATE_KEY);
    expect(disabledState[STATE_KEY].stocks[0]?.name).toBe('Cloud Name');

    await expect(page.evaluate(() => chrome.notifications.getAll())).resolves.toEqual({});
  } finally {
    await closeExtension(context, profile);
  }
});

test('Settings UI toggles sync, refreshes a pending conflict, and allows choosing cloud data', async () => {
  const { context, profile, page } = await openExtension();
  try {
    const local = withStock('Local Portfolio');
    await page.evaluate((state) => chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state } }), local);
    const remote = createAccountSyncSnapshot(withStock('Cloud Portfolio', 'cloud-stock-2317'), { revision: 4, deviceId: 'cloud-device', updatedAt: 4_000 });
    await page.evaluate(async ({ key, snapshot }) => chrome.storage.sync.set({ [key]: snapshot }), { key: ACCOUNT_SYNC_KEY, snapshot: remote });

    await page.getByRole('button', { name: '設定' }).click();
    const syncToggle = page.getByRole('checkbox', { name: 'Chrome 帳號同步' });
    await expect(syncToggle).not.toBeChecked();
    await syncToggle.click();
    await expect(syncToggle).toBeChecked();
    const conflictMessage = '這部裝置和 Chrome 同步空間都有不同資料，請選擇要使用哪一份。';
    await expect(page.getByText(conflictMessage)).toBeVisible();
    await expect(page.getByRole('button', { name: '使用這台電腦的設定' })).toBeVisible();
    await expect(page.getByRole('button', { name: '使用已同步的設定' })).toBeVisible();

    await page.evaluate(() => {
      const badge = document.createElement('div');
      badge.textContent = '隔離測試資料 · 非帳戶雲端';
      badge.style.cssText = 'position:fixed;z-index:1000;left:12px;bottom:12px;padding:6px 9px;border-radius:8px;background:#26382e;color:white;font:12px sans-serif;';
      document.body.append(badge);
    });
    const artifactDir = resolve(process.cwd(), 'artifacts');
    await mkdir(artifactDir, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: resolve(artifactDir, 'account-sync-conflict-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 375, height: 812 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: '使用已同步的設定' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '使用這台電腦的設定' })).toBeInViewport();
    await expect(page.getByRole('button', { name: '使用已同步的設定' })).toBeInViewport();
    await page.screenshot({ path: resolve(artifactDir, 'account-sync-conflict-mobile.png'), fullPage: true, animations: 'disabled' });

    const latestRemote = createAccountSyncSnapshot(withStock('Updated Cloud Portfolio', 'cloud-stock-2317'), { revision: 5, deviceId: 'cloud-device', updatedAt: 5_000 });
    await page.evaluate(async ({ key, snapshot }) => chrome.storage.sync.set({ [key]: snapshot }), { key: ACCOUNT_SYNC_KEY, snapshot: latestRemote });
    await expect.poll(async () => {
      const stored = await page.evaluate((key) => chrome.storage.local.get(key), ACCOUNT_SYNC_META_KEY);
      return stored[ACCOUNT_SYNC_META_KEY].conflict?.stocks[0]?.name;
    }).toBe('Updated Cloud Portfolio');
    await page.getByRole('button', { name: '使用已同步的設定' }).click();
    await expect.poll(async () => {
      const stored = await page.evaluate((key) => chrome.storage.local.get(key), STATE_KEY);
      return stored[STATE_KEY].stocks[0]?.name;
    }).toBe('Updated Cloud Portfolio');
    const cloudState = await page.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], ACCOUNT_SYNC_KEY);
    expect(cloudState.stocks).toContainEqual(expect.objectContaining({ name: 'Updated Cloud Portfolio' }));
  } finally {
    await closeExtension(context, profile);
  }
});
