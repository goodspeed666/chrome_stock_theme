import { DEFAULT_STATE, normalizeAppearanceTheme, type AppState } from '../domain/types';
import { createSaleRecord, normalizeSalesHistory, pruneSalesHistory, validateSale } from '../domain/salesHistory';

export const STATE_KEY = 'stockDesktopState.v1';
const LOCAL_KEY = STATE_KEY;

function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return structuredClone(DEFAULT_STATE);
  const state = value as AppState;
  const quoteRefreshSeconds = [30, 60, 120, 300].includes(state.settings?.quoteRefreshSeconds) ? state.settings.quoteRefreshSeconds : 30;
  return {
    ...structuredClone(DEFAULT_STATE),
    ...state,
    groups: Array.isArray(state.groups) ? state.groups : structuredClone(DEFAULT_STATE.groups),
    stocks: Array.isArray(state.stocks) ? state.stocks : [],
    salesHistory: normalizeSalesHistory(state.salesHistory),
    settings: {
      ...DEFAULT_STATE.settings,
      ...state.settings,
      limitNotificationsEnabled: typeof state.settings?.limitNotificationsEnabled === 'boolean' ? state.settings.limitNotificationsEnabled : true,
      quoteRefreshSeconds,
      accountSyncEnabled: state.settings?.accountSyncEnabled === true,
      appearanceTheme: normalizeAppearanceTheme(state.settings?.appearanceTheme),
    },
    background: { ...DEFAULT_STATE.background, ...state.background, selectedId: state.background?.selectedId === 'default' ? 'scene-01' : (state.background?.selectedId ?? DEFAULT_STATE.background.selectedId) },
  };
}

function reindexGroup(stocks: AppState['stocks'], groupId: string, orderedIds?: string[]): AppState['stocks'] {
  const explicitOrder = new Map((orderedIds ?? []).map((id, index) => [id, index]));
  const groupStocks = stocks.filter((stock) => stock.groupId === groupId).sort((a, b) => {
    const orderA = explicitOrder.get(a.id);
    const orderB = explicitOrder.get(b.id);
    if (orderA !== undefined || orderB !== undefined) return (orderA ?? Number.MAX_SAFE_INTEGER) - (orderB ?? Number.MAX_SAFE_INTEGER);
    return a.order - b.order;
  });
  const order = new Map(groupStocks.map((stock, index) => [stock.id, index]));
  return stocks.map((stock) => stock.groupId === groupId ? { ...stock, order: order.get(stock.id) ?? stock.order } : stock);
}

export interface StateAdapter {
  load(): Promise<AppState>;
  save(state: AppState): Promise<AppState>;
  subscribe(listener: (state: AppState) => void): () => void;
  mutate(operation: StateOperation): Promise<AppState>;
}

export type StateOperation =
  | { type: 'replace'; state: AppState }
  | { type: 'add-stock'; stock: AppState['stocks'][number] }
  | { type: 'sell-stock'; stockId: string; recordId: string; salePrice: number; saleDate: string }
  | { type: 'edit-sale'; recordId: string; salePrice: number; saleDate: string }
  | { type: 'restore-sale'; recordId: string; stockId: string; groupId?: string }
  | { type: 'prune-sales-history' }
  | { type: 'update-stock'; stock: AppState['stocks'][number] }
  | { type: 'patch-stock'; stockId: string; patch: Partial<AppState['stocks'][number]> }
  | { type: 'delete-stock'; stockId: string }
  | { type: 'reorder-stocks'; stockIds: string[]; groupId: string }
  | { type: 'place-stock'; stockId: string; groupId: string; index: number }
  | { type: 'add-group'; group: AppState['groups'][number] }
  | { type: 'update-group'; group: AppState['groups'][number] }
  | { type: 'reorder-groups'; groupIds: string[] }
  | { type: 'delete-group'; groupId: string; moveToGroupId?: string; deleteStocks?: boolean }
  | { type: 'update-settings'; settings: Partial<AppState['settings']> }
  | { type: 'update-notification-settings'; notificationsEnabled: boolean; notificationPermission: AppState['settings']['notificationPermission'] }
  | { type: 'update-background'; background: Partial<AppState['background']> }
  | { type: 'clear-notification-failure'; stockId: string };

const HISTORY_MUTATION_TYPES = new Set<StateOperation['type']>([
  'sell-stock',
  'edit-sale',
  'restore-sale',
  'prune-sales-history',
]);
const SALES_HISTORY_CAPABILITY = 'sales-history-v1';
const SALES_HISTORY_WORKER_ERROR = '擴充功能背景服務版本過舊或沒有回應，請重新載入擴充功能後再試。';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertValidStateOperation(value: unknown): asserts value is StateOperation {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('不支援或格式錯誤的狀態操作');
  const operation = value;
  const valid = (() => {
    switch (operation.type) {
      case 'replace': return isRecord(operation.state) && operation.state.version === 1;
      case 'add-stock':
      case 'update-stock': return isRecord(operation.stock) && requireString(operation.stock.id) && requireString(operation.stock.groupId);
      case 'sell-stock': return requireString(operation.stockId) && requireString(operation.recordId) && typeof operation.salePrice === 'number' && typeof operation.saleDate === 'string';
      case 'edit-sale': return requireString(operation.recordId) && typeof operation.salePrice === 'number' && typeof operation.saleDate === 'string';
      case 'restore-sale': return requireString(operation.recordId) && requireString(operation.stockId) && (operation.groupId === undefined || requireString(operation.groupId));
      case 'prune-sales-history': return true;
      case 'patch-stock': return requireString(operation.stockId) && isRecord(operation.patch);
      case 'delete-stock':
      case 'clear-notification-failure': return requireString(operation.stockId);
      case 'reorder-stocks': return requireString(operation.groupId) && Array.isArray(operation.stockIds) && operation.stockIds.every(requireString);
      case 'place-stock': return requireString(operation.stockId) && requireString(operation.groupId) && typeof operation.index === 'number' && Number.isFinite(operation.index);
      case 'add-group':
      case 'update-group': return isRecord(operation.group) && requireString(operation.group.id);
      case 'reorder-groups': return Array.isArray(operation.groupIds) && operation.groupIds.every(requireString);
      case 'delete-group': return requireString(operation.groupId)
        && (operation.moveToGroupId === undefined || requireString(operation.moveToGroupId))
        && (operation.deleteStocks === undefined || typeof operation.deleteStocks === 'boolean');
      case 'update-settings': return isRecord(operation.settings);
      case 'update-notification-settings': return typeof operation.notificationsEnabled === 'boolean' && typeof operation.notificationPermission === 'string';
      case 'update-background': return isRecord(operation.background);
      default: return false;
    }
  })();
  if (!valid) throw new Error('不支援或格式錯誤的狀態操作');
}

function applyOperation(previous: AppState, operation: StateOperation): AppState {
  assertValidStateOperation(operation);
  const next = structuredClone(previous);
  next.salesHistory = pruneSalesHistory(next.salesHistory);
  switch (operation.type) {
    case 'replace': return normalizeState(operation.state);
    case 'add-stock': {
      const stocks = reindexGroup(next.stocks, operation.stock.groupId);
      const stock = { ...operation.stock, order: stocks.filter((candidate) => candidate.groupId === operation.stock.groupId).length };
      return { ...next, stocks: [...stocks, stock] };
    }
    case 'sell-stock': {
      const validation = validateSale(operation.salePrice, operation.saleDate);
      if (validation) throw new Error(validation);
      const stock = next.stocks.find((candidate) => candidate.id === operation.stockId);
      if (!stock) throw new Error('找不到要標記為已賣出的股票');
      if (next.salesHistory.some((record) => record.id === operation.recordId)) throw new Error('這筆售出記錄已存在，請重新整理後再試');
      const group = next.groups.find((candidate) => candidate.id === stock.groupId);
      if (!group) throw new Error('找不到股票原本所屬的分區');
      const record = createSaleRecord(operation.recordId, stock, group.name, operation.salePrice, operation.saleDate);
      const remaining = next.stocks.filter((candidate) => candidate.id !== stock.id);
      return {
        ...next,
        stocks: reindexGroup(remaining, stock.groupId),
        salesHistory: [...next.salesHistory, record],
      };
    }
    case 'edit-sale': {
      const validation = validateSale(operation.salePrice, operation.saleDate);
      if (validation) throw new Error(validation);
      const index = next.salesHistory.findIndex((record) => record.id === operation.recordId);
      if (index < 0) throw new Error('找不到這筆售出記錄，可能已超過保留期間');
      const salesHistory = [...next.salesHistory];
      salesHistory[index] = { ...salesHistory[index]!, salePrice: operation.salePrice, saleDate: operation.saleDate };
      return { ...next, salesHistory };
    }
    case 'restore-sale': {
      const record = next.salesHistory.find((candidate) => candidate.id === operation.recordId);
      if (!record) throw new Error('找不到這筆售出記錄，可能已超過保留期間');
      if (typeof operation.stockId !== 'string' || !operation.stockId.trim() || operation.stockId.length > 100 || next.stocks.some((stock) => stock.id === operation.stockId)) {
        throw new Error('股票識別碼無效或已被使用，售出記錄仍保留');
      }
      const originalGroup = next.groups.find((group) => group.id === record.stock.groupId);
      const targetGroup = originalGroup ?? next.groups.find((group) => group.id === operation.groupId);
      if (!targetGroup) throw new Error('原分區已不存在，請選擇有效的目的分區');
      const order = next.stocks.filter((stock) => stock.groupId === targetGroup.id).reduce((maximum, stock) => Math.max(maximum, stock.order), -1) + 1;
      const providerKey = record.stock.market === 'TW' ? next.settings.fugleKey : next.settings.finnhubKey;
      const hasKey = typeof providerKey === 'string' && providerKey.trim().length > 0;
      const restored: AppState['stocks'][number] = {
        ...record.stock,
        id: operation.stockId,
        groupId: targetGroup.id,
        order,
        alertLatches: { above: false, below: false },
        quoteStatus: hasKey ? 'no-trade' : 'not-connected',
      };
      return {
        ...next,
        stocks: [...next.stocks, restored],
        salesHistory: next.salesHistory.filter((candidate) => candidate.id !== record.id),
      };
    }
    case 'prune-sales-history': return { ...next, salesHistory: pruneSalesHistory(next.salesHistory) };
    case 'update-stock': return { ...next, stocks: next.stocks.map((stock) => stock.id === operation.stock.id ? operation.stock : stock) };
    case 'patch-stock': return { ...next, stocks: next.stocks.map((stock) => stock.id === operation.stockId ? { ...stock, ...operation.patch } : stock) };
    case 'delete-stock': {
      const groupId = next.stocks.find((stock) => stock.id === operation.stockId)?.groupId;
      const remaining = next.stocks.filter((stock) => stock.id !== operation.stockId);
      return { ...next, stocks: groupId ? reindexGroup(remaining, groupId) : remaining };
    }
    case 'reorder-stocks': {
      return { ...next, stocks: reindexGroup(next.stocks, operation.groupId, operation.stockIds) };
    }
    case 'place-stock': {
      const target = next.stocks.find((stock) => stock.id === operation.stockId);
      if (!target) return next;
      const sourceGroup = target.groupId;
      const targetStocks = next.stocks.filter((stock) => stock.groupId === operation.groupId && stock.id !== target.id).sort((a, b) => a.order - b.order);
      targetStocks.splice(Math.max(0, Math.min(operation.index, targetStocks.length)), 0, { ...target, groupId: operation.groupId });
      let stocks = next.stocks.map((stock) => stock.id === target.id ? { ...stock, groupId: operation.groupId } : stock);
      stocks = reindexGroup(stocks, operation.groupId, targetStocks.map((stock) => stock.id));
      if (sourceGroup !== operation.groupId) stocks = reindexGroup(stocks, sourceGroup);
      return { ...next, stocks };
    }
    case 'add-group': return { ...next, groups: [...next.groups, operation.group] };
    case 'update-group': return { ...next, groups: next.groups.map((group) => group.id === operation.group.id ? operation.group : group) };
    case 'reorder-groups': {
      const order = new Map(operation.groupIds.map((id, index) => [id, index]));
      return { ...next, groups: next.groups.map((group) => ({ ...group, order: order.get(group.id) ?? group.order })).sort((a, b) => a.order - b.order) };
    }
    case 'delete-group': {
      if (operation.deleteStocks) return { ...next, groups: next.groups.filter((group) => group.id !== operation.groupId), stocks: next.stocks.filter((stock) => stock.groupId !== operation.groupId) };
      const destination = operation.moveToGroupId;
      if (!destination) return { ...next, groups: next.groups.filter((group) => group.id !== operation.groupId), stocks: next.stocks.filter((stock) => stock.groupId !== operation.groupId) };
      const existing = next.stocks.filter((stock) => stock.groupId === destination).sort((a, b) => a.order - b.order);
      const moving = next.stocks.filter((stock) => stock.groupId === operation.groupId).sort((a, b) => a.order - b.order);
      const order = new Map([...existing, ...moving].map((stock, index) => [stock.id, index]));
      return {
        ...next,
        groups: next.groups.filter((group) => group.id !== operation.groupId),
        stocks: reindexGroup(next.stocks.map((stock) => stock.groupId === operation.groupId ? { ...stock, groupId: destination, order: order.get(stock.id) ?? stock.order } : stock), destination, [...existing, ...moving].map((stock) => stock.id)),
      };
    }
    case 'update-settings': return { ...next, settings: { ...next.settings, ...operation.settings } };
    case 'update-notification-settings': return {
      ...next,
      settings: { ...next.settings, notificationsEnabled: operation.notificationsEnabled, notificationPermission: operation.notificationPermission },
      stocks: next.stocks.map((stock) => ({ ...stock, alertLatches: { above: false, below: false }, pendingNotification: undefined, notificationFailure: undefined, pendingLimitNotification: undefined, limitNotificationFailure: undefined })),
    };
    case 'update-background': return { ...next, background: { ...next.background, ...operation.background } };
    case 'clear-notification-failure': return { ...next, stocks: next.stocks.map((stock) => stock.id === operation.stockId ? { ...stock, notificationFailure: undefined } : stock) };
    default: throw new Error('不支援的狀態操作');
  }
}

export class LocalStateAdapter implements StateAdapter {
  async load(): Promise<AppState> {
    try { return normalizeState(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')); }
    catch { return structuredClone(DEFAULT_STATE); }
  }
  async save(state: AppState): Promise<AppState> {
    const normalized = normalizeState(state);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(normalized));
    return normalized;
  }
  subscribe(listener: (state: AppState) => void): () => void {
    const handle = (event: StorageEvent) => { if (event.key === LOCAL_KEY) void this.load().then(listener); };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }
  async mutate(operation: StateOperation): Promise<AppState> { return this.save(applyOperation(await this.load(), operation)); }
}

export class ChromeStateAdapter implements StateAdapter {
  async load(): Promise<AppState> {
    const value = await chrome.storage.local.get(STATE_KEY);
    return normalizeState(value[STATE_KEY]);
  }
  async save(state: AppState): Promise<AppState> {
    const normalized = normalizeState(state);
    const response = await chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation: { type: 'replace', state: normalized } });
    if (response?.state) return normalizeState(response.state);
    throw new Error('背景服務暫時沒有回應，請重試');
  }
  async mutate(operation: StateOperation): Promise<AppState> {
    if (HISTORY_MUTATION_TYPES.has(operation.type)) await requireSalesHistoryWorker();
    const response = await chrome.runtime.sendMessage({ type: 'STATE_MUTATE', operation });
    if (response?.state) return normalizeState(response.state);
    throw new Error(response?.error ?? '背景服務暫時沒有回應，請重試');
  }
  subscribe(listener: (state: AppState) => void): () => void {
    const handle = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && changes[STATE_KEY]?.newValue) listener(normalizeState(changes[STATE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(handle);
    return () => chrome.storage.onChanged.removeListener(handle);
  }
}

async function requireSalesHistoryWorker(): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: 'STATE_CAPABILITIES' }),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Capability handshake timed out')), 1500);
      }),
    ]);
    if (!Array.isArray(response?.capabilities) || !response.capabilities.includes(SALES_HISTORY_CAPABILITY)) {
      throw new Error('Capability handshake was not supported');
    }
  } catch {
    throw new Error(SALES_HISTORY_WORKER_ERROR);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function createStateAdapter(): StateAdapter {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) ? new ChromeStateAdapter() : new LocalStateAdapter();
}

export { applyOperation, normalizeState };
