import type { Market, Quote, QuoteStatus } from '../domain/types';

export class ProviderError extends Error {
  constructor(message: string, readonly status: QuoteStatus, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface QuoteRequest {
  market: Market;
  symbol: string;
  apiKey: string;
}

export type QuoteProvider = (request: QuoteRequest, now?: number) => Promise<Quote>;

export function validatePositive(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || number <= 0) throw new ProviderError(`${label} 無效`, 'provider-error');
  return number;
}

export function parseProviderTimestamp(value: unknown, unit: 'microseconds' | 'seconds' = 'seconds'): number {
  let timestamp: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    timestamp = unit === 'microseconds' ? value / 1000 : value * 1000;
  } else if (typeof value === 'string') {
    const numeric = Number(value);
    timestamp = value.trim() && Number.isFinite(numeric)
      ? (unit === 'microseconds' ? numeric / 1000 : numeric * 1000)
      : Date.parse(value);
  } else {
    timestamp = NaN;
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new ProviderError('行情來源未提供有效的成交時間', 'no-trade');
  return timestamp;
}

export function quoteStatus(timestamp: number, now: number, isClose = false): QuoteStatus {
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > 120_000) return isClose ? 'closed' : 'stale';
  return isClose ? 'closed' : 'live';
}

export function mapHttpError(response: Response, provider: string, now = Date.now()): ProviderError {
  const retryHeader = response.headers.get('Retry-After');
  let retryAfterMs: number | undefined;
  if (retryHeader) {
    const seconds = Number(retryHeader);
    retryAfterMs = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : Math.max(1000, Date.parse(retryHeader) - now);
  }
  if (response.status === 401 || response.status === 403) return new ProviderError(`${provider} 金鑰無效或沒有此 API 權限`, 'credentials');
  if (response.status === 404 || response.status === 422) return new ProviderError('找不到這個代號或目前沒有成交資料', 'invalid-symbol');
  if (response.status === 429) return new ProviderError('行情來源已達請求上限，請稍後再試', 'rate-limited', retryAfterMs);
  return new ProviderError(`${provider} 回應錯誤（HTTP ${response.status}）`, 'provider-error');
}

export async function fetchJson(url: string, headers: Record<string, string>, provider: string, now = Date.now()): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(9_000) });
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'TimeoutError' ? '行情請求逾時' : '無法連線至行情來源';
    throw new ProviderError(message, 'network-error');
  }
  if (!response.ok) throw mapHttpError(response, provider, now);
  try { return await response.json() as unknown; }
  catch { throw new ProviderError('行情來源回傳了無法讀取的資料', 'provider-error'); }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
