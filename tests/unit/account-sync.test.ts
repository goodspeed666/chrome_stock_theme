import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, type AppState } from '../../src/domain/types';
import {
  ACCOUNT_SYNC_MAX_BYTES,
  createAccountSyncSnapshot,
  mergeAccountSyncSnapshot,
  parseAccountSyncSnapshot,
  serializeAccountSyncSnapshot,
} from '../../src/data/accountSync';

function sampleState(): AppState {
  return {
    ...structuredClone(DEFAULT_STATE),
    groups: [{ id: 'group-tw', name: '台股自選', order: 0 }],
    settings: {
      ...DEFAULT_STATE.settings,
      fugleKey: 'do-not-sync-fugle-secret',
      finnhubKey: 'do-not-sync-finnhub-secret',
      notificationsEnabled: true,
      notificationPermission: 'granted',
      accountSyncEnabled: true,
    },
    background: { selectedId: 'custom', brightness: 0.7 },
    stocks: [{
      id: '550e8400-e29b-41d4-a716-446655440001', market: 'TW', symbol: '2330', name: '台積電', customLabel: '主力', order: 0,
      groupId: 'group-tw', averageCost: 500, shares: 20, gainDisplay: 'money', alert: { above: 700 },
      alertLatches: { above: true, below: false }, quoteStatus: 'live',
      quote: { price: 600, previousClose: 590, dayChange: 10, dayChangePercent: 10 / 590 * 100, timestamp: 1_800_000_000_000, status: 'live', source: 'Fugle' },
      pendingNotification: { rule: 'above', threshold: 700, price: 700, quoteTimestamp: 1_800_000_000_000 },
      notificationFailure: 'local only',
      pendingLimitNotification: { market: 'TW', symbol: '2330', direction: 'limit-up', price: 600, quoteTimestamp: 1_800_000_000_000, tradeDate: '2027-01-15' },
      limitNotificationFailure: 'local limit only',
    }],
  };
}

describe('Chrome account sync snapshots', () => {
  it('exports only the allowlisted portfolio and safe preferences', () => {
    const snapshot = createAccountSyncSnapshot(sampleState(), { deviceId: 'device-a', revision: 4, updatedAt: 1_800_000_000_000 });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.stocks[0]).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440001', market: 'TW', symbol: '2330', name: '台積電', customLabel: '主力', order: 0,
      groupId: 'group-tw', averageCost: 500, shares: 20, gainDisplay: 'money', alert: { above: 700 },
    });
    expect(snapshot.settings).toEqual({ welcomeManuallyHidden: false, limitNotificationsEnabled: true, quoteRefreshSeconds: 30 });
    expect(snapshot.background).toEqual({ selectedId: 'scene-01', brightness: 0.58 });
    for (const secretOrLocalOnly of ['do-not-sync-fugle-secret', 'do-not-sync-finnhub-secret', 'notificationsEnabled', 'notificationPermission', '"quote":', 'pendingNotification', 'alertLatches', '"selectedId":"custom"']) {
      expect(serialized).not.toContain(secretOrLocalOnly);
    }
  });

  it('validates the snapshot graph and strips unknown or sensitive fields on import', () => {
    const snapshot = createAccountSyncSnapshot(sampleState(), { deviceId: 'device-a', revision: 1, updatedAt: 10 });
    const withUnknowns = {
      ...snapshot,
      fugleKey: 'remote secret',
      stocks: [{ ...snapshot.stocks[0], quote: { price: 999 }, finnhubKey: 'remote secret' }],
    };

    const parsed = parseAccountSyncSnapshot(withUnknowns);
    expect(parsed?.stocks[0]).not.toHaveProperty('quote');
    expect(parsed?.stocks[0]).not.toHaveProperty('finnhubKey');
    expect(parsed).not.toHaveProperty('fugleKey');
    expect(parseAccountSyncSnapshot({ ...snapshot, stocks: [{ ...snapshot.stocks[0], groupId: 'missing' }] })).toBeNull();
    expect(parseAccountSyncSnapshot({ ...snapshot, stocks: [{ ...snapshot.stocks[0], averageCost: -1 }] })).toBeNull();
    expect(parseAccountSyncSnapshot({ ...snapshot, settings: { ...snapshot.settings, quoteRefreshSeconds: 45 } })).toBeNull();
  });

  it('accepts an empty alert and rejects empty IDs or string intervals', () => {
    const state = sampleState();
    state.stocks[0]!.alert = {};
    const snapshot = createAccountSyncSnapshot(state, { deviceId: 'device-a', revision: 1, updatedAt: 10 });

    expect(parseAccountSyncSnapshot(snapshot)?.stocks[0]?.alert).toEqual({});
    expect(parseAccountSyncSnapshot({ ...snapshot, settings: { ...snapshot.settings, quoteRefreshSeconds: '30' } })).toBeNull();
    expect(parseAccountSyncSnapshot({ ...snapshot, groups: [{ id: '', name: '外部', order: 0 }] })).toBeNull();
    expect(parseAccountSyncSnapshot({ ...snapshot, stocks: [{ ...snapshot.stocks[0], id: '' }] })).toBeNull();
  });

  it('merges synced fields while retaining local credentials and matching local runtime quotes', () => {
    const local = sampleState();
    const remoteSource = structuredClone(local);
    remoteSource.stocks[0]!.customLabel = '遠端名稱';
    remoteSource.stocks[0]!.alert = { below: 550 };
    remoteSource.settings.limitNotificationsEnabled = false;
    remoteSource.settings.quoteRefreshSeconds = 120;
    remoteSource.background = { selectedId: 'scene-02', brightness: 0.45 };
    const remote = createAccountSyncSnapshot(remoteSource, { deviceId: 'device-b', revision: 8, updatedAt: 20 });

    const merged = mergeAccountSyncSnapshot(local, remote);

    expect(merged.settings.fugleKey).toBe('do-not-sync-fugle-secret');
    expect(merged.settings.finnhubKey).toBe('do-not-sync-finnhub-secret');
    expect(merged.settings.notificationPermission).toBe('granted');
    expect(merged.settings.notificationsEnabled).toBe(true);
    expect(merged.settings.accountSyncEnabled).toBe(true);
    expect(merged.settings.limitNotificationsEnabled).toBe(false);
    expect(merged.settings.quoteRefreshSeconds).toBe(120);
    expect(merged.background).toEqual({ selectedId: 'custom', brightness: 0.7 });
    expect(merged.stocks[0]).toMatchObject({ customLabel: '遠端名稱', quote: local.stocks[0]!.quote, quoteStatus: 'live' });
    expect(merged.stocks[0]!.alertLatches).toEqual({ above: false, below: false });
    expect(merged.stocks[0]!.pendingNotification).toBeUndefined();
    expect(merged.stocks[0]!.notificationFailure).toBeUndefined();
    expect(merged.stocks[0]!.pendingLimitNotification).toBeUndefined();
    expect(merged.stocks[0]!.limitNotificationFailure).toBeUndefined();

    const builtInLocal = { ...local, background: { selectedId: 'scene-01', brightness: 0.58 } };
    expect(mergeAccountSyncSnapshot(builtInLocal, remote).background).toEqual({ selectedId: 'scene-02', brightness: 0.45 });
  });

  it('rejects oversize snapshots without truncating them', () => {
    const state = sampleState();
    state.stocks = Array.from({ length: 60 }, (_, index) => ({
      ...state.stocks[0]!, id: `stock-${index}`, symbol: String(1000 + index), name: '股票'.repeat(50), order: index,
      quote: undefined, pendingNotification: undefined, notificationFailure: undefined,
    }));
    const snapshot = createAccountSyncSnapshot(state, { deviceId: 'device-a', revision: 1, updatedAt: 10 });

    expect(() => serializeAccountSyncSnapshot(snapshot)).toThrow(/同步內容超過容量限制/);
    expect(ACCOUNT_SYNC_MAX_BYTES).toBeLessThan(8 * 1024);
    expect(snapshot.stocks).toHaveLength(60);
  });
});
