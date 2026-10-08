import { describe, expect, it } from 'vitest';
import { calculateGain, currencyFor, validateStock } from '../../src/domain/portfolio';
import type { Stock } from '../../src/domain/types';

describe('portfolio calculations', () => {
  it('calculates a five-share gain in percent and native currency', () => {
    expect(calculateGain(110, 100, 5)).toEqual({ percent: 10, amount: 50, label: 'money' });
  });

  it('labels a missing quantity as a per-share difference', () => {
    expect(calculateGain(90, 100)).toEqual({ percent: -10, amount: -10, label: 'per-share' });
  });

  it('supports fractional US shares without converting currencies', () => {
    expect(calculateGain(120, 100, 0.25)).toEqual({ percent: 20, amount: 5, label: 'money' });
    expect(currencyFor('TW')).toBe('TWD');
    expect(currencyFor('US')).toBe('USD');
  });

  it.each([[0, 100, 1], [100, 0, 1], [100, 100, 0], [-1, 100, 2], [100, 100, Number.NaN]])('rejects invalid financial values %j', (price, cost, shares) => {
    expect(() => calculateGain(price, cost, shares)).toThrow(RangeError);
  });

  it('validates alert bounds and only accepts positive optional holdings', () => {
    const value: Pick<Stock, 'market' | 'symbol' | 'name' | 'averageCost' | 'shares' | 'alert'> = { market: 'TW', symbol: '2330', name: '台積電', averageCost: 900, shares: 5, alert: { below: 800, above: 1000 } };
    expect(validateStock(value)).toBeNull();
    expect(validateStock({ ...value, alert: { below: 1000, above: 1000 } })).toContain('低於提醒價格');
    expect(validateStock({ ...value, averageCost: 0 })).toContain('買入均價');
    expect(validateStock({ ...value, shares: -2 })).toContain('持股數量');
  });
});
