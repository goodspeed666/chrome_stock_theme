import { describe, expect, it } from 'vitest';
import { evaluateAlerts, resetAlertLatches } from '../../src/domain/alerts';
import type { Quote, Stock } from '../../src/domain/types';

function makeStock(override: Partial<Stock> = {}): Stock {
  return {
    id: 'stock-a', market: 'TW', symbol: '2330', name: '台積電', order: 0, groupId: 'group-tw', gainDisplay: 'percent',
    alert: { above: 100 }, alertLatches: { above: false, below: false }, quoteStatus: 'live', ...override,
  };
}

function quote(price: number, timestamp: number): Quote {
  return { price, previousClose: 99, dayChange: price - 99, dayChangePercent: (price - 99) / 99 * 100, timestamp, status: 'live', source: 'Fugle' };
}

describe('persistent alert latch state machine', () => {
  it('fires on first matching quote, holds through continuous matches, and rearms below equality', () => {
    const values = [99, 100, 101, 102, 100, 101];
    const base = 1_800_000_000_000;
    let stock = makeStock();
    const fired: number[] = [];
    values.forEach((price, index) => {
      const timestamp = base + index * 1000;
      const result = evaluateAlerts(stock, price, timestamp, timestamp);
      fired.push(...result.events.map((event) => event.price));
      stock = { ...result.stock, quote: quote(price, timestamp) };
    });
    expect(fired).toEqual([101, 101]);
    expect(stock.alertLatches.above).toBe(true);
  });

  it('fires when the first valid quote already satisfies the condition', () => {
    const now = 1_800_000_000_000;
    expect(evaluateAlerts(makeStock(), 101, now, now).events).toHaveLength(1);
  });

  it('uses strict comparison for a lower bound and equality rearms without firing', () => {
    const now = 1_800_000_000_000;
    let stock = makeStock({ alert: { below: 100 } });
    const first = evaluateAlerts(stock, 99, now, now);
    expect(first.events).toHaveLength(1);
    stock = { ...first.stock, quote: quote(99, now) };
    const held = evaluateAlerts(stock, 98, now + 1000, now + 1000);
    expect(held.events).toHaveLength(0);
    const equal = evaluateAlerts({ ...held.stock, quote: quote(98, now + 1000) }, 100, now + 2000, now + 2000);
    expect(equal.events).toHaveLength(0);
    expect(equal.stock.alertLatches.below).toBe(false);
  });

  it('does not fire or reset for errors, stale, invalid, future, duplicate, or out-of-order quotes', () => {
    const base = 1_800_000_000_000;
    const quoteBefore = quote(101, base);
    const stock = makeStock({ alertLatches: { above: true, below: false }, quote: quoteBefore });
    const invalidResults = [
      evaluateAlerts(stock, 90, base + 1000, base + 1000, 'network-error'),
      evaluateAlerts(stock, 90, base - 121_000, base, 'stale'),
      evaluateAlerts(stock, 0, base + 1000, base + 1000, 'live'),
      evaluateAlerts(stock, 110, base + 2_000, base + 1000, 'live'),
      evaluateAlerts(stock, 110, base, base + 1000, 'live'),
      evaluateAlerts(stock, 110, base - 1000, base + 1000, 'live'),
    ];
    for (const result of invalidResults) {
      expect(result.events).toHaveLength(0);
      expect(result.stock.alertLatches.above).toBe(true);
    }
  });

  it('re-arms both rules when the user edits alert thresholds', () => {
    const updated = resetAlertLatches(makeStock({ alertLatches: { above: true, below: true } }), { above: 105, below: 90 });
    expect(updated).toEqual({ alert: { above: 105, below: 90 }, alertLatches: { above: false, below: false } });
  });
});
