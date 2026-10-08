import type { Market } from './types';

export function formatStockPrice(value: number, market: Market): string {
  const wholePrice = market === 'TW' && Math.abs(value) >= 100;
  const displayValue = wholePrice ? Math.trunc(value) : value;
  const fractionDigits = wholePrice ? 0 : 2;
  return new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(displayValue);
}

export function formatSignedStockPrice(value: number | null, market: Market): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${formatStockPrice(Math.abs(value), market)}`;
}
