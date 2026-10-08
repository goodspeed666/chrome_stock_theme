import type { SaleRecord, Stock } from './types';

type CalendarDate = { year: number; month: number; day: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseCalendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function formatCalendarDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolvedToday(today?: string): string {
  return parseCalendarDate(today) ? today! : taipeiDate();
}

function shiftCalendarDate(value: string, days: number): string {
  const parts = parseCalendarDate(value);
  if (!parts) return taipeiDate();
  const shifted = new Date(0);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatCalendarDate({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
}

export function taipeiDate(now = new Date()): string {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(safeNow);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year!.padStart(4, '0')}-${values.month}-${values.day}`;
}

export function earliestSaleDate(today?: string): string {
  const parts = parseCalendarDate(resolvedToday(today))!;
  const year = parts.year - 1;
  const month = parts.month;
  return formatCalendarDate({ year, month, day: Math.min(parts.day, daysInMonth(year, month)) });
}

export function validateSale(salePrice: number, saleDate: string, today?: string): string | null {
  if (!Number.isFinite(salePrice) || salePrice <= 0) return '售出價格必須大於 0';
  if (!parseCalendarDate(saleDate)) return '請輸入有效的售出日期';
  const currentDate = resolvedToday(today);
  if (saleDate > currentDate) return '售出日期不能晚於今天';
  if (saleDate < earliestSaleDate(currentDate)) return '售出日期已超過一年的保留期間';
  return null;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function safeSaleStock(value: unknown): SaleRecord['stock'] | null {
  if (!isRecord(value)
    || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 100
    || (value.market !== 'TW' && value.market !== 'US')
    || typeof value.symbol !== 'string' || !value.symbol.trim() || value.symbol.length > 24
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120
    || !Number.isSafeInteger(value.order) || Number(value.order) < 0
    || typeof value.groupId !== 'string' || !value.groupId.trim() || value.groupId.length > 100
    || (value.gainDisplay !== 'percent' && value.gainDisplay !== 'money')) return null;
  if (value.customLabel !== undefined && (typeof value.customLabel !== 'string' || value.customLabel.length > 120)) return null;
  if (value.averageCost !== undefined && !isPositiveFinite(value.averageCost)) return null;
  if (value.shares !== undefined && !isPositiveFinite(value.shares)) return null;
  if (!isRecord(value.alert)) return null;
  for (const key of ['above', 'below'] as const) {
    if (value.alert[key] !== undefined && !isPositiveFinite(value.alert[key])) return null;
  }

  return {
    id: value.id,
    market: value.market,
    symbol: value.symbol,
    name: value.name,
    ...(typeof value.customLabel === 'string' ? { customLabel: value.customLabel } : {}),
    order: Number(value.order),
    groupId: value.groupId,
    ...(typeof value.averageCost === 'number' ? { averageCost: value.averageCost } : {}),
    ...(typeof value.shares === 'number' ? { shares: value.shares } : {}),
    gainDisplay: value.gainDisplay,
    alert: {
      ...(typeof value.alert.above === 'number' ? { above: value.alert.above } : {}),
      ...(typeof value.alert.below === 'number' ? { below: value.alert.below } : {}),
    },
  };
}

function safeSaleRecord(value: unknown, today: string): SaleRecord | null {
  if (!isRecord(value)
    || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 100
    || typeof value.originalGroupName !== 'string' || value.originalGroupName.length > 80
    || !isPositiveFinite(value.salePrice)
    || validateSale(value.salePrice, typeof value.saleDate === 'string' ? value.saleDate : '', today)) return null;
  const stock = safeSaleStock(value.stock);
  if (!stock) return null;
  return {
    id: value.id,
    stock,
    originalGroupName: value.originalGroupName,
    salePrice: value.salePrice,
    saleDate: value.saleDate as string,
  };
}

export function normalizeSalesHistory(value: unknown, today?: string): SaleRecord[] {
  if (!Array.isArray(value)) return [];
  const currentDate = resolvedToday(today);
  const seenIds = new Set<string>();
  const records: SaleRecord[] = [];
  for (const item of value) {
    const record = safeSaleRecord(item, currentDate);
    if (!record || seenIds.has(record.id)) continue;
    seenIds.add(record.id);
    records.push(record);
  }
  return records;
}

export function pruneSalesHistory(records: SaleRecord[], today?: string): SaleRecord[] {
  return normalizeSalesHistory(records, today);
}

export function filterSalesHistory(records: SaleRecord[], filter: 'recent' | string, today?: string): SaleRecord[] {
  const currentDate = resolvedToday(today);
  const earliestDate = earliestSaleDate(currentDate);
  if (filter !== 'recent' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(filter)) return [];
  const monthParts = filter === 'recent' ? null : parseCalendarDate(`${filter}-01`)!;
  const latestDate = filter === 'recent'
    ? currentDate
    : formatCalendarDate({ year: monthParts!.year, month: monthParts!.month, day: daysInMonth(monthParts!.year, monthParts!.month) });
  const firstDate = filter === 'recent' ? shiftCalendarDate(currentDate, -29) : `${filter}-01`;

  const indexed = pruneSalesHistory(records, currentDate)
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.saleDate >= earliestDate
      && record.saleDate <= currentDate
      && record.saleDate >= firstDate
      && record.saleDate <= latestDate)
    .sort((left, right) => right.record.saleDate.localeCompare(left.record.saleDate) || right.index - left.index);
  return indexed.map(({ record }) => record);
}

export function createSaleRecord(id: string, stock: Stock, originalGroupName: string, salePrice: number, saleDate: string, today?: string): SaleRecord {
  const validation = validateSale(salePrice, saleDate, today);
  if (validation) throw new Error(validation);
  const snapshot = safeSaleStock(stock);
  if (!snapshot) throw new Error('股票資料無法建立售出記錄');
  if (typeof id !== 'string' || !id.trim() || id.length > 100) throw new Error('售出記錄識別碼無效');
  if (typeof originalGroupName !== 'string' || originalGroupName.length > 80) throw new Error('原分區名稱無效');
  return { id, stock: snapshot, originalGroupName, salePrice, saleDate };
}
