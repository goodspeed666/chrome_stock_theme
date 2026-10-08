import { describe, expect, it } from 'vitest';
import { isNewerQuote } from '../../src/domain/quoteFreshness';

describe('quote timestamp ordering', () => {
  it('accepts the first quote and only newer timestamps', () => {
    expect(isNewerQuote(undefined, { timestamp: 100 })).toBe(true);
    expect(isNewerQuote({ timestamp: 100 }, { timestamp: 101 })).toBe(true);
    expect(isNewerQuote({ timestamp: 100 }, { timestamp: 100 })).toBe(false);
    expect(isNewerQuote({ timestamp: 100 }, { timestamp: 99 })).toBe(false);
    expect(isNewerQuote({ timestamp: 100 }, { timestamp: Number.NaN })).toBe(false);
  });
});
