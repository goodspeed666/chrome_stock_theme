import { describe, expect, it } from 'vitest';
import { formatSignedStockPrice, formatStockPrice } from '../../src/domain/priceDisplay';

describe('stock price display precision', () => {
  it('keeps Taiwan prices at two decimals below 100 and truncates at or above 100', () => {
    expect(formatStockPrice(99.5, 'TW')).toBe('99.50');
    expect(formatStockPrice(100, 'TW')).toBe('100');
    expect(formatStockPrice(138.5, 'TW')).toBe('138');
    expect(formatStockPrice(512_345.67, 'TW')).toBe('512,345');
  });

  it('always keeps two decimals for US prices at or above 100', () => {
    expect(formatStockPrice(138.5, 'US')).toBe('138.50');
    expect(formatStockPrice(512_345.67, 'US')).toBe('512,345.67');
  });

  it('applies market-specific precision to signed price movement without changing null or sign behavior', () => {
    expect(formatSignedStockPrice(99.5, 'TW')).toBe('+99.50');
    expect(formatSignedStockPrice(-138.5, 'TW')).toBe('−138');
    expect(formatSignedStockPrice(-138.5, 'US')).toBe('−138.50');
    expect(formatSignedStockPrice(0, 'US')).toBe('±0.00');
    expect(formatSignedStockPrice(null, 'US')).toBe('—');
  });
});
