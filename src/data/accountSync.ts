import { APPEARANCE_THEMES, DEFAULT_STATE, type AppState, type AppearanceTheme, type BackgroundSettings, type GainDisplay, type Market, type PriceAlert, type Stock, type StockGroup } from '../domain/types';

export const ACCOUNT_SYNC_KEY = 'stockDesktopAccountSync.v1';
export const ACCOUNT_SYNC_META_KEY = 'stockDesktopAccountSyncMeta.v1';
export const ACCOUNT_SYNC_MAX_BYTES = 7_000;

export interface AccountSyncVersion {
  revision: number;
  deviceId: string;
  updatedAt: number;
}

export interface SyncStock {
  id: string;
  market: Market;
  symbol: string;
  name: string;
  customLabel?: string;
  order: number;
  groupId: string;
  averageCost?: number;
  shares?: number;
  gainDisplay: GainDisplay;
  alert: PriceAlert;
}

export interface AccountSyncSnapshot extends AccountSyncVersion {
  version: 1;
  groups: StockGroup[];
  stocks: SyncStock[];
  settings: Pick<AppState['settings'], 'welcomeManuallyHidden' | 'limitNotificationsEnabled' | 'quoteRefreshSeconds' | 'appearanceTheme'>;
  background: BackgroundSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || Boolean(value.trim()));
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isOrder(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safeAlert(value: unknown): PriceAlert | null {
  if (!isRecord(value)) return null;
  const result: PriceAlert = {};
  for (const key of ['above', 'below'] as const) {
    if (value[key] === undefined) continue;
    if (!isPositiveFinite(value[key])) return null;
    result[key] = value[key];
  }
  return result;
}

function safeGroups(value: unknown): StockGroup[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const ids = new Set<string>();
  const groups: StockGroup[] = [];
  for (const item of value) {
    if (!isRecord(item) || !safeText(item.id, 100) || !safeText(item.name, 80) || !isOrder(item.order) || ids.has(item.id)) return null;
    ids.add(item.id);
    groups.push({ id: item.id, name: item.name, order: item.order });
  }
  return groups;
}

function safeStocks(value: unknown, groupIds: Set<string>): SyncStock[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const ids = new Set<string>();
  const stocks: SyncStock[] = [];
  for (const item of value) {
    if (!isRecord(item)
      || !safeText(item.id, 100)
      || !safeText(item.symbol, 24)
      || !safeText(item.name, 120)
      || !isOrder(item.order)
      || !safeText(item.groupId, 100)
      || !groupIds.has(item.groupId)
      || ids.has(item.id)
      || (item.market !== 'TW' && item.market !== 'US')
      || (item.gainDisplay !== 'percent' && item.gainDisplay !== 'money')) return null;
    if (item.customLabel !== undefined && !safeText(item.customLabel, 120, true)) return null;
    if (item.averageCost !== undefined && !isPositiveFinite(item.averageCost)) return null;
    if (item.shares !== undefined && !isPositiveFinite(item.shares)) return null;
    const alert = safeAlert(item.alert);
    if (!alert) return null;
    ids.add(item.id);
    stocks.push({
      id: item.id,
      market: item.market,
      symbol: item.symbol.trim().toUpperCase(),
      name: item.name,
      ...(typeof item.customLabel === 'string' ? { customLabel: item.customLabel } : {}),
      order: item.order,
      groupId: item.groupId,
      ...(typeof item.averageCost === 'number' ? { averageCost: item.averageCost } : {}),
      ...(typeof item.shares === 'number' ? { shares: item.shares } : {}),
      gainDisplay: item.gainDisplay,
      alert,
    });
  }
  return stocks;
}

function isBuiltInBackgroundId(value: unknown): value is string {
  return typeof value === 'string' && /^scene-(?:0[1-9]|10)$/.test(value);
}

function portableData(state: AppState, fallbackBackground?: BackgroundSettings) {
  const background = isBuiltInBackgroundId(state.background.selectedId) ? state.background : fallbackBackground;
  return {
    groups: state.groups.map(({ id, name, order }) => ({ id, name, order })),
    stocks: state.stocks.map(({ id, market, symbol, name, customLabel, order, groupId, averageCost, shares, gainDisplay, alert }) => ({
      id, market, symbol: symbol.trim().toUpperCase(), name, ...(customLabel !== undefined ? { customLabel } : {}), order, groupId,
      ...(averageCost !== undefined ? { averageCost } : {}), ...(shares !== undefined ? { shares } : {}), gainDisplay,
      alert: { ...(alert.above !== undefined ? { above: alert.above } : {}), ...(alert.below !== undefined ? { below: alert.below } : {}) },
    })),
    settings: {
      welcomeManuallyHidden: state.settings.welcomeManuallyHidden,
      limitNotificationsEnabled: state.settings.limitNotificationsEnabled,
      quoteRefreshSeconds: state.settings.quoteRefreshSeconds,
      appearanceTheme: state.settings.appearanceTheme,
    },
    background: {
      selectedId: background && isBuiltInBackgroundId(background.selectedId) ? background.selectedId : DEFAULT_STATE.background.selectedId,
      brightness: Number.isFinite(background?.brightness) ? Math.min(1, Math.max(0, background!.brightness)) : DEFAULT_STATE.background.brightness,
    },
  };
}

export function createAccountSyncSnapshot(state: AppState, version: AccountSyncVersion, fallbackBackground?: BackgroundSettings): AccountSyncSnapshot {
  return { version: 1, ...version, ...portableData(state, fallbackBackground) };
}

export function parseAccountSyncSnapshot(value: unknown): AccountSyncSnapshot | null {
  if (!isRecord(value) || value.version !== 1
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !safeText(value.deviceId, 128)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return null;
  const groups = safeGroups(value.groups);
  if (!groups) return null;
  const groupIds = new Set(groups.map((group) => group.id));
  const stocks = safeStocks(value.stocks, groupIds);
  if (!stocks) return null;
  const settings = value.settings;
  if (!isRecord(settings) || typeof settings.welcomeManuallyHidden !== 'boolean'
    || typeof settings.limitNotificationsEnabled !== 'boolean'
    || typeof settings.quoteRefreshSeconds !== 'number' || ![30, 60, 120, 300].includes(settings.quoteRefreshSeconds)) return null;
  const appearanceTheme: unknown = Object.hasOwn(settings, 'appearanceTheme') ? settings.appearanceTheme : 'forest';
  if (!APPEARANCE_THEMES.includes(appearanceTheme as AppearanceTheme)) return null;
  const background = value.background;
  if (!isRecord(background) || !isBuiltInBackgroundId(background.selectedId)
    || typeof background.brightness !== 'number' || !Number.isFinite(background.brightness)
    || background.brightness < 0 || background.brightness > 1) return null;

  return {
    version: 1,
    revision: Number(value.revision),
    deviceId: value.deviceId,
    updatedAt: value.updatedAt,
    groups,
    stocks,
    settings: {
      welcomeManuallyHidden: settings.welcomeManuallyHidden,
      limitNotificationsEnabled: settings.limitNotificationsEnabled,
      quoteRefreshSeconds: settings.quoteRefreshSeconds as AccountSyncSnapshot['settings']['quoteRefreshSeconds'],
      appearanceTheme: appearanceTheme as AppearanceTheme,
    },
    background: { selectedId: background.selectedId, brightness: background.brightness },
  };
}

export function serializeAccountSyncSnapshot(snapshot: AccountSyncSnapshot): string {
  const safe = parseAccountSyncSnapshot(snapshot);
  if (!safe) throw new Error('同步資料格式無法驗證。');
  const serialized = JSON.stringify(safe);
  const bytes = new TextEncoder().encode(`${ACCOUNT_SYNC_KEY}${serialized}`).byteLength;
  if (bytes > ACCOUNT_SYNC_MAX_BYTES) throw new Error('同步內容超過容量限制，請刪除部分股票或縮短名稱後再試。');
  return serialized;
}

function sameAlert(left: PriceAlert, right: PriceAlert) {
  return left.above === right.above && left.below === right.below;
}

export function mergeAccountSyncSnapshot(local: AppState, input: AccountSyncSnapshot): AppState {
  const snapshot = parseAccountSyncSnapshot(input);
  if (!snapshot) throw new Error('同步資料格式無法驗證。');
  const stocks: Stock[] = snapshot.stocks.map((synced) => {
    const current = local.stocks.find((stock) => stock.id === synced.id
      && stock.market === synced.market && stock.symbol.toUpperCase() === synced.symbol.toUpperCase());
    const alertsUnchanged = current ? sameAlert(current.alert, synced.alert) : false;
    const next: Stock = {
      ...synced,
      alertLatches: alertsUnchanged ? current!.alertLatches : { above: false, below: false },
      quoteStatus: current?.quoteStatus ?? ((synced.market === 'TW' ? local.settings.fugleKey : local.settings.finnhubKey).trim() ? 'no-trade' : 'not-connected'),
      ...(current?.quote ? { quote: current.quote } : {}),
      ...(current?.quoteError ? { quoteError: current.quoteError } : {}),
      ...(alertsUnchanged && current?.notificationFailure ? { notificationFailure: current.notificationFailure } : {}),
      ...(alertsUnchanged && current?.pendingNotification ? { pendingNotification: current.pendingNotification } : {}),
      ...(snapshot.settings.limitNotificationsEnabled && current?.limitNotificationFailure ? { limitNotificationFailure: current.limitNotificationFailure } : {}),
      ...(snapshot.settings.limitNotificationsEnabled && current?.pendingLimitNotification ? { pendingLimitNotification: current.pendingLimitNotification } : {}),
    };
    return next;
  });
  return {
    ...local,
    groups: snapshot.groups,
    stocks,
    settings: {
      ...local.settings,
      ...snapshot.settings,
      accountSyncEnabled: true,
    },
    background: local.background.selectedId === 'custom' ? local.background : snapshot.background,
  };
}

export function accountSyncDataKey(state: AppState, fallbackBackground?: BackgroundSettings): string {
  return JSON.stringify(portableData(state, fallbackBackground));
}

export function hasAccountSyncData(state: AppState, fallbackBackground?: BackgroundSettings): boolean {
  return accountSyncDataKey(state, fallbackBackground) !== accountSyncDataKey(structuredClone(DEFAULT_STATE));
}

export function compareAccountSyncVersions(left: AccountSyncVersion, right: AccountSyncVersion): number {
  if (left.revision !== right.revision) return left.revision > right.revision ? 1 : -1;
  const deviceOrder = left.deviceId.localeCompare(right.deviceId);
  if (deviceOrder !== 0) return deviceOrder;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? 1 : -1;
  return 0;
}
