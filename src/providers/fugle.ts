import type { Quote } from '../domain/types';
import { fetchJson, isRecord, parseProviderTimestamp, ProviderError, quoteStatus, validatePositive, type QuoteRequest } from './quotes';

const ENDPOINT = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/';
const TICKER_ENDPOINT = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/';

export function normalizeFugleSymbolName(payload: unknown, requestedSymbol: string): string {
  const symbol = requestedSymbol.trim().toUpperCase();
  if (!isRecord(payload) || typeof payload.symbol !== 'string' || payload.symbol.trim().toUpperCase() !== symbol) {
    throw new ProviderError('找不到這個台股代號', 'invalid-symbol');
  }
  if (typeof payload.name !== 'string' || !payload.name.trim()) throw new ProviderError('行情來源未提供股票名稱', 'invalid-symbol');
  return payload.name.trim();
}

export async function fetchFugleSymbolName(request: QuoteRequest, now = Date.now()): Promise<string> {
  if (request.market !== 'TW') throw new ProviderError('Fugle 僅支援台股', 'provider-error');
  if (!request.apiKey.trim()) throw new ProviderError('尚未連接行情', 'not-connected');
  const symbol = request.symbol.trim().toUpperCase();
  const payload = await fetchJson(`${TICKER_ENDPOINT}${encodeURIComponent(symbol)}`, { 'X-API-KEY': request.apiKey.trim(), Accept: 'application/json' }, 'Fugle', now);
  return normalizeFugleSymbolName(payload, symbol);
}

export function normalizeFugleQuote(payload: unknown, now = Date.now()): Quote {
  if (!isRecord(payload)) throw new ProviderError('Fugle 回傳格式錯誤', 'provider-error');
  const trade = isRecord(payload.lastTrade) ? payload.lastTrade : null;
  if (!trade) throw new ProviderError('目前沒有可用的成交資料', 'no-trade');

  // Fugle 的 lastPrice/change 欄位可能是 trial price；只用 lastTrade 成交價與時間配對。
  const price = validatePositive(trade.price, '成交價');
  const timestamp = parseProviderTimestamp(trade.time, 'microseconds');
  if (timestamp > now) throw new ProviderError('行情來源的成交時間在未來', 'no-trade');
  const previousCloseValue = payload.previousClose ?? payload.referencePrice;
  const previousClose = previousCloseValue === undefined || previousCloseValue === null ? null : validatePositive(previousCloseValue, '昨收價');
  const isClose = payload.isClose === true;
  const tradingHalt = isRecord(payload.tradingHalt) ? payload.tradingHalt : null;
  return {
    price,
    previousClose,
    dayChange: previousClose === null ? null : price - previousClose,
    dayChangePercent: previousClose === null ? null : (price - previousClose) / previousClose * 100,
    timestamp,
    status: quoteStatus(timestamp, now, isClose),
    source: 'Fugle',
    marketName: typeof payload.name === 'string' ? payload.name : undefined,
    isLimitUpPrice: payload.isLimitUpPrice === true,
    isLimitDownPrice: payload.isLimitDownPrice === true,
    isTrial: payload.isTrial === true,
    isTradingHalted: tradingHalt?.isHalted === true,
    isLimitUpHalt: payload.isLimitUpHalt === true,
    isLimitDownHalt: payload.isLimitDownHalt === true,
  };
}

export async function fetchFugleQuote(request: QuoteRequest, now = Date.now()): Promise<Quote> {
  if (request.market !== 'TW') throw new ProviderError('Fugle 僅支援台股', 'provider-error');
  if (!request.apiKey.trim()) throw new ProviderError('尚未連接行情', 'not-connected');
  const symbol = encodeURIComponent(request.symbol.trim().toUpperCase());
  const payload = await fetchJson(`${ENDPOINT}${symbol}`, { 'X-API-KEY': request.apiKey.trim(), Accept: 'application/json' }, 'Fugle', now);
  return normalizeFugleQuote(payload, now);
}
