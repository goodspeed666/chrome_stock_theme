import { DEFAULT_STATE, type AppState } from '../domain/types';

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
    settings: {
      ...DEFAULT_STATE.settings,
      ...state.settings,
      limitNotificationsEnabled: typeof state.settings?.limitNotificationsEnabled === 'boolean' ? state.settings.limitNotificationsEnabled : true,
      quoteRefreshSeconds,
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

function applyOperation(previous: AppState, operation: StateOperation): AppState {
  const next = structuredClone(previous);
  switch (operation.type) {
    case 'replace': return normalizeState(operation.state);
    case 'add-stock': {
      const stocks = reindexGroup(next.stocks, operation.stock.groupId);
      const stock = { ...operation.stock, order: stocks.filter((candidate) => candidate.groupId === operation.stock.groupId).length };
      return { ...next, stocks: [...stocks, stock] };
    }
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

export function createStateAdapter(): StateAdapter {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) ? new ChromeStateAdapter() : new LocalStateAdapter();
}

export { applyOperation, normalizeState };
