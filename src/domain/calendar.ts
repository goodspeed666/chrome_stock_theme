const TIME_ZONE = 'Asia/Taipei';
const CHINESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function lunarDayName(day: number): string {
  if (day === 10) return '初十';
  if (day >= 1 && day < 10) return `初${CHINESE_DIGITS[day]}`;
  if (day < 20) return `十${CHINESE_DIGITS[day - 10]}`;
  if (day === 20) return '二十';
  if (day < 30) return `廿${CHINESE_DIGITS[day - 20]}`;
  if (day === 30) return '三十';
  return String(day);
}

export interface TaipeiCalendarDate {
  gregorian: string;
  lunar: string;
}

export function formatTaipeiCalendarDate(date: Date): TaipeiCalendarDate {
  const gregorianParts = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', timeZone: TIME_ZONE,
  }).formatToParts(date);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const weekday = part(gregorianParts, 'weekday').replace(/^星期/u, '');
  const gregorian = `${part(gregorianParts, 'year')}年${part(gregorianParts, 'month')}月${part(gregorianParts, 'day')}日（${weekday}）`;

  const lunarParts = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', {
    month: 'long', day: 'numeric', timeZone: TIME_ZONE,
  }).formatToParts(date);
  const month = part(lunarParts, 'month');
  const day = Number(part(lunarParts, 'day'));
  return { gregorian, lunar: `${month}${lunarDayName(day)}` };
}

export function getTaipeiGreeting(date: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hourCycle: 'h23', timeZone: TIME_ZONE,
  }).formatToParts(date).find((part) => part.type === 'hour')?.value);
  if (hour < 5) return '夜深了，留點時間好好休息。';
  if (hour < 11) return '早安，準備好掌握今天了嗎？';
  if (hour < 14) return '午安，從容掌握市場變化。';
  if (hour < 18) return '下午好，從容掌握市場變化。';
  return '晚安，從容看看今日市場。';
}
