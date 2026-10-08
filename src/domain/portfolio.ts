import type { Market, Stock } from './types';

export interface Gain {
  percent: number;
  amount: number;
  label: 'money' | 'per-share';
}

export function calculateGain(price: number, averageCost: number, shares?: number): Gain {
  if (![price, averageCost].every(Number.isFinite) || price <= 0 || averageCost <= 0) {
    throw new RangeError('價格與買入均價必須是大於 0 的有限數字');
  }
  if (shares !== undefined && (!Number.isFinite(shares) || shares <= 0)) {
    throw new RangeError('持股數量必須是大於 0 的有限數字');
  }
  const perShare = price - averageCost;
  return { percent: perShare / averageCost * 100, amount: perShare * (shares ?? 1), label: shares === undefined ? 'per-share' : 'money' };
}

export function currencyFor(market: Market): 'TWD' | 'USD' {
  return market === 'TW' ? 'TWD' : 'USD';
}

export function validateStock(stock: Pick<Stock, 'market' | 'symbol' | 'name' | 'averageCost' | 'shares' | 'alert'>): string | null {
  if (!stock.symbol.trim()) return '請輸入股票代號';
  if (!stock.name.trim()) return '請輸入股票名稱';
  if (stock.averageCost !== undefined && (!Number.isFinite(stock.averageCost) || stock.averageCost <= 0)) return '買入均價須大於 0';
  if (stock.shares !== undefined && (!Number.isFinite(stock.shares) || stock.shares <= 0)) return '持股數量須大於 0';
  const { above, below } = stock.alert;
  if (above !== undefined && (!Number.isFinite(above) || above <= 0)) return '高於提醒價格須大於 0';
  if (below !== undefined && (!Number.isFinite(below) || below <= 0)) return '低於提醒價格須大於 0';
  if (above !== undefined && below !== undefined && below >= above) return '低於提醒價格須小於高於提醒價格';
  return null;
}
