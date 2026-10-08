import { DEFAULT_STATE, type AppState, type BackgroundSettings, type Market, type Quote, type Stock } from '../domain/types';
import { evaluateAlerts } from '../domain/alerts';
import { isNewerQuote } from '../domain/quoteFreshness';
import { STATE_KEY, applyOperation, normalizeState, type StateOperation } from '../data/storage';
import {
  ACCOUNT_SYNC_KEY,
  ACCOUNT_SYNC_META_KEY,
  accountSyncDataKey,
  compareAccountSyncVersions,
  createAccountSyncSnapshot,
  hasAccountSyncData,
  mergeAccountSyncSnapshot,
  parseAccountSyncSnapshot,
  serializeAccountSyncSnapshot,
  type AccountSyncSnapshot,
} from '../data/accountSync';
import { fetchFinnhubQuote, fetchFinnhubSymbolName } from '../providers/finnhub';
import { fetchFugleQuote, fetchFugleSymbolName } from '../providers/fugle';
import { ProviderError } from '../providers/quotes';
import { SCHEDULER_KEY, applyCooldown, normalizeScheduler, reserveRequest, selectBatch, type SchedulerState, type ScheduledCandidate } from './scheduler';

const ALARM_NAME = 'quote-refresh';
const NAME_CACHE_KEY = 'stockDesktopSymbolNames.v1';
const NAME_CACHE_TTL_MS = 24 * 60 * 60_000;
const NAME_CACHE_MAX_ENTRIES = 300;
const LIMIT_NOTIFICATION_KEY = 'stockDesktopLimitNotifications.v1';
const LIMIT_NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60_000;
type AccountSyncError = 'capacity' | 'write' | 'invalid';
interface AccountSyncMetadata {
  version: 1;
  /** Stable actor identity for this installation. */
  deviceId: string;
  /** Device identity that produced the snapshot currently represented locally. */
  versionDeviceId: string;
  revision: number;
  updatedAt: number;
  pending: boolean;
  initialized: boolean;
  error?: AccountSyncError;
  conflict?: AccountSyncSnapshot;
  lastBuiltInBackground?: BackgroundSettings;
  lastWrittenAt?: number;
}
type Candidate = ScheduledCandidate;
type SymbolNameCache = Record<string, { name: string; cachedAt: number }>;
type ThresholdNotification = NonNullable<Stock['pendingNotification']>;
type LimitNotification = NonNullable<Stock['pendingLimitNotification']>;
type NotificationJob = { stockId: string; kind: 'threshold'; event: ThresholdNotification } | { stockId: string; kind: 'limit'; event: LimitNotification };
type LimitNotificationRecord = Record<string, number>;

let stateQueue: Promise<void> = Promise.resolve();
let refreshPromise: Promise<{ refreshed: number; skipped: number }> | null = null;
const nameLookupPromises = new Map<string, Promise<string>>();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const task = stateQueue.then(work);
  stateQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function loadState(): Promise<AppState> {
  const saved = await chrome.storage.local.get(STATE_KEY);
  return normalizeState(saved[STATE_KEY]);
}

async function readScheduler(): Promise<SchedulerState> {
  const stored = await chrome.storage.local.get(SCHEDULER_KEY);
  return normalizeScheduler(stored[SCHEDULER_KEY]);
}

function saveScheduler(scheduler: SchedulerState) {
  return chrome.storage.local.set({ [SCHEDULER_KEY]: scheduler });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBuiltInBackground(value: unknown): value is BackgroundSettings {
  return isRecord(value) && typeof value.selectedId === 'string' && /^scene-(?:0[1-9]|10)$/.test(value.selectedId)
    && typeof value.brightness === 'number' && Number.isFinite(value.brightness) && value.brightness >= 0 && value.brightness <= 1;
}

function newAccountSyncMetadata(): AccountSyncMetadata {
  const deviceId = crypto.randomUUID();
  return { version: 1, deviceId, versionDeviceId: deviceId, revision: 0, updatedAt: 0, pending: false, initialized: false };
}

function normalizeAccountSyncMetadata(value: unknown): AccountSyncMetadata {
  if (!isRecord(value) || value.version !== 1 || typeof value.deviceId !== 'string' || !value.deviceId.trim() || value.deviceId.length > 128
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return newAccountSyncMetadata();
  const conflict = value.conflict === undefined ? undefined : parseAccountSyncSnapshot(value.conflict) ?? undefined;
  const error: AccountSyncError | undefined = value.error === 'capacity' || value.error === 'write' || value.error === 'invalid' ? value.error : undefined;
  return {
    version: 1,
    deviceId: value.deviceId,
    versionDeviceId: typeof value.versionDeviceId === 'string' && value.versionDeviceId.trim() && value.versionDeviceId.length <= 128 ? value.versionDeviceId : value.deviceId,
    revision: Number(value.revision),
    updatedAt: value.updatedAt,
    pending: value.pending === true,
    initialized: value.initialized === true,
    ...(error ? { error } : {}),
    ...(conflict ? { conflict } : {}),
    ...(isBuiltInBackground(value.lastBuiltInBackground) ? { lastBuiltInBackground: value.lastBuiltInBackground } : {}),
    ...(typeof value.lastWrittenAt === 'number' && Number.isFinite(value.lastWrittenAt) ? { lastWrittenAt: value.lastWrittenAt } : {}),
  };
}

async function readAccountSyncMetadata(): Promise<AccountSyncMetadata> {
  const saved = await chrome.storage.local.get(ACCOUNT_SYNC_META_KEY);
  return saved[ACCOUNT_SYNC_META_KEY] ? normalizeAccountSyncMetadata(saved[ACCOUNT_SYNC_META_KEY]) : newAccountSyncMetadata();
}

function accountSyncStatus(state: AppState, metadata: AccountSyncMetadata) {
  const enabled = state.settings.accountSyncEnabled;
  if (!enabled) return { enabled, phase: 'disabled', message: '已關閉同步；這部裝置與 Chrome 同步空間的資料都會保留。' };
  if (metadata.conflict) return { enabled, phase: 'conflict', message: '這部裝置和 Chrome 同步空間都有不同資料，請選擇要使用哪一份。' };
  if (metadata.error === 'capacity') return { enabled, phase: 'error', message: '同步內容超過安全容量；本機資料已保留，請刪除部分股票或縮短名稱後重試。' };
  if (metadata.error === 'invalid') return { enabled, phase: 'error', message: 'Chrome 同步空間內的資料格式無法讀取；本機資料已保留。' };
  if (metadata.error === 'write') return { enabled, phase: 'error', message: '無法寫入 Chrome 同步空間；本機資料已保留，稍後可重試。' };
  if (metadata.pending) return { enabled, phase: 'pending', message: '正在等待寫入 Chrome 同步空間。' };
  if (metadata.lastWrittenAt) return { enabled, phase: 'written', message: '已寫入 Chrome 同步空間；其他裝置何時收到由 Chrome 帳戶同步服務處理。' };
  return { enabled, phase: 'ready', message: '同步已開啟；下次變更投資組合時會寫入 Chrome 同步空間。' };
}

function accountSyncSnapshotFor(state: AppState, metadata: AccountSyncMetadata) {
  return createAccountSyncSnapshot(state, metadata, metadata.lastBuiltInBackground);
}

async function writeAccountSyncSnapshot(state: AppState, metadata: AccountSyncMetadata) {
  metadata.versionDeviceId = metadata.deviceId;
  metadata.pending = true;
  metadata.error = undefined;
  await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
  try {
    const snapshot = accountSyncSnapshotFor(state, metadata);
    const serialized = serializeAccountSyncSnapshot(snapshot);
    await chrome.storage.sync.set({ [ACCOUNT_SYNC_KEY]: JSON.parse(serialized) as AccountSyncSnapshot });
    metadata.pending = false;
    metadata.initialized = true;
    metadata.error = undefined;
    metadata.conflict = undefined;
    metadata.lastWrittenAt = Date.now();
    metadata.lastBuiltInBackground = snapshot.background;
  } catch (error) {
    metadata.pending = true;
    metadata.error = error instanceof Error && error.message.includes('容量限制') ? 'capacity' : 'write';
  }
  await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
}

async function applyRemoteAccountSnapshot(state: AppState, metadata: AccountSyncMetadata, snapshot: AccountSyncSnapshot) {
  const merged = mergeAccountSyncSnapshot(state, snapshot);
  metadata.versionDeviceId = snapshot.deviceId;
  metadata.revision = snapshot.revision;
  metadata.updatedAt = snapshot.updatedAt;
  metadata.pending = false;
  metadata.initialized = true;
  metadata.error = undefined;
  metadata.conflict = undefined;
  metadata.lastBuiltInBackground = snapshot.background;
  await chrome.storage.local.set({ [STATE_KEY]: merged, [ACCOUNT_SYNC_META_KEY]: metadata });
  return merged;
}

async function reconcileAccountSync(stateInput: AppState): Promise<AppState> {
  let state = stateInput;
  const metadata = await readAccountSyncMetadata();
  if (isBuiltInBackground(state.background) && !metadata.lastBuiltInBackground) metadata.lastBuiltInBackground = state.background;
  if (!state.settings.accountSyncEnabled) {
    await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
    return state;
  }
  let rawSnapshot: unknown;
  try {
    const saved = await chrome.storage.sync.get(ACCOUNT_SYNC_KEY);
    rawSnapshot = saved[ACCOUNT_SYNC_KEY];
  } catch {
    metadata.pending = true;
    metadata.error = 'write';
    await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
    return state;
  }

  if (rawSnapshot !== undefined) {
    const remote = parseAccountSyncSnapshot(rawSnapshot);
    if (!remote) {
      metadata.error = 'invalid';
      metadata.conflict = undefined;
      await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
      return state;
    }
    if (metadata.conflict) {
      metadata.conflict = remote;
      metadata.error = undefined;
      await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
      return state;
    }
    const remoteState = mergeAccountSyncSnapshot(structuredClone(DEFAULT_STATE), remote);
    const localKey = accountSyncDataKey(state, metadata.lastBuiltInBackground);
    const remoteKey = accountSyncDataKey(remoteState);
    if (!metadata.initialized) {
      if (!hasAccountSyncData(state, metadata.lastBuiltInBackground)) {
        if (hasAccountSyncData(remoteState)) state = await applyRemoteAccountSnapshot(state, metadata, remote);
        else {
          metadata.initialized = true;
          metadata.revision = remote.revision;
          metadata.versionDeviceId = remote.deviceId;
          metadata.updatedAt = remote.updatedAt;
          metadata.lastBuiltInBackground = remote.background;
          await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
        }
        return state;
      }
      if (localKey !== remoteKey) {
        metadata.conflict = remote;
        metadata.pending = false;
        metadata.error = undefined;
        await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
        return state;
      }
      metadata.initialized = true;
      metadata.revision = remote.revision;
      metadata.versionDeviceId = remote.deviceId;
      metadata.updatedAt = remote.updatedAt;
      metadata.lastBuiltInBackground = remote.background;
      await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
      return state;
    }

    const localVersion = { revision: metadata.revision, deviceId: metadata.versionDeviceId, updatedAt: metadata.updatedAt };
    const remoteOrder = compareAccountSyncVersions(remote, localVersion);
    const remoteWins = remoteOrder > 0 || (remoteOrder === 0 && remoteKey > localKey);
    if (metadata.pending && localKey !== remoteKey && remoteOrder >= 0) {
      metadata.conflict = remote;
      metadata.error = undefined;
      await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
      return state;
    }
    if (remoteWins) return await applyRemoteAccountSnapshot(state, metadata, remote);
    metadata.lastBuiltInBackground = metadata.lastBuiltInBackground ?? remote.background;
    if (localKey !== remoteKey || metadata.pending || remoteOrder < 0) {
      if (localKey !== remoteKey || remoteOrder < 0) {
        metadata.revision = Math.max(metadata.revision, remote.revision) + 1;
        metadata.updatedAt = Date.now();
        metadata.versionDeviceId = metadata.deviceId;
      }
      await writeAccountSyncSnapshot(state, metadata);
    } else {
      metadata.pending = false;
      metadata.error = undefined;
      await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
    }
    return state;
  }

  if (!metadata.initialized) metadata.initialized = true;
  if (hasAccountSyncData(state, metadata.lastBuiltInBackground) || metadata.pending) await writeAccountSyncSnapshot(state, metadata);
  else await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
  return state;
}

function providerKey(state: AppState, market: Market) {
  return market === 'TW' ? state.settings.fugleKey : state.settings.finnhubKey;
}

function candidateKey(market: Market, symbol: string) { return `${market}:${symbol.toUpperCase()}`; }

function orderedCandidates(state: AppState, requestedStockId?: string): Candidate[] {
  const groupOrder = new Map(state.groups.map((group) => [group.id, group.order]));
  const stocks = [...state.stocks].sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.order - b.order);
  const unique = new Map<string, Candidate>();
  for (const stock of stocks) {
    const apiKey = providerKey(state, stock.market).trim();
    if (!apiKey) continue;
    const key = candidateKey(stock.market, stock.symbol);
    if (!unique.has(key)) unique.set(key, { market: stock.market, symbol: stock.symbol, apiKey, key, order: stock.order });
  }
  const candidates = [...unique.values()];
  if (requestedStockId) {
    const requested = state.stocks.find((stock) => stock.id === requestedStockId);
    if (requested) {
      const key = candidateKey(requested.market, requested.symbol);
      candidates.sort((a, b) => (a.key === key ? -1 : 0) - (b.key === key ? -1 : 0));
    }
  }
  return candidates;
}

async function ensureSetup() {
  await enqueue(async () => {
    const saved = await chrome.storage.local.get(STATE_KEY);
    let state = normalizeState(saved[STATE_KEY] ?? structuredClone(DEFAULT_STATE));
    state = await reconcileAccountSync(state);
    await chrome.storage.local.set({ [STATE_KEY]: state });
    await saveScheduler(await readScheduler());
    await reconcileAlarm(state);
  });
}

async function reconcileAlarm(state: AppState) {
  const periodInMinutes = state.settings.quoteRefreshSeconds / 60;
  const current = await chrome.alarms.get(ALARM_NAME);
  if (!current || current.periodInMinutes !== periodInMinutes) await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

chrome.runtime.onInstalled.addListener(() => { void ensureSetup(); });
chrome.runtime.onStartup.addListener(() => { void ensureSetup(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void refreshQuotes(); });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !Object.hasOwn(changes, ACCOUNT_SYNC_KEY)) return;
  void enqueue(async () => {
    const state = await loadState();
    if (!state.settings.accountSyncEnabled) return;
    const reconciled = await reconcileAccountSync(state);
    await chrome.storage.local.set({ [STATE_KEY]: reconciled });
    await reconcileAlarm(reconciled);
  });
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'STATE_MUTATE') {
    void enqueue(async () => {
      const operation = message.operation as StateOperation;
      let previous = await loadState();
      let metadata = await readAccountSyncMetadata();
      if (previous.settings.accountSyncEnabled && !metadata.initialized && !metadata.conflict) {
        previous = await reconcileAccountSync(previous);
        metadata = await readAccountSyncMetadata();
      }
      const next = normalizeState(applyOperation(previous, operation));
      const notificationsDisabled = operation.type === 'update-notification-settings'
        && (!operation.notificationsEnabled || operation.notificationPermission !== 'granted');
      if (notificationsDisabled || (operation.type === 'update-settings' && operation.settings.limitNotificationsEnabled === false)) {
        next.stocks = next.stocks.map((stock) => ({ ...stock, pendingLimitNotification: undefined, limitNotificationFailure: undefined }));
      }
      if (isBuiltInBackground(previous.background) && !metadata.lastBuiltInBackground) metadata.lastBuiltInBackground = previous.background;
      const syncChanged = accountSyncDataKey(previous, metadata.lastBuiltInBackground) !== accountSyncDataKey(next, metadata.lastBuiltInBackground);
      if (syncChanged) {
        metadata.revision = Math.max(metadata.revision, metadata.conflict?.revision ?? 0) + 1;
        metadata.updatedAt = Date.now();
        metadata.versionDeviceId = metadata.deviceId;
        metadata.pending = true;
        if (metadata.error !== 'invalid') metadata.error = undefined;
      }
      await chrome.storage.local.set({ [STATE_KEY]: next, [ACCOUNT_SYNC_META_KEY]: metadata });
      if (operation.type === 'update-settings' && Object.hasOwn(operation.settings, 'quoteRefreshSeconds')) await reconcileAlarm(next);
      if (next.settings.accountSyncEnabled && syncChanged && !metadata.conflict && metadata.error !== 'invalid') await writeAccountSyncSnapshot(next, metadata);
      return next;
    }).then((state) => sendResponse({ state })).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'ACCOUNT_SYNC_STATUS') {
    void enqueue(async () => {
      const state = await loadState();
      const metadata = await readAccountSyncMetadata();
      return { state, status: accountSyncStatus(state, metadata) };
    }).then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'ACCOUNT_SYNC_SET_ENABLED') {
    void enqueue(async () => {
      const previous = await loadState();
      const enabled = message.enabled === true;
      const state = { ...previous, settings: { ...previous.settings, accountSyncEnabled: enabled } };
      const metadata = await readAccountSyncMetadata();
      if (isBuiltInBackground(previous.background) && !metadata.lastBuiltInBackground) metadata.lastBuiltInBackground = previous.background;
      await chrome.storage.local.set({ [STATE_KEY]: state, [ACCOUNT_SYNC_META_KEY]: metadata });
      const reconciled = enabled ? await reconcileAccountSync(state) : state;
      await chrome.storage.local.set({ [STATE_KEY]: reconciled });
      await reconcileAlarm(reconciled);
      return { state: reconciled, status: accountSyncStatus(reconciled, await readAccountSyncMetadata()) };
    }).then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'ACCOUNT_SYNC_RESOLVE') {
    void enqueue(async () => {
      const state = await loadState();
      const metadata = await readAccountSyncMetadata();
      if (!state.settings.accountSyncEnabled || !metadata.conflict) throw new Error('目前沒有待選擇的同步資料');
      if (message.choice === 'sync') {
        const saved = await chrome.storage.sync.get(ACCOUNT_SYNC_KEY);
        const remote = parseAccountSyncSnapshot(saved[ACCOUNT_SYNC_KEY]);
        if (!remote) {
          metadata.conflict = undefined;
          metadata.error = 'invalid';
          await chrome.storage.local.set({ [ACCOUNT_SYNC_META_KEY]: metadata });
          throw new Error('Chrome 同步空間的資料已變更或無法讀取，請重新確認同步狀態。');
        }
        const applied = await applyRemoteAccountSnapshot(state, metadata, remote);
        await reconcileAlarm(applied);
        return { state: applied, status: accountSyncStatus(applied, await readAccountSyncMetadata()) };
      }
      if (message.choice !== 'local') throw new Error('同步選項無效');
      const cachedConflictRevision = metadata.conflict.revision;
      const currentRemote = await chrome.storage.sync.get(ACCOUNT_SYNC_KEY);
      const parsedCurrentRemote = parseAccountSyncSnapshot(currentRemote[ACCOUNT_SYNC_KEY]);
      metadata.revision = Math.max(metadata.revision, cachedConflictRevision, parsedCurrentRemote?.revision ?? 0) + 1;
      metadata.updatedAt = Date.now();
      metadata.versionDeviceId = metadata.deviceId;
      metadata.conflict = undefined;
      metadata.initialized = true;
      await writeAccountSyncSnapshot(state, metadata);
      return { state, status: accountSyncStatus(state, await readAccountSyncMetadata()) };
    }).then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'ACCOUNT_SYNC_RETRY') {
    void enqueue(async () => {
      const state = await loadState();
      const metadata = await readAccountSyncMetadata();
      if (!state.settings.accountSyncEnabled) return { state, status: accountSyncStatus(state, metadata) };
      const reconciled = await reconcileAccountSync(state);
      await chrome.storage.local.set({ [STATE_KEY]: reconciled });
      await reconcileAlarm(reconciled);
      return { state: reconciled, status: accountSyncStatus(reconciled, await readAccountSyncMetadata()) };
    }).then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'REFRESH_QUOTES') {
    void refreshQuotes(typeof message.stockId === 'string' ? message.stockId : undefined).then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'LOOKUP_SYMBOL_NAME') {
    void lookupSymbolName(message.market, message.symbol).then((name) => sendResponse({ name })).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'RETRY_NOTIFICATION') {
    void retryNotification(String(message.stockId ?? '')).then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  if (message?.type === 'TEST_NOTIFICATION') {
    void testNotification().then(sendResponse).catch((error: unknown) => sendResponse({ error: messageFor(error) }));
    return true;
  }
  return false;
});

function messageFor(error: unknown) { return error instanceof Error ? error.message : '操作失敗，請稍後再試'; }

function classifyError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError('行情來源暫時無法使用', 'provider-error');
}

function symbolNameKey(market: Market, symbol: string) { return `${market}:${symbol}`; }

async function readCachedSymbolName(key: string): Promise<string | null> {
  const stored = await chrome.storage.local.get(NAME_CACHE_KEY);
  const cache = stored[NAME_CACHE_KEY] as SymbolNameCache | undefined;
  const entry = cache?.[key];
  if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || !Number.isFinite(entry.cachedAt) || Date.now() - entry.cachedAt >= NAME_CACHE_TTL_MS) return null;
  return entry.name;
}

async function cacheSymbolName(key: string, name: string) {
  await enqueue(async () => {
    const stored = await chrome.storage.local.get(NAME_CACHE_KEY);
    const raw = stored[NAME_CACHE_KEY];
    const existing = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as SymbolNameCache : {};
    const now = Date.now();
    const fresh = Object.entries(existing).filter(([, entry]) => entry && typeof entry.name === 'string' && Number.isFinite(entry.cachedAt) && now - entry.cachedAt < NAME_CACHE_TTL_MS);
    fresh.sort((a, b) => b[1].cachedAt - a[1].cachedAt);
    const trimmed = Object.fromEntries(fresh.filter(([entryKey]) => entryKey !== key).slice(0, NAME_CACHE_MAX_ENTRIES - 1));
    trimmed[key] = { name, cachedAt: now };
    await chrome.storage.local.set({ [NAME_CACHE_KEY]: trimmed });
  });
}

async function lookupSymbolName(marketValue: unknown, symbolValue: unknown): Promise<string> {
  if (marketValue !== 'TW' && marketValue !== 'US') throw new Error('市場設定無效');
  if (typeof symbolValue !== 'string') throw new Error('股票代號無效');
  const market = marketValue as Market;
  const symbol = symbolValue.trim().toUpperCase();
  const valid = market === 'TW' ? /^\d{4,6}[A-Z]?$/.test(symbol) : /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol);
  if (!valid) throw new Error('股票代號無效');
  const key = symbolNameKey(market, symbol);
  const cached = await readCachedSymbolName(key);
  if (cached) return cached;
  const inFlight = nameLookupPromises.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const state = await loadState();
    const apiKey = providerKey(state, market).trim();
    if (!apiKey) throw new Error(`尚未設定 ${market === 'TW' ? 'Fugle' : 'Finnhub'} API 金鑰`);
    const reservation = await enqueue(async () => {
      const scheduler = await readScheduler();
      const result = reserveRequest(scheduler.providers[market], Date.now());
      await saveScheduler(scheduler);
      return result;
    });
    if (!reservation.allowed) throw new Error(reservation.reason === 'cooldown' ? '行情來源冷卻中，請稍後再查詢' : '行情來源每分鐘請求額度已用完，請稍後再查詢');
    try {
      const name = market === 'TW'
        ? await fetchFugleSymbolName({ market, symbol, apiKey })
        : await fetchFinnhubSymbolName({ market, symbol, apiKey });
      await cacheSymbolName(key, name);
      return name;
    } catch (error) {
      const classified = classifyError(error);
      if (classified.status === 'rate-limited') {
        await enqueue(async () => {
          const latest = await readScheduler();
          await saveScheduler(applyCooldown(latest, market, Date.now(), classified.retryAfterMs));
        });
      }
      throw classified;
    }
  })().finally(() => { nameLookupPromises.delete(key); });
  nameLookupPromises.set(key, request);
  return request;
}

async function markMissingKeys(state: AppState) {
  const missing = new Set<Market>((['TW', 'US'] as Market[]).filter((market) => !providerKey(state, market).trim()));
  if (!missing.size) return;
  await enqueue(async () => {
    const current = await loadState();
    const stocks = current.stocks.map((stock) => {
      if (!missing.has(stock.market) || providerKey(current, stock.market).trim()) return stock;
      return stock.quote ? { ...stock, quoteStatus: 'stale' as const, quoteError: 'not-connected' as const } : { ...stock, quoteStatus: 'not-connected' as const, quoteError: undefined };
    });
    await chrome.storage.local.set({ [STATE_KEY]: { ...current, stocks } });
  });
}

async function refreshQuotes(requestedStockId?: string): Promise<{ refreshed: number; skipped: number }> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const startingState = await loadState();
    await markMissingKeys(startingState);
    const { allCandidates, selected } = await enqueue(async () => {
      const state = await loadState();
      const scheduler = await readScheduler();
      const allCandidates = orderedCandidates(state, requestedStockId);
      const selected: Candidate[] = [];
      for (const market of ['TW', 'US'] as const) {
        const candidates = allCandidates.filter((candidate) => candidate.market === market);
        selected.push(...selectBatch(candidates, scheduler.providers[market], Date.now()));
      }
      await saveScheduler(scheduler);
      return { allCandidates, selected };
    });
    if (!selected.length) return { refreshed: 0, skipped: allCandidates.length };

    let refreshed = 0;
    let deferred = 0;
    for (const market of ['TW', 'US'] as const) {
      const providerBatch = selected.filter((candidate) => candidate.market === market);
      for (let offset = 0; offset < providerBatch.length; offset += 4) {
        const chunk = providerBatch.slice(offset, offset + 4);
        const results = await Promise.all(chunk.map(async (candidate) => {
          try {
            const quote = candidate.market === 'TW'
              ? await fetchFugleQuote({ market: candidate.market, symbol: candidate.symbol, apiKey: candidate.apiKey })
              : await fetchFinnhubQuote({ market: candidate.market, symbol: candidate.symbol, apiKey: candidate.apiKey });
            await applyQuote(candidate, quote);
            return { candidate, ok: true as const };
          } catch (error) {
            const classified = classifyError(error);
            await applyFailure(candidate, classified);
            return { candidate, ok: false as const, status: classified.status };
          }
        }));
        refreshed += results.filter((result) => result.ok).length;
        if (results.some((result) => !result.ok && result.status === 'rate-limited')) {
          deferred += providerBatch.length - offset - chunk.length;
          break;
        }
      }
    }
    return { refreshed, skipped: Math.max(0, allCandidates.length - selected.length + deferred) };
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function taipeiTradeDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).formatToParts(timestamp);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function limitNotificationKey(event: LimitNotification) {
  return `${event.market}:${event.symbol.toUpperCase()}:${event.tradeDate}:${event.direction}`;
}

function normalizedLimitRecord(value: unknown, now = Date.now()): LimitNotificationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, deliveredAt]) => typeof deliveredAt === 'number' && Number.isFinite(deliveredAt) && deliveredAt <= now && now - deliveredAt < LIMIT_NOTIFICATION_RETENTION_MS)) as LimitNotificationRecord;
}

function limitEventFor(stock: Stock, quote: Quote, now: number): LimitNotification | null {
  if (stock.market !== 'TW' || quote.source !== 'Fugle' || !isNewerQuote(stock.quote, quote)) return null;
  if ((quote.status !== 'live' && quote.status !== 'closed') || !Number.isFinite(quote.timestamp) || quote.timestamp > now || now - quote.timestamp > 120_000) return null;
  if (quote.isTrial === true || quote.isTradingHalted === true || quote.isLimitUpHalt === true || quote.isLimitDownHalt === true) return null;
  const limitUp = quote.isLimitUpPrice === true;
  const limitDown = quote.isLimitDownPrice === true;
  if (limitUp === limitDown) return null;
  return {
    market: 'TW',
    symbol: stock.symbol.toUpperCase(),
    direction: limitUp ? 'limit-up' : 'limit-down',
    price: quote.price,
    quoteTimestamp: quote.timestamp,
    tradeDate: taipeiTradeDate(quote.timestamp),
  };
}

function pendingLimitNotificationIsCurrent(stock: Stock, event: LimitNotification, now: number) {
  const quote = stock.quote;
  if (stock.market !== 'TW' || stock.symbol.toUpperCase() !== event.symbol.toUpperCase() || event.market !== 'TW') return false;
  if (!quote || quote.source !== 'Fugle' || (stock.quoteStatus !== 'live' && stock.quoteStatus !== 'closed')) return false;
  if (!Number.isFinite(quote.timestamp) || quote.timestamp > now || now - quote.timestamp > 120_000) return false;
  if (!Number.isFinite(event.quoteTimestamp) || event.quoteTimestamp > now || taipeiTradeDate(event.quoteTimestamp) !== event.tradeDate) return false;
  if (taipeiTradeDate(quote.timestamp) !== event.tradeDate) return false;
  if (quote.isTrial === true || quote.isTradingHalted === true || quote.isLimitUpHalt === true || quote.isLimitDownHalt === true) return false;
  const up = quote.isLimitUpPrice === true;
  const down = quote.isLimitDownPrice === true;
  return event.direction === 'limit-up' ? up && !down : down && !up;
}

function sameThresholdEvent(left: ThresholdNotification | undefined, right: ThresholdNotification) {
  return Boolean(left && left.rule === right.rule && left.threshold === right.threshold && left.price === right.price && left.quoteTimestamp === right.quoteTimestamp);
}

function sameLimitEvent(left: LimitNotification | undefined, right: LimitNotification) {
  return Boolean(left && left.market === right.market && left.symbol.toUpperCase() === right.symbol.toUpperCase() && left.direction === right.direction && left.price === right.price && left.quoteTimestamp === right.quoteTimestamp && left.tradeDate === right.tradeDate);
}

async function applyQuote(candidate: Candidate, quote: Quote) {
  const pending: NotificationJob[] = [];
  await enqueue(async () => {
    const current = await loadState();
    if (providerKey(current, candidate.market).trim() !== candidate.apiKey) return;
    const limitRecord = normalizedLimitRecord((await chrome.storage.local.get(LIMIT_NOTIFICATION_KEY))[LIMIT_NOTIFICATION_KEY]);
    const groupOrder = new Map(current.groups.map((group) => [group.id, group.order]));
    const canonicalLimitStockId = current.stocks
      .filter((stock) => stock.market === 'TW' && stock.symbol.toUpperCase() === candidate.symbol.toUpperCase())
      .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.order - b.order)[0]?.id;
    const notificationsAllowed = current.settings.notificationsEnabled && current.settings.notificationPermission === 'granted';
    let touched = false;
    const stocks = current.stocks.map((stock) => {
      if (stock.market !== candidate.market || stock.symbol.toUpperCase() !== candidate.symbol.toUpperCase()) return stock;
      if (stock.quote && quote.timestamp === stock.quote.timestamp) {
        const sameTimestampLimitFlags = candidate.market === 'TW' && quote.source === 'Fugle'
          ? {
            isLimitUpPrice: quote.isLimitUpPrice,
            isLimitDownPrice: quote.isLimitDownPrice,
            isTrial: quote.isTrial,
            isTradingHalted: quote.isTradingHalted,
            isLimitUpHalt: quote.isLimitUpHalt,
            isLimitDownHalt: quote.isLimitDownHalt,
          }
          : null;
        const limitFlagsChanged = sameTimestampLimitFlags !== null && Object.entries(sameTimestampLimitFlags)
          .some(([key, value]) => stock.quote?.[key as keyof Quote] !== value);
        if (stock.quoteStatus === quote.status && stock.quoteError === undefined && !limitFlagsChanged) return stock;
        touched = true;
        return {
          ...stock,
          quote: limitFlagsChanged && sameTimestampLimitFlags ? { ...stock.quote, ...sameTimestampLimitFlags } : stock.quote,
          quoteStatus: quote.status,
          quoteError: undefined,
        };
      }
      if (!isNewerQuote(stock.quote, quote)) return stock;
      touched = true;
      const now = Date.now();
      const evaluation = evaluateAlerts(stock, quote.price, quote.timestamp, now, quote.status);
      const thresholdEvent = evaluation.events[0];
      let next: Stock = {
        ...evaluation.stock,
        name: stock.name === stock.symbol && quote.marketName ? quote.marketName : stock.name,
        quote,
        quoteStatus: quote.status,
        quoteError: undefined,
      };
      if (notificationsAllowed && thresholdEvent && !stock.pendingNotification) {
        next = { ...next, pendingNotification: thresholdEvent, notificationFailure: undefined };
        pending.push({ stockId: next.id, kind: 'threshold', event: thresholdEvent });
      }

      if (!current.settings.limitNotificationsEnabled) {
        next = { ...next, pendingLimitNotification: undefined, limitNotificationFailure: undefined };
        return next;
      }
      if (notificationsAllowed && stock.id === canonicalLimitStockId) {
        const limitEvent = limitEventFor(stock, quote, now);
        if (limitEvent) {
          const key = limitNotificationKey(limitEvent);
          if (limitRecord[key]) {
            next = { ...next, pendingLimitNotification: undefined, limitNotificationFailure: undefined };
          } else if (stock.pendingLimitNotification && limitNotificationKey(stock.pendingLimitNotification) === key) {
            // Keep an existing same-day failure intact; a later tick must not silently replace or resend it.
            next = { ...next, pendingLimitNotification: stock.pendingLimitNotification, limitNotificationFailure: stock.limitNotificationFailure };
          } else {
            next = { ...next, pendingLimitNotification: limitEvent, limitNotificationFailure: undefined };
            pending.push({ stockId: next.id, kind: 'limit', event: limitEvent });
          }
        } else if (stock.pendingLimitNotification) {
          next = { ...next, pendingLimitNotification: undefined, limitNotificationFailure: undefined };
        }
      }
      return next;
    });
    if (touched) await chrome.storage.local.set({ [STATE_KEY]: { ...current, stocks, lastRefreshAt: Date.now() } });
  });
  for (const item of pending) {
    if (item.kind === 'threshold') await deliverNotification(item.stockId, 'threshold', item.event);
    else await deliverNotification(item.stockId, 'limit', item.event);
  }
}

async function applyFailure(candidate: Candidate, error: ProviderError) {
  await enqueue(async () => {
    const current = await loadState();
    if (providerKey(current, candidate.market).trim() !== candidate.apiKey) return;
    const stocks = current.stocks.map((stock) => {
      if (stock.market !== candidate.market || stock.symbol.toUpperCase() !== candidate.symbol.toUpperCase()) return stock;
      return stock.quote ? { ...stock, quoteStatus: 'stale' as const, quoteError: error.status } : { ...stock, quoteStatus: error.status, quoteError: error.status };
    });
    await chrome.storage.local.set({ [STATE_KEY]: { ...current, stocks } });
    if (error.status === 'rate-limited') {
      const latest = applyCooldown(await readScheduler(), candidate.market, Date.now(), error.retryAfterMs);
      await saveScheduler(latest);
    }
  });
}

function formatQuoteTime(stock: Stock, timestamp: number) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short', timeZone: stock.market === 'TW' ? 'Asia/Taipei' : 'America/New_York' }).format(timestamp);
}

function formatMoney(stock: Stock, value: number) {
  const amount = new Intl.NumberFormat('zh-TW', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return `${stock.market === 'TW' ? 'NT$' : 'US$'}${amount}`;
}

async function createNotification(title: string, message: string, id = `stock-${crypto.randomUUID()}`) {
  return chrome.notifications.create(id, {
    type: 'basic', title, message, iconUrl: chrome.runtime.getURL('icons/icon128.png'), priority: 1,
  });
}

function pendingNotificationIsCurrent(stock: Stock, event: ThresholdNotification, now: number) {
  const quote = stock.quote;
  const threshold = stock.alert[event.rule];
  const stillMatches = event.rule === 'above' ? Boolean(quote && quote.price > event.threshold) : Boolean(quote && quote.price < event.threshold);
  return Boolean(quote
    && threshold === event.threshold
    && quote.timestamp === event.quoteTimestamp
    && (stock.quoteStatus === 'live' || stock.quoteStatus === 'closed')
    && Number.isFinite(event.quoteTimestamp)
    && event.quoteTimestamp <= now
    && now - event.quoteTimestamp <= 120_000
    && stillMatches);
}

function clearNotificationSlot(stock: Stock, kind: 'threshold' | 'limit', event: ThresholdNotification | LimitNotification): Stock {
  if (kind === 'threshold') {
    if (!sameThresholdEvent(stock.pendingNotification, event as ThresholdNotification)) return stock;
    return { ...stock, pendingNotification: undefined, notificationFailure: undefined };
  }
  if (!sameLimitEvent(stock.pendingLimitNotification, event as LimitNotification)) return stock;
  return { ...stock, pendingLimitNotification: undefined, limitNotificationFailure: undefined };
}

async function deliverNotification(stockId: string, kind: 'threshold', event: ThresholdNotification): Promise<{ ok: true } | { error: string }>;
async function deliverNotification(stockId: string, kind: 'limit', event: LimitNotification): Promise<{ ok: true } | { error: string }>;
async function deliverNotification(stockId: string, kind: 'threshold' | 'limit', event: ThresholdNotification | LimitNotification): Promise<{ ok: true } | { error: string }> {
  return enqueue(async () => {
    const state = await loadState();
    const stock = state.stocks.find((item) => item.id === stockId);
    const stillPending = stock && (kind === 'threshold'
      ? sameThresholdEvent(stock.pendingNotification, event as ThresholdNotification)
      : sameLimitEvent(stock.pendingLimitNotification, event as LimitNotification));
    if (!stock || !stillPending) return { error: '沒有待送出的通知。' };
    if (!state.settings.notificationsEnabled || state.settings.notificationPermission !== 'granted') return { error: '請先開啟到價提醒並允許瀏覽器通知。' };
    if (kind === 'limit' && !state.settings.limitNotificationsEnabled) {
      const stocks = state.stocks.map((item) => item.id === stockId ? { ...item, pendingLimitNotification: undefined, limitNotificationFailure: undefined } : item);
      await chrome.storage.local.set({ [STATE_KEY]: { ...state, stocks } });
      return { error: '台股漲跌停通知已關閉。' };
    }
    const now = Date.now();
    const current = kind === 'threshold'
      ? pendingNotificationIsCurrent(stock, event as ThresholdNotification, now)
      : pendingLimitNotificationIsCurrent(stock, event as LimitNotification, now);
    if (!current) {
      const stocks = state.stocks.map((item) => item.id === stockId ? clearNotificationSlot(item, kind, event) : item);
      await chrome.storage.local.set({ [STATE_KEY]: { ...state, stocks } });
      return { error: kind === 'threshold' ? '到價條件已改變或報價已過期，通知未送出。' : '漲跌停條件已改變或報價已過期，通知未送出。' };
    }

    const quote = stock.quote!;
    const notificationId = kind === 'threshold'
      ? `stock-${stock.id}-${(event as ThresholdNotification).rule}-${(event as ThresholdNotification).quoteTimestamp}`
      : `limit-TW-${stock.symbol.toUpperCase()}-${(event as LimitNotification).tradeDate}-${(event as LimitNotification).direction}`;
    const title = kind === 'threshold'
      ? `${stock.customLabel || stock.name}（${stock.symbol}）到價提醒`
      : `${stock.customLabel || stock.name}（${stock.symbol}）${(event as LimitNotification).direction === 'limit-up' ? '漲停' : '跌停'}通知`;
    const message = kind === 'threshold'
      ? (() => {
        const thresholdEvent = event as ThresholdNotification;
        const direction = thresholdEvent.rule === 'above' ? '高於' : '低於';
        return `${formatMoney(stock, thresholdEvent.price)} · 條件 ${direction} ${formatMoney(stock, thresholdEvent.threshold)} · ${quote.source} ${formatQuoteTime(stock, thresholdEvent.quoteTimestamp)}`;
      })()
      : `${formatMoney(stock, quote.price)} · Fugle 成交 ${formatQuoteTime(stock, quote.timestamp)}`;

    try {
      const existingNotifications = await chrome.notifications.getAll();
      const limitRecord = kind === 'limit' ? normalizedLimitRecord((await chrome.storage.local.get(LIMIT_NOTIFICATION_KEY))[LIMIT_NOTIFICATION_KEY], now) : null;
      const dedupeKey = kind === 'limit' ? limitNotificationKey(event as LimitNotification) : null;
      if (kind === 'limit' && dedupeKey && limitRecord?.[dedupeKey]) {
        const stocks = state.stocks.map((item) => item.id === stockId ? clearNotificationSlot(item, kind, event) : item);
        await chrome.storage.local.set({ [STATE_KEY]: { ...state, stocks } });
        return { ok: true };
      }
      const notificationAlreadyExists = Boolean(existingNotifications[notificationId]);
      if (!notificationAlreadyExists) await createNotification(title, message, notificationId);
      const stocks = state.stocks.map((item) => item.id === stockId ? clearNotificationSlot(item, kind, event) : item);
      const updates: Record<string, unknown> = { [STATE_KEY]: { ...state, stocks } };
      if (kind === 'limit' && dedupeKey) updates[LIMIT_NOTIFICATION_KEY] = { ...limitRecord, [dedupeKey]: now };
      await chrome.storage.local.set(updates);
      return { ok: true };
    } catch {
      const stocks = state.stocks.map((item) => item.id === stockId && (kind === 'threshold'
        ? sameThresholdEvent(item.pendingNotification, event as ThresholdNotification)
        : sameLimitEvent(item.pendingLimitNotification, event as LimitNotification))
        ? kind === 'threshold' ? { ...item, notificationFailure: '通知傳送失敗，請重試' } : { ...item, limitNotificationFailure: '通知傳送失敗，請重試' }
        : item);
      await chrome.storage.local.set({ [STATE_KEY]: { ...state, stocks } });
      return { error: '通知傳送失敗，請重試。' };
    }
  });
}

async function retryNotification(stockId: string) {
  const stock = (await loadState()).stocks.find((item) => item.id === stockId);
  if (!stock?.pendingNotification && !stock?.pendingLimitNotification) return { error: '沒有待重試的通知' };
  const results: Array<{ ok: true } | { error: string }> = [];
  if (stock.pendingNotification) results.push(await deliverNotification(stockId, 'threshold', stock.pendingNotification));
  if (stock.pendingLimitNotification) results.push(await deliverNotification(stockId, 'limit', stock.pendingLimitNotification));
  const failure = results.find((result) => 'error' in result);
  return failure ?? { ok: true };
}

async function testNotification() {
  const state = await loadState();
  if (!state.settings.notificationsEnabled || state.settings.notificationPermission !== 'granted') throw new Error('請先開啟瀏覽器通知權限');
  await createNotification('山嵐股票桌面', '這是一則測試通知，到價提醒已準備就緒。');
  return { ok: true };
}

void ensureSetup();
