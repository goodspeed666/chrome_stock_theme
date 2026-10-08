import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFugleQuote, fetchFugleSymbolName, normalizeFugleQuote } from '../../src/providers/fugle';
import { fetchFinnhubQuote, fetchFinnhubSymbolName, normalizeFinnhubQuote } from '../../src/providers/finnhub';
import { fetchJson, mapHttpError, ProviderError, validatePositive } from '../../src/providers/quotes';

afterEach(() => vi.unstubAllGlobals());

describe('Fugle quote normalization', () => {
  it('uses actual lastTrade price and microsecond time, never the trial lastPrice', () => {
    const now = 1_800_000_000_000;
    const quote = normalizeFugleQuote({
      name: '台積電', lastPrice: 9999, change: 999, changePercent: 99, previousClose: 990,
      lastTrade: { price: 1001.5, time: (now - 15_000) * 1000 }, isTrial: true,
    }, now);
    expect(quote.price).toBe(1001.5);
    expect(quote.timestamp).toBe(now - 15_000);
    expect(quote.dayChange).toBe(11.5);
    expect(quote.dayChangePercent).toBeCloseTo(11.5 / 990 * 100);
    expect(quote.status).toBe('live');
    expect(quote.marketName).toBe('台積電');
  });

  it('uses referencePrice as the documented previous-close fallback and marks close data', () => {
    const now = 1_800_000_000_000;
    const quote = normalizeFugleQuote({ referencePrice: 100, lastTrade: { price: 100, time: (now - 1000) * 1000 }, isClose: true }, now);
    expect(quote.previousClose).toBe(100);
    expect(quote.status).toBe('closed');
  });

  it('preserves only strict Fugle limit-price, trial, and halt flags', () => {
    const now = 1_800_000_000_000;
    const quote = normalizeFugleQuote({
      lastTrade: { price: 100, time: (now - 1000) * 1000 },
      isLimitUpPrice: true,
      isLimitDownPrice: 'true',
      isTrial: true,
      tradingHalt: { isHalted: true },
      isLimitUpHalt: true,
      isLimitDownHalt: false,
      isLimitUpBid: true,
      isLimitDownAsk: true,
    }, now);
    expect(quote).toMatchObject({
      isLimitUpPrice: true,
      isLimitDownPrice: false,
      isTrial: true,
      isTradingHalted: true,
      isLimitUpHalt: true,
      isLimitDownHalt: false,
    });
    expect(quote.isLimitUpBid).toBeUndefined();
    expect(quote.isLimitDownAsk).toBeUndefined();
  });

  it('keeps an old actual trade visibly stale and rejects missing or invalid actual trades', () => {
    const now = 1_800_000_000_000;
    expect(normalizeFugleQuote({ lastTrade: { price: 100, time: (now - 121_000) * 1000 } }, now).status).toBe('stale');
    expect(() => normalizeFugleQuote({ lastPrice: 100, lastUpdated: (now - 1000) * 1000 }, now)).toThrowError(ProviderError);
    expect(() => normalizeFugleQuote({ lastTrade: { price: 0, time: (now - 1000) * 1000 } }, now)).toThrowError(ProviderError);
    expect(() => validatePositive(Infinity, '價格')).toThrowError(ProviderError);
  });

  it('sends Fugle credentials in the required header', async () => {
    const now = 1_800_000_000_000;
    const fetchSpy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['X-API-KEY']).toBe('private-key');
      return new Response(JSON.stringify({ lastTrade: { price: 100, time: (now - 1000) * 1000 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const quote = await fetchFugleQuote({ market: 'TW', symbol: '2330', apiKey: 'private-key' }, now);
    expect(quote.price).toBe(100);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/quote/2330');
  });
});

describe('Finnhub quote normalization', () => {
  it('normalizes c, pc, d, dp and the seconds timestamp', () => {
    const now = 1_800_000_000_000;
    const quote = normalizeFinnhubQuote({ c: 105, pc: 100, d: 5, dp: 5, t: (now - 10_000) / 1000 }, now);
    expect(quote.price).toBe(105);
    expect(quote.timestamp).toBe(now - 10_000);
    expect(quote.dayChange).toBe(5);
    expect(quote.dayChangePercent).toBe(5);
    expect(quote.status).toBe('live');
  });

  it('classifies missing prices, future times, and old quotes without inventing freshness', () => {
    const now = 1_800_000_000_000;
    expect(() => normalizeFinnhubQuote({ c: 0, pc: 100, t: now / 1000 }, now)).toThrowError(ProviderError);
    expect(() => normalizeFinnhubQuote({ c: 100, pc: 99, t: now / 1000 + 1 }, now)).toThrowError(ProviderError);
    expect(normalizeFinnhubQuote({ c: 100, pc: 99, t: (now - 121_000) / 1000 }, now).status).toBe('stale');
  });

  it('classifies HTTP errors and honors Retry-After on a provider-wide rate limit', () => {
    const now = 1_800_000_000_000;
    expect(mapHttpError(new Response('', { status: 401 }), 'Finnhub', now).status).toBe('credentials');
    expect(mapHttpError(new Response('', { status: 404 }), 'Fugle', now).status).toBe('invalid-symbol');
    const limited = mapHttpError(new Response('', { status: 429, headers: { 'Retry-After': '15' } }), 'Finnhub', now);
    expect(limited.status).toBe('rate-limited');
    expect(limited.retryAfterMs).toBe(15_000);
  });

  it('uses valid Retry-After values and falls back safely for invalid, past, or huge values', () => {
    const now = Date.UTC(2026, 9, 8, 0, 0, 0);
    expect(mapHttpError(new Response('', { status: 429, headers: { 'Retry-After': new Date(now + 2 * 60 * 60_000).toUTCString() } }), 'Finnhub', now).retryAfterMs).toBe(2 * 60 * 60_000);
    for (const value of ['Wednesday, 14-Oct-26 02:00:00 GMT', 'Wed Oct 14 02:00:00 2026']) {
      expect(mapHttpError(new Response('', { status: 429, headers: { 'Retry-After': value } }), 'Finnhub', now).retryAfterMs).toBe((6 * 24 + 2) * 60 * 60_000);
    }
    const mismatchedWeekday = new Date(now + 2 * 60 * 60_000).toUTCString().replace(/^\w+/, 'Mon');
    for (const value of ['-1', 'Infinity', 'not-a-date', new Date(now - 1000).toUTCString(), mismatchedWeekday]) {
      expect(mapHttpError(new Response('', { status: 429, headers: { 'Retry-After': value } }), 'Finnhub', now).retryAfterMs).toBe(60_000);
    }
    expect(mapHttpError(new Response('', { status: 429 }), 'Finnhub', now).retryAfterMs).toBe(60_000);
    expect(mapHttpError(new Response('', { status: 429, headers: { 'Retry-After': '999999999999999999' } }), 'Finnhub', now).retryAfterMs).toBe(7 * 24 * 60 * 60_000);
  });

  it('rejects oversized responses from the declared length and cancels the body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([123]));
        setTimeout(() => { if (!cancelled) controller.close(); }, 50);
      },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Length': String(1024 * 1024 + 1) } })));

    await expect(fetchJson('https://example.test/quote?token=fake-key', {}, 'Provider'))
      .rejects.toMatchObject({ status: 'provider-error', message: expect.stringContaining('過大') });
    expect(cancelled).toBe(true);
  });

  it.each([undefined, '1'])('counts streamed bytes even when Content-Length is %s', async (contentLength) => {
    let cancelled = false;
    let firstPull = true;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (firstPull) {
          firstPull = false;
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        } else {
          setTimeout(() => { if (!cancelled) controller.close(); }, 50);
        }
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = contentLength === undefined ? {} : { 'Content-Length': contentLength };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers })));

    await expect(fetchJson('https://example.test/quote', {}, 'Provider'))
      .rejects.toMatchObject({ status: 'provider-error', message: expect.stringContaining('過大') });
    expect(cancelled).toBe(true);
  });

  it('keeps the 9-second timeout active while a response body is stalled', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const fail = () => controller.error(timeout.signal.reason);
        if (timeout.signal.aborted) fail();
        else timeout.signal.addEventListener('abort', fail, { once: true });
      },
    });
    const fetchSpy = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const request = fetchJson('https://example.test/stalled', {}, 'Provider');
    await Promise.resolve();
    timeout.abort(new DOMException('timed out', 'TimeoutError'));

    await expect(request).rejects.toMatchObject({ status: 'network-error', message: '行情請求逾時' });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(9_000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeout.signal);
  });

  it('keeps fetch failures generic when the URL and credentials are present in the thrown error', async () => {
    const secretUrl = 'https://example.test/quote?token=fake-secret';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`Failed ${secretUrl}`); }));

    const error = await fetchJson(secretUrl, { Authorization: 'fake-secret' }, 'Provider').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).not.toContain('fake-secret');
    expect((error as Error).message).not.toContain('example.test');
  });

  it('classifies Finnhub empty ticker responses as an invalid symbol', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchFinnhubQuote({ market: 'US', symbol: 'NOTREAL', apiKey: 'private-token' })).rejects.toMatchObject({ status: 'invalid-symbol' });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('symbol=NOTREAL');
  });

  it('sends Finnhub quote credentials in the header and keeps the URL free of the key', async () => {
    const now = 1_800_000_000_000;
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ c: 100, pc: 99, t: (now - 1000) / 1000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchFinnhubQuote({ market: 'US', symbol: 'AAPL', apiKey: 'fake-secret' }, now)).resolves.toMatchObject({ price: 100 });
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain('symbol=AAPL');
    expect(url).not.toContain('fake-secret');
    expect((fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-Finnhub-Token']).toBe('fake-secret');
  });
});

describe('provider symbol-name lookups', () => {
  it('reads the documented Fugle ticker name without requesting a quote', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ date: '2026-10-08', type: 'EQUITY', exchange: 'TWSE', market: 'TSE', symbol: '2330', name: '台積電' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchFugleSymbolName({ market: 'TW', symbol: '2330', apiKey: 'private-key' })).resolves.toBe('台積電');
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/2330');
    expect((fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-API-KEY']).toBe('private-key');
  });

  it('rejects a Fugle ticker payload that identifies a different symbol or has no name', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ symbol: '0050', name: '元大台灣50' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchFugleSymbolName({ market: 'TW', symbol: '2330', apiKey: 'key' })).rejects.toMatchObject({ status: 'invalid-symbol' });
  });

  it('selects Finnhub descriptions by exact symbol rather than displaySymbol', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ count: 2, result: [
      { symbol: 'BRK.B', displaySymbol: 'BRK.B', description: 'Berkshire Hathaway Inc - Class B', type: 'Common Stock' },
      { symbol: 'BRK.B/US', displaySymbol: 'BRK.B', description: 'Different listing', type: 'Common Stock' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchFinnhubSymbolName({ market: 'US', symbol: 'brk.b', apiKey: 'private-token' })).resolves.toBe('Berkshire Hathaway Inc - Class B');
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe('https://finnhub.io/api/v1/search');
    expect(requestUrl.searchParams.get('q')).toBe('BRK.B');
    expect(requestUrl.searchParams.has('token')).toBe(false);
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('private-token');
    expect((fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-Finnhub-Token']).toBe('private-token');
  });

  it('does not accept a Finnhub result whose displaySymbol matches but symbol does not', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ count: 1, result: [
      { symbol: 'AAPL.US', displaySymbol: 'AAPL', description: 'Wrong listing', type: 'Common Stock' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchFinnhubSymbolName({ market: 'US', symbol: 'AAPL', apiKey: 'key' })).rejects.toMatchObject({ status: 'invalid-symbol' });
  });
});
