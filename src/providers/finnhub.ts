import type { Quote } from '../domain/types';
import { fetchJson, isRecord, parseProviderTimestamp, ProviderError, quoteStatus, validatePositive, type QuoteRequest } from './quotes';

const ENDPOINT = 'https://finnhub.io/api/v1/quote';
const SEARCH_ENDPOINT = 'https://finnhub.io/api/v1/search';

export function normalizeFinnhubSymbolName(payload: unknown, requestedSymbol: string): string {
  const symbol = requestedSymbol.trim().toUpperCase();
  if (!isRecord(payload) || !Array.isArray(payload.result)) throw new ProviderError('Finnhub 回傳格式錯誤', 'provider-error');
  const exactMatch = payload.result.find((item) => isRecord(item)
    && typeof item.symbol === 'string'
    && item.symbol.trim().toUpperCase() === symbol
    && typeof item.description === 'string'
    && item.description.trim());
  if (!isRecord(exactMatch) || typeof exactMatch.description !== 'string') throw new ProviderError('找不到這個美股代號', 'invalid-symbol');
  return exactMatch.description.trim();
}

export async function fetchFinnhubSymbolName(request: QuoteRequest, now = Date.now()): Promise<string> {
  if (request.market !== 'US') throw new ProviderError('Finnhub 僅支援美股', 'provider-error');
  if (!request.apiKey.trim()) throw new ProviderError('尚未連接行情', 'not-connected');
  const query = new URLSearchParams({ q: request.symbol.trim().toUpperCase() });
  const payload = await fetchJson(`${SEARCH_ENDPOINT}?${query.toString()}`, { 'X-Finnhub-Token': request.apiKey.trim(), Accept: 'application/json' }, 'Finnhub', now);
  return normalizeFinnhubSymbolName(payload, request.symbol);
}

export function normalizeFinnhubQuote(payload: unknown, now = Date.now()): Quote {
  if (!isRecord(payload)) throw new ProviderError('Finnhub 回傳格式錯誤', 'provider-error');
  const price = validatePositive(payload.c, '目前價格');
  const previousClose = payload.pc === undefined || payload.pc === null ? null : validatePositive(payload.pc, '前收盤價');
  const timestamp = parseProviderTimestamp(payload.t, 'seconds');
  if (timestamp > now) throw new ProviderError('行情來源的報價時間在未來', 'no-trade');
  return {
    price,
    previousClose,
    dayChange: previousClose === null ? (typeof payload.d === 'number' && Number.isFinite(payload.d) ? payload.d : null) : price - previousClose,
    dayChangePercent: previousClose === null ? (typeof payload.dp === 'number' && Number.isFinite(payload.dp) ? payload.dp : null) : (price - previousClose) / previousClose * 100,
    timestamp,
    status: quoteStatus(timestamp, now),
    source: 'Finnhub',
  };
}

export async function fetchFinnhubQuote(request: QuoteRequest, now = Date.now()): Promise<Quote> {
  if (request.market !== 'US') throw new ProviderError('Finnhub 僅支援美股', 'provider-error');
  if (!request.apiKey.trim()) throw new ProviderError('尚未連接行情', 'not-connected');
  const query = new URLSearchParams({ symbol: request.symbol.trim().toUpperCase() });
  const payload = await fetchJson(`${ENDPOINT}?${query.toString()}`, { 'X-Finnhub-Token': request.apiKey.trim(), Accept: 'application/json' }, 'Finnhub', now);
  if (isRecord(payload) && (typeof payload.error === 'string' || (payload.c === 0 && payload.t === 0))) {
    throw new ProviderError('找不到這個代號或目前沒有報價', 'invalid-symbol');
  }
  return normalizeFinnhubQuote(payload, now);
}
