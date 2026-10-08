import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, type SaleRecord, type Stock } from '../../src/domain/types';
import { earliestSaleDate, filterSalesHistory, normalizeSalesHistory, taipeiDate, validateSale } from '../../src/domain/salesHistory';
import { applyOperation, normalizeState } from '../../src/data/storage';

function saleRecord(id: string, saleDate: string): SaleRecord {
  return {
    id,
    stock: {
      id: `stock-${id}`, market: 'TW', symbol: '2330', name: '台積電', order: 0, groupId: 'group-tw',
      averageCost: 500.125, shares: 3, gainDisplay: 'money', alert: { above: 700.75 },
    },
    originalGroupName: '台股',
    salePrice: 612.345,
    saleDate,
  };
}

function trackedStock(): Stock {
  return {
    id: 'stock-1', market: 'TW', symbol: '2330', name: '台積電', customLabel: '長期持有', order: 1, groupId: 'group-tw',
    averageCost: 500.125, shares: 3, gainDisplay: 'money', alert: { above: 700.75 }, alertLatches: { above: true, below: false },
    quoteStatus: 'live', quote: { price: 612.5, previousClose: 610, dayChange: 2.5, dayChangePercent: 2.5 / 610 * 100, timestamp: 1_800_000_000_000, status: 'live', source: 'Fugle' },
    pendingNotification: { rule: 'above', threshold: 700.75, price: 700.75, quoteTimestamp: 1_800_000_000_000 },
    notificationFailure: 'local only', pendingLimitNotification: { market: 'TW', symbol: '2330', direction: 'limit-up', price: 612.5, quoteTimestamp: 1_800_000_000_000, tradeDate: '2026-10-09' },
    limitNotificationFailure: 'local only',
  };
}

describe('sales history date helpers', () => {
  it('formats the Taiwan date and clamps the prior-year leap day', () => {
    expect(taipeiDate(new Date('2026-01-01T16:00:00.000Z'))).toBe('2026-01-02');
    expect(earliestSaleDate('2024-02-29')).toBe('2023-02-28');
    expect(earliestSaleDate('2025-02-28')).toBe('2024-02-28');
  });

  it('validates positive prices and valid, nonfuture dates inside the retained year', () => {
    expect(validateSale(0, '2026-10-09', '2026-10-09')).toMatch(/大於 0/);
    expect(validateSale(Number.NaN, '2026-10-09', '2026-10-09')).not.toBeNull();
    expect(validateSale(10, '2026-02-29', '2026-10-09')).not.toBeNull();
    expect(validateSale(10, '2026-10-10', '2026-10-09')).toMatch(/晚於今天/);
    expect(validateSale(10, '2025-10-08', '2026-10-09')).toMatch(/保留期間/);
    expect(validateSale(10, '2025-10-09', '2026-10-09')).toBeNull();
  });

  it('filters the latest 30 calendar days and selected retained months', () => {
    const records = [
      saleRecord('old', '2026-03-06'),
      saleRecord('start', '2026-03-07'),
      saleRecord('mid', '2026-03-19'),
      saleRecord('today', '2026-04-05'),
      saleRecord('previous-month', '2026-02-28'),
    ];
    expect(filterSalesHistory(records, 'recent', '2026-04-05').map((record) => record.id)).toEqual(['today', 'mid', 'start']);
    expect(filterSalesHistory(records, '2026-03', '2026-04-05').map((record) => record.id)).toEqual(['mid', 'start', 'old']);
    expect(filterSalesHistory(records, '2026-02', '2026-04-05').map((record) => record.id)).toEqual(['previous-month']);

    const firstRetainedMonth = [saleRecord('before-retention', '2025-10-08'), saleRecord('retention-start', '2025-10-09'), saleRecord('retention-month', '2025-10-31')];
    expect(filterSalesHistory(firstRetainedMonth, '2025-10', '2026-10-09').map((record) => record.id)).toEqual(['retention-month', 'retention-start']);
  });

  it('sanitizes corrupt, duplicate, future and expired records while retaining full precision', () => {
    const records = normalizeSalesHistory([
      saleRecord('good', '2026-10-09'),
      saleRecord('good', '2026-10-08'),
      saleRecord('future', '2026-10-10'),
      saleRecord('expired', '2025-10-08'),
      { ...saleRecord('bad-date', '2026-02-29') },
      { ...saleRecord('bad-price', '2026-10-09'), salePrice: 0 },
      { ...saleRecord('bad-alert', '2026-10-09'), stock: { ...saleRecord('bad-alert', '2026-10-09').stock, alert: { above: -1 } } },
    ], '2026-10-09');
    expect(records).toHaveLength(1);
    expect(records[0]?.salePrice).toBe(612.345);
    expect(records[0]?.stock.averageCost).toBe(500.125);
  });
});

describe('atomic sale operations', () => {
  it('migrates an older state without history to an empty local history', () => {
    const oldState = structuredClone(DEFAULT_STATE) as Partial<typeof DEFAULT_STATE>;
    delete oldState.salesHistory;
    expect(normalizeState(oldState).salesHistory).toEqual([]);
  });

  it('atomically snapshots the position without runtime quote or notification state', () => {
    const state = structuredClone(DEFAULT_STATE);
    state.stocks = [trackedStock()];
    const saleDate = taipeiDate();
    const sold = applyOperation(state, { type: 'sell-stock', stockId: 'stock-1', recordId: 'sale-1', salePrice: 612.345, saleDate });

    expect(state.stocks).toHaveLength(1);
    expect(state.salesHistory).toEqual([]);
    expect(sold.stocks).toEqual([]);
    expect(sold.salesHistory[0]).toEqual({
      id: 'sale-1',
      stock: {
        id: 'stock-1', market: 'TW', symbol: '2330', name: '台積電', customLabel: '長期持有', order: 1, groupId: 'group-tw',
        averageCost: 500.125, shares: 3, gainDisplay: 'money', alert: { above: 700.75 },
      },
      originalGroupName: '台股', salePrice: 612.345, saleDate,
    });
    expect(sold.salesHistory[0]?.stock).not.toHaveProperty('quote');
    expect(sold.salesHistory[0]?.stock).not.toHaveProperty('pendingNotification');
  });

  it('rejects repeated or invalid sale operations without losing an existing record', () => {
    const state = structuredClone(DEFAULT_STATE);
    state.stocks = [trackedStock()];
    const saleDate = taipeiDate();
    const sold = applyOperation(state, { type: 'sell-stock', stockId: 'stock-1', recordId: 'sale-1', salePrice: 612.345, saleDate });

    expect(() => applyOperation(sold, { type: 'sell-stock', stockId: 'stock-1', recordId: 'sale-1', salePrice: 0, saleDate })).toThrow();
    expect(sold.salesHistory).toHaveLength(1);
    expect(() => applyOperation(sold, { type: 'edit-sale', recordId: 'sale-1', salePrice: 50, saleDate: `${saleDate.slice(0, 8)}99` })).toThrow();
    expect(sold.salesHistory[0]?.salePrice).toBe(612.345);
  });

  it('requires a destination after the original group is removed and restores a clean position atomically', () => {
    const state = structuredClone(DEFAULT_STATE);
    state.settings.fugleKey = 'configured-key';
    state.stocks = [trackedStock()];
    const saleDate = taipeiDate();
    const sold = applyOperation(state, { type: 'sell-stock', stockId: 'stock-1', recordId: 'sale-1', salePrice: 612.345, saleDate });
    const withoutOriginalGroup = { ...sold, groups: sold.groups.filter((group) => group.id !== 'group-tw') };

    expect(() => applyOperation(withoutOriginalGroup, { type: 'restore-sale', recordId: 'sale-1', stockId: 'restored-1' })).toThrow(/目的分區/);
    expect(withoutOriginalGroup.salesHistory).toHaveLength(1);
    const restored = applyOperation(withoutOriginalGroup, { type: 'restore-sale', recordId: 'sale-1', stockId: 'restored-1', groupId: 'group-us' });
    expect(restored.salesHistory).toEqual([]);
    expect(restored.stocks[0]).toMatchObject({ id: 'restored-1', groupId: 'group-us', quoteStatus: 'no-trade', alertLatches: { above: false, below: false } });
    expect(restored.stocks[0]).not.toHaveProperty('quote');
    expect(restored.stocks[0]).not.toHaveProperty('pendingNotification');
    expect(restored.stocks[0]).not.toHaveProperty('pendingLimitNotification');
    expect(restored.stocks[0]).not.toHaveProperty('notificationFailure');
  });

  it('keeps the sale record when a restore ID collides with an active stock', () => {
    const state = structuredClone(DEFAULT_STATE);
    state.stocks = [trackedStock()];
    const sold = applyOperation(state, { type: 'sell-stock', stockId: 'stock-1', recordId: 'sale-1', salePrice: 612.345, saleDate: taipeiDate() });
    const occupied = { ...sold, stocks: [trackedStock()] };

    expect(() => applyOperation(occupied, { type: 'restore-sale', recordId: 'sale-1', stockId: 'stock-1' })).toThrow(/仍保留/);
    expect(occupied.salesHistory).toHaveLength(1);
    expect(occupied.stocks).toHaveLength(1);
  });

  it('uses the supplied restore ID even when the snapshot ID is already active', () => {
    const state = structuredClone(DEFAULT_STATE);
    state.stocks = [trackedStock()];
    const sold = applyOperation(state, { type: 'sell-stock', stockId: 'stock-1', recordId: 'sale-1', salePrice: 612.345, saleDate: taipeiDate() });
    const activeWithOriginalId = { ...sold, stocks: [trackedStock()] };

    const restored = applyOperation(activeWithOriginalId, { type: 'restore-sale', recordId: 'sale-1', stockId: 'restored-1' });
    expect(restored.stocks.map((stock) => stock.id)).toEqual(['stock-1', 'restored-1']);
    expect(new Set(restored.stocks.map((stock) => stock.id)).size).toBe(2);
    expect(restored.salesHistory).toEqual([]);
  });

  it('does not restore an expired record', () => {
    const state = structuredClone(DEFAULT_STATE);
    const expiredDate = new Date(`${earliestSaleDate()}T00:00:00.000Z`);
    expiredDate.setUTCDate(expiredDate.getUTCDate() - 1);
    const expiredRecord = saleRecord('expired', expiredDate.toISOString().slice(0, 10));
    state.salesHistory = [expiredRecord];

    expect(() => applyOperation(state, { type: 'restore-sale', recordId: 'expired', stockId: 'restored-1' })).toThrow(/找不到這筆售出記錄/);
    expect(state.salesHistory).toEqual([expiredRecord]);
    expect(state.stocks).toEqual([]);
  });

  it('persists retention when the prune operation runs', () => {
    const state = structuredClone(DEFAULT_STATE);
    const earliest = earliestSaleDate();
    const expiredDate = new Date(`${earliest}T00:00:00.000Z`);
    expiredDate.setUTCDate(expiredDate.getUTCDate() - 1);
    state.salesHistory = [saleRecord('expired', expiredDate.toISOString().slice(0, 10)), saleRecord('retained', earliest)];

    const pruned = applyOperation(state, { type: 'prune-sales-history' });
    expect(pruned.salesHistory.map((record) => record.id)).toEqual(['retained']);
    expect(state.salesHistory).toHaveLength(2);
  });
});
