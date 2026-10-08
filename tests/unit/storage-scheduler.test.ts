import { describe, expect, it } from 'vitest';
import { applyOperation, normalizeState } from '../../src/data/storage';
import { DEFAULT_STATE, type Stock } from '../../src/domain/types';
import { applyCooldown, emptyScheduler, normalizeScheduler, reserveRequest, selectBatch, type ScheduledCandidate } from '../../src/background/scheduler';

function makeStock(id: string, groupId: string, order: number): Stock {
  return { id, groupId, order, market: 'TW', symbol: `${2330 + order}`, name: `股票${order}`, gainDisplay: 'percent', alert: { above: 100 }, alertLatches: { above: true, below: false }, quoteStatus: 'live', quote: { price: 101, previousClose: 100, dayChange: 1, dayChangePercent: 1, timestamp: 1_800_000_000_000, status: 'live', source: 'Fugle' } };
}

describe('local and worker mutation semantics', () => {
  it('patches edited fields against the latest record and preserves a quote added by the worker', () => {
    const state = { ...structuredClone(DEFAULT_STATE), stocks: [makeStock('a', 'group-tw', 0)] };
    const next = applyOperation(state, { type: 'patch-stock', stockId: 'a', patch: { averageCost: 90 } });
    expect(next.stocks[0]?.averageCost).toBe(90);
    expect(next.stocks[0]?.quote?.price).toBe(101);
  });

  it('moves and orders a card across groups without losing its alert state', () => {
    const state = { ...structuredClone(DEFAULT_STATE), stocks: [makeStock('a', 'group-tw', 0), makeStock('b', 'group-us', 0)] };
    const moved = applyOperation(state, { type: 'place-stock', stockId: 'a', groupId: 'group-us', index: 0 });
    expect(moved.stocks.find((stock) => stock.id === 'a')).toMatchObject({ groupId: 'group-us', order: 0, alertLatches: { above: true, below: false } });
    expect(moved.stocks.find((stock) => stock.id === 'b')?.order).toBe(1);
  });

  it('compacts source order after a cross-group move so the next up action works', () => {
    const state = { ...structuredClone(DEFAULT_STATE), stocks: [makeStock('first', 'group-tw', 0), makeStock('middle', 'group-tw', 1), makeStock('last', 'group-tw', 2)] };
    const moved = applyOperation(state, { type: 'place-stock', stockId: 'middle', groupId: 'group-us', index: 0 });
    expect(moved.stocks.filter((stock) => stock.groupId === 'group-tw').sort((a, b) => a.order - b.order).map((stock) => [stock.id, stock.order])).toEqual([['first', 0], ['last', 1]]);
    const movedUp = applyOperation(moved, { type: 'place-stock', stockId: 'last', groupId: 'group-tw', index: 0 });
    expect(movedUp.stocks.filter((stock) => stock.groupId === 'group-tw').sort((a, b) => a.order - b.order).map((stock) => stock.id)).toEqual(['last', 'first']);
  });

  it('resets alert latches when notification permission changes and preserves unrelated state', () => {
    const state = { ...structuredClone(DEFAULT_STATE), stocks: [makeStock('a', 'group-tw', 0)] };
    const next = applyOperation(state, { type: 'update-notification-settings', notificationsEnabled: true, notificationPermission: 'granted' });
    expect(next.settings.notificationsEnabled).toBe(true);
    expect(next.stocks[0]?.alertLatches).toEqual({ above: false, below: false });
    expect(next.stocks[0]?.quote?.price).toBe(101);
  });

  it('clears pending limit notices when global browser notifications are disabled', () => {
    const stock = {
      ...makeStock('a', 'group-tw', 0),
      pendingLimitNotification: { market: 'TW' as const, symbol: '2330', direction: 'limit-up' as const, price: 101, quoteTimestamp: 1_800_000_000_000, tradeDate: '2027-01-15' },
      limitNotificationFailure: '通知傳送失敗，請重試',
    };
    const state = { ...structuredClone(DEFAULT_STATE), stocks: [stock] };
    const next = applyOperation(state, { type: 'update-notification-settings', notificationsEnabled: false, notificationPermission: 'granted' });
    expect(next.stocks[0]?.pendingLimitNotification).toBeUndefined();
    expect(next.stocks[0]?.limitNotificationFailure).toBeUndefined();
    const permissionLost = applyOperation(state, { type: 'update-notification-settings', notificationsEnabled: true, notificationPermission: 'denied' });
    expect(permissionLost.stocks[0]?.pendingLimitNotification).toBeUndefined();
    expect(permissionLost.stocks[0]?.limitNotificationFailure).toBeUndefined();
  });

  it('normalizes missing/corrupt persisted state back to an empty TW and US portfolio', () => {
    const state = normalizeState({ version: 1, groups: [], stocks: 'not an array', settings: null, background: {} });
    expect(state.groups).toHaveLength(0);
    expect(state.stocks).toEqual([]);
    expect(state.settings.fugleKey).toBe('');
  });

  it('backfills the persistent welcome hide flag for existing v1 storage', () => {
    const oldSettings = { ...DEFAULT_STATE.settings };
    Reflect.deleteProperty(oldSettings, 'welcomeManuallyHidden');
    const oldState = { ...structuredClone(DEFAULT_STATE), settings: oldSettings };
    const normalized = normalizeState(oldState);
    expect(normalized.settings.welcomeManuallyHidden).toBe(false);

    const hidden = applyOperation(normalized, { type: 'update-settings', settings: { welcomeManuallyHidden: true } });
    expect(normalizeState(hidden).settings.welcomeManuallyHidden).toBe(true);
    const restored = applyOperation(hidden, { type: 'update-settings', settings: { welcomeManuallyHidden: false } });
    expect(normalizeState(restored).settings.welcomeManuallyHidden).toBe(false);
  });

  it('defaults limit notices on and refresh cadence to 30 seconds for old or invalid settings', () => {
    const oldSettings = { ...DEFAULT_STATE.settings } as Record<string, unknown>;
    Reflect.deleteProperty(oldSettings, 'limitNotificationsEnabled');
    Reflect.deleteProperty(oldSettings, 'quoteRefreshSeconds');
    const oldState = { ...structuredClone(DEFAULT_STATE), settings: oldSettings };
    expect(normalizeState(oldState).settings).toMatchObject({ limitNotificationsEnabled: true, quoteRefreshSeconds: 30 });

    for (const invalid of [0, 45, 600, '60', null]) {
      const malformed = { ...structuredClone(DEFAULT_STATE), settings: { ...DEFAULT_STATE.settings, quoteRefreshSeconds: invalid } };
      expect(normalizeState(malformed).settings.quoteRefreshSeconds).toBe(30);
    }

    const changed = applyOperation(normalizeState(oldState), { type: 'update-settings', settings: { quoteRefreshSeconds: 120 } });
    expect(normalizeState(changed).settings.quoteRefreshSeconds).toBe(120);
  });
});

describe('provider request budget and restart persistence', () => {
  const candidates: ScheduledCandidate[] = Array.from({ length: 60 }, (_, index) => ({ market: 'TW', symbol: `2${String(index).padStart(3, '0')}`, apiKey: 'key', key: `TW:${index}`, order: index }));

  it('caps each provider batch at 24 and fairly rotates through a large watch list', () => {
    const budget = { recentRequests: [], cooldownUntil: 0, cursor: 0 };
    const first = selectBatch(candidates, budget, 100_000);
    const second = selectBatch(candidates, budget, 130_000);
    const third = selectBatch(candidates, budget, 160_000);
    expect(first).toHaveLength(24);
    expect(second).toHaveLength(24);
    expect(third).toHaveLength(24);
    expect(first[0]?.key).toBe('TW:0');
    expect(second[0]?.key).toBe('TW:24');
    expect(third[0]?.key).toBe('TW:48');
    expect(budget.recentRequests).toHaveLength(48);
  });

  it('applies and reloads a provider-wide cooldown across a worker restart', () => {
    const now = 1_800_000_000_000;
    let scheduler = emptyScheduler();
    scheduler = applyCooldown(scheduler, 'US', now, 90_000);
    scheduler = normalizeScheduler(JSON.parse(JSON.stringify(scheduler)));
    expect(scheduler.providers.US.cooldownUntil).toBe(now + 90_000);
    expect(selectBatch(candidates.map((candidate) => ({ ...candidate, market: 'US' as const })), scheduler.providers.US, now + 60_000)).toHaveLength(0);
    expect(selectBatch(candidates.map((candidate) => ({ ...candidate, market: 'US' as const })), scheduler.providers.US, now + 91_000)).toHaveLength(24);
  });

  it('never schedules more than 50 requests inside one sliding minute', () => {
    const budget = { recentRequests: Array.from({ length: 48 }, (_, index) => 100_000 - index * 100), cooldownUntil: 0, cursor: 0 };
    const selected = selectBatch(candidates, budget, 100_000);
    expect(selected).toHaveLength(2);
    expect(budget.recentRequests).toHaveLength(50);
    expect(selectBatch(candidates, budget, 100_001)).toHaveLength(0);
    expect(selectBatch(candidates, budget, 161_000)).toHaveLength(24);
  });

  it('atomically reserves one shared request slot and reopens it after the sliding minute', () => {
    const now = 200_000;
    const budget = { recentRequests: Array.from({ length: 49 }, (_, index) => now - index * 100), cooldownUntil: 0, cursor: 0 };
    expect(reserveRequest(budget, now)).toMatchObject({ allowed: true });
    expect(budget.recentRequests).toHaveLength(50);
    expect(reserveRequest(budget, now + 1)).toMatchObject({ allowed: false, reason: 'minute-limit' });
    expect(budget.recentRequests).toHaveLength(50);
    expect(reserveRequest(budget, now + 60_001)).toMatchObject({ allowed: true });
  });

  it('denies a lookup reservation during provider cooldown without spending a request slot', () => {
    const budget = { recentRequests: [190_000], cooldownUntil: 230_000, cursor: 0 };
    expect(reserveRequest(budget, 200_000)).toMatchObject({ allowed: false, reason: 'cooldown', retryAfterMs: 30_000 });
    expect(budget.recentRequests).toEqual([190_000]);
  });
});
