import { describe, expect, it } from 'vitest';
import { formatSignedStockPrice, formatStockPrice } from '../../src/domain/priceDisplay';

describe('stock price display precision', () => {
  it('keeps two decimals below 100 and truncates at or above 100', () => {
    expect(formatStockPrice(99.5)).toBe('99.50');
    expect(formatStockPrice(100)).toBe('100');
    expect(formatStockPrice(138.5)).toBe('138');
    expect(formatStockPrice(512_345.67)).toBe('512,345');
  });

  it('applies price precision to signed price movement without changing null or sign behavior', () => {
    expect(formatSignedStockPrice(99.5)).toBe('+99.50');
    expect(formatSignedStockPrice(-138.5)).toBe('−138');
    expect(formatSignedStockPrice(0)).toBe('±0.00');
    expect(formatSignedStockPrice(null)).toBe('—');
  });
});
