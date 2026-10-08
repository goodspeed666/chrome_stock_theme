import type { Market, Quote, QuoteStatus } from '../domain/types';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60_000;

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
  if (response.status === 401 || response.status === 403) return new ProviderError(`${provider} 金鑰無效或沒有此 API 權限`, 'credentials');
  if (response.status === 404 || response.status === 422) return new ProviderError('找不到這個代號或目前沒有成交資料', 'invalid-symbol');
  if (response.status === 429) return new ProviderError('行情來源已達請求上限，請稍後再試', 'rate-limited', parseRetryAfter(response.headers.get('Retry-After'), now));
  return new ProviderError(`${provider} 回應錯誤（HTTP ${response.status}）`, 'provider-error');
}

function parseRetryAfter(value: string | null, now: number): number {
  const fallback = 60_000;
  const retryAfter = value?.trim();
  if (!retryAfter) return fallback;

  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (!Number.isFinite(seconds) || seconds < 0) return fallback;
    return seconds >= MAX_RETRY_AFTER_MS / 1000 ? MAX_RETRY_AFTER_MS : seconds * 1000;
  }

  const timestamp = parseHttpDate(retryAfter);
  if (timestamp === undefined) return fallback;
  const delay = timestamp - now;
  if (!Number.isFinite(timestamp) || !Number.isFinite(delay) || delay < 0) return fallback;
  return Math.min(delay, MAX_RETRY_AFTER_MS);
}

function parseHttpDate(value: string): number | undefined {
  const shortDay = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
  const longDay = '(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
  const month = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const imfDate = value.match(new RegExp(`^${shortDay}, (\\d{2}) ${month} (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`));
  const rfc850Date = value.match(new RegExp(`^${longDay}, (\\d{2})-${month}-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`));
  const asctimeDate = value.match(new RegExp(`^${shortDay} ${month} (?: (\\d)|(\\d{2})) (\\d{2}):(\\d{2}):(\\d{2}) (\\d{4})$`));
  const dateParts = imfDate ?? rfc850Date ?? asctimeDate;
  if (!dateParts) return undefined;

  const isAsctime = asctimeDate !== null;
  const isRfc850 = rfc850Date !== null;
  const weekday = dateParts[1]?.slice(0, 3);
  const monthName = isAsctime ? dateParts[2] : dateParts[3];
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthName ?? '');
  const day = Number(isAsctime ? (dateParts[3] ?? dateParts[4]) : dateParts[2]);
  const hour = Number(dateParts[5]);
  const minute = Number(dateParts[6]);
  const second = Number(dateParts[7]);
  const explicitYear = isAsctime ? dateParts[8] : isRfc850 ? undefined : dateParts[4];
  let timestamp: number;
  if (isAsctime) {
    const date = new Date(0);
    date.setUTCFullYear(Number(explicitYear), monthIndex, day);
    date.setUTCHours(hour, minute, second, 0);
    timestamp = date.getTime();
  } else {
    timestamp = Date.parse(value);
  }
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);

  return date.toUTCString().slice(0, 3) === weekday
    && date.getUTCMonth() === monthIndex
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    && (explicitYear === undefined || date.getUTCFullYear() === Number(explicitYear))
    ? timestamp
    : undefined;
}

function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;
  try { void body.cancel().catch(() => undefined); }
  catch { /* Cancellation is best effort; the bounded response error stays generic. */ }
}

function requestTimeout(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function fetchJson(url: string, headers: Record<string, string>, provider: string, now = Date.now()): Promise<unknown> {
  const signal = AbortSignal.timeout(9_000);
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch {
    const message = requestTimeout(signal) ? '行情請求逾時' : '無法連線至行情來源';
    throw new ProviderError(message, 'network-error');
  }
  if (!response.ok) throw mapHttpError(response, provider, now);

  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    cancelBody(response.body);
    throw new ProviderError('行情來源回傳的資料過大', 'provider-error');
  }
  if (!response.body) throw new ProviderError('行情來源回傳了無法讀取的資料', 'provider-error');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try { void reader.cancel().catch(() => undefined); }
        catch { /* Keep overflow handling independent of stream cancellation behavior. */ }
        throw new ProviderError('行情來源回傳的資料過大', 'provider-error');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const message = requestTimeout(signal) ? '行情請求逾時' : '無法連線至行情來源';
    throw new ProviderError(message, 'network-error');
  } finally {
    try { reader.releaseLock(); } catch { /* A failed stream can retain a pending read. */ }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ProviderError('行情來源回傳了無法讀取的資料', 'provider-error'); }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
