import { describe, expect, it } from 'vitest';
import { formatTaipeiCalendarDate, getTaipeiGreeting } from '../../src/domain/calendar';

describe('Taipei calendar date', () => {
  it('uses the requested Traditional Chinese Gregorian and lunar format', () => {
    // Fixture is cross-checked with HKO 2026 calendar: https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
    expect(formatTaipeiCalendarDate(new Date('2026-10-08T04:00:00.000Z'))).toEqual({
      gregorian: '2026年10月8日（四）',
      lunar: '八月廿八',
    });
  });

  it('renders lunar new year as 正月初一', () => {
    expect(formatTaipeiCalendarDate(new Date('2026-02-17T04:00:00.000Z')).lunar).toBe('正月初一');
  });

  it('renders the tenth day of a lunar month as 初十', () => {
    expect(formatTaipeiCalendarDate(new Date('2026-10-19T04:00:00.000Z')).lunar).toBe('九月初十');
  });

  it('renders the twentieth and thirtieth lunar days correctly', () => {
    expect(formatTaipeiCalendarDate(new Date('2026-10-29T04:00:00.000Z')).lunar).toBe('九月二十');
    expect(formatTaipeiCalendarDate(new Date('2026-11-08T04:00:00.000Z')).lunar).toBe('九月三十');
  });

  it('preserves the leap-month marker from the Chinese calendar', () => {
    expect(formatTaipeiCalendarDate(new Date('2023-03-22T04:00:00.000Z')).lunar).toBe('閏二月初一');
  });

  it('changes dates at Taipei midnight, not UTC midnight', () => {
    expect(formatTaipeiCalendarDate(new Date('2026-10-07T15:59:59.000Z'))).toEqual({
      gregorian: '2026年10月7日（三）',
      lunar: '八月廿七',
    });
    expect(formatTaipeiCalendarDate(new Date('2026-10-07T16:00:00.000Z'))).toEqual({
      gregorian: '2026年10月8日（四）',
      lunar: '八月廿八',
    });
  });

  it('chooses a calm greeting at each Taipei time-of-day boundary', () => {
    const at = (time: string) => new Date(`2026-10-08T${time}:00+08:00`);
    expect(getTaipeiGreeting(at('00:00'))).toBe('夜深了，留點時間好好休息。');
    expect(getTaipeiGreeting(at('04:59'))).toBe('夜深了，留點時間好好休息。');
    expect(getTaipeiGreeting(at('05:00'))).toBe('早安，準備好掌握今天了嗎？');
    expect(getTaipeiGreeting(at('10:59'))).toBe('早安，準備好掌握今天了嗎？');
    expect(getTaipeiGreeting(at('11:00'))).toBe('午安，從容掌握市場變化。');
    expect(getTaipeiGreeting(at('13:59'))).toBe('午安，從容掌握市場變化。');
    expect(getTaipeiGreeting(at('14:00'))).toBe('下午好，從容掌握市場變化。');
    expect(getTaipeiGreeting(at('17:59'))).toBe('下午好，從容掌握市場變化。');
    expect(getTaipeiGreeting(at('18:00'))).toBe('晚安，從容看看今日市場。');
    expect(getTaipeiGreeting(at('23:59'))).toBe('晚安，從容看看今日市場。');
  });
});
