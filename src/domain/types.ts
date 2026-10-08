export type Market = 'TW' | 'US';
export type GainDisplay = 'percent' | 'money';
export const APPEARANCE_THEMES = ['forest', 'midnight', 'sand', 'graphite', 'dusk', 'sky'] as const;
export type AppearanceTheme = typeof APPEARANCE_THEMES[number];

export function normalizeAppearanceTheme(value: unknown): AppearanceTheme {
  return APPEARANCE_THEMES.includes(value as AppearanceTheme) ? value as AppearanceTheme : 'forest';
}

export type QuoteStatus = 'live' | 'stale' | 'closed' | 'not-connected' | 'invalid-symbol' | 'credentials' | 'rate-limited' | 'network-error' | 'provider-error' | 'no-trade';

export interface PriceAlert {
  above?: number;
  below?: number;
}

export interface Quote {
  price: number;
  previousClose: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  timestamp: number;
  status: QuoteStatus;
  source: 'Fugle' | 'Finnhub';
  marketName?: string;
  isLimitUpPrice?: boolean;
  isLimitDownPrice?: boolean;
  isTrial?: boolean;
  isTradingHalted?: boolean;
  isLimitUpHalt?: boolean;
  isLimitDownHalt?: boolean;
}

export interface Stock {
  id: string;
  market: Market;
  symbol: string;
  name: string;
  order: number;
  customLabel?: string;
  groupId: string;
  averageCost?: number;
  shares?: number;
  gainDisplay: GainDisplay;
  alert: PriceAlert;
  alertLatches: { above: boolean; below: boolean };
  quote?: Quote;
  quoteStatus: QuoteStatus;
  notificationFailure?: string;
  limitNotificationFailure?: string;
  pendingNotification?: {
    rule: 'above' | 'below';
    threshold: number;
    price: number;
    quoteTimestamp: number;
  };
  pendingLimitNotification?: {
    market: 'TW';
    symbol: string;
    direction: 'limit-up' | 'limit-down';
    price: number;
    quoteTimestamp: number;
    tradeDate: string;
  };
  quoteError?: QuoteStatus;
}

export interface StockGroup {
  id: string;
  name: string;
  order: number;
}

export interface BackgroundSettings {
  selectedId: string;
  brightness: number;
}

export interface AppSettings {
  fugleKey: string;
  finnhubKey: string;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  welcomeManuallyHidden: boolean;
  limitNotificationsEnabled: boolean;
  quoteRefreshSeconds: 30 | 60 | 120 | 300;
  accountSyncEnabled: boolean;
  appearanceTheme: AppearanceTheme;
}

export interface AppState {
  version: 1;
  groups: StockGroup[];
  stocks: Stock[];
  settings: AppSettings;
  background: BackgroundSettings;
  lastRefreshAt?: number;
}

export const DEFAULT_STATE: AppState = {
  version: 1,
  groups: [
    { id: 'group-tw', name: '台股', order: 0 },
    { id: 'group-us', name: '美股', order: 1 },
  ],
  stocks: [],
  settings: {
    fugleKey: '',
    finnhubKey: '',
    notificationsEnabled: false,
    notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    welcomeManuallyHidden: false,
    limitNotificationsEnabled: true,
    quoteRefreshSeconds: 30,
    accountSyncEnabled: false,
    appearanceTheme: 'forest',
  },
  background: { selectedId: 'scene-01', brightness: 0.58 },
};
