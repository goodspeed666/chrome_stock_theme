import type { Market } from './types';

const CALENDAR_YEAR = 2026;
const TWSE_CLOSED = new Set([
  '2026-01-01',
  '2026-02-12', '2026-02-13', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27', '2026-02-28',
  '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '2026-05-01', '2026-06-19', '2026-09-25', '2026-09-28',
  '2026-10-09', '2026-10-10', '2026-10-25', '2026-10-26', '2026-12-25',
]);
const NYSE_CLOSED = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);
const NYSE_EARLY_CLOSE = new Map([['2026-11-27', 13 * 60], ['2026-12-24', 13 * 60]]);

interface LocalSessionDate {
  year: number;
  date: string;
  weekday: string;
  minuteOfDay: number;
}

function localSessionDate(date: Date, timeZone: string): LocalSessionDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(value('year'));
  const month = value('month');
  const day = value('day');
  return { year, date: `${year}-${month}-${day}`, weekday: value('weekday'), minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')) };
}

export function isMarketSessionOpen(market: Market, date: Date): boolean {
  if (!Number.isFinite(date.getTime())) return false;
  const taiwan = market === 'TW';
  const local = localSessionDate(date, taiwan ? 'Asia/Taipei' : 'America/New_York');
  if (local.year !== CALENDAR_YEAR || local.weekday === 'Sat' || local.weekday === 'Sun') return false;
  const closedDates = taiwan ? TWSE_CLOSED : NYSE_CLOSED;
  if (closedDates.has(local.date)) return false;

  const opensAt = taiwan ? 9 * 60 : 9 * 60 + 30;
  const closesAt = taiwan ? 13 * 60 + 30 : NYSE_EARLY_CLOSE.get(local.date) ?? 16 * 60;
  return local.minuteOfDay >= opensAt && local.minuteOfDay < closesAt;
}

export function shouldHideWelcome(markets: readonly Market[], manuallyHidden: boolean, date: Date): boolean {
  return manuallyHidden || markets.some((market) => isMarketSessionOpen(market, date));
}
