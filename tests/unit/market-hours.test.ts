import { describe, expect, it } from 'vitest';
import { isMarketSessionOpen, shouldHideWelcome } from '../../src/domain/marketHours';

const at = (value: string) => new Date(value);

describe('2026 market sessions', () => {
  it('opens and closes the Taipei core session at the exact boundaries', () => {
    expect(isMarketSessionOpen('TW', at('2026-10-08T00:59:59Z'))).toBe(false);
    expect(isMarketSessionOpen('TW', at('2026-10-08T01:00:00Z'))).toBe(true);
    expect(isMarketSessionOpen('TW', at('2026-10-08T05:29:59Z'))).toBe(true);
    expect(isMarketSessionOpen('TW', at('2026-10-08T05:30:00Z'))).toBe(false);
  });

  it('skips weekends and official Taiwan closures but keeps start and last trading days open', () => {
    expect(isMarketSessionOpen('TW', at('2026-10-10T02:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('TW', at('2026-10-09T02:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('TW', at('2026-01-01T02:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('TW', at('2026-01-02T02:00:00Z'))).toBe(true);
    expect(isMarketSessionOpen('TW', at('2026-02-11T02:00:00Z'))).toBe(true);
    expect(isMarketSessionOpen('TW', at('2026-02-12T02:00:00Z'))).toBe(false);
  });

  it('uses New York local time including daylight-saving changes', () => {
    expect(isMarketSessionOpen('US', at('2026-01-12T13:29:59Z'))).toBe(false);
    expect(isMarketSessionOpen('US', at('2026-01-12T14:30:00Z'))).toBe(true);
    expect(isMarketSessionOpen('US', at('2026-01-12T21:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('US', at('2026-03-09T13:30:00Z'))).toBe(true);
  });

  it('applies official NYSE holidays and its 2026 early closes', () => {
    expect(isMarketSessionOpen('US', at('2026-11-26T15:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('US', at('2026-07-03T15:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('US', at('2026-11-27T17:59:00Z'))).toBe(true);
    expect(isMarketSessionOpen('US', at('2026-11-27T18:00:00Z'))).toBe(false);
    expect(isMarketSessionOpen('US', at('2026-12-24T18:00:00Z'))).toBe(false);
  });
});

describe('welcome visibility policy', () => {
  it('leaves welcome visible with no tracked market or with uncovered calendar years', () => {
    expect(shouldHideWelcome([], false, at('2026-10-08T02:00:00Z'))).toBe(false);
    expect(shouldHideWelcome(['TW'], false, at('2027-10-08T02:00:00Z'))).toBe(false);
  });

  it('hides when any tracked market is open and keeps manual hide highest priority', () => {
    expect(shouldHideWelcome(['TW', 'US'], false, at('2026-10-08T02:00:00Z'))).toBe(true);
    expect(shouldHideWelcome(['TW', 'US'], false, at('2026-10-08T14:00:00Z'))).toBe(true);
    expect(shouldHideWelcome(['TW'], true, at('2026-10-10T02:00:00Z'))).toBe(true);
    expect(shouldHideWelcome([], true, at('2027-10-08T02:00:00Z'))).toBe(true);
  });
});
