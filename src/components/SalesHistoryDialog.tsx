import { useEffect, useRef, useState } from 'react';
import type { SaleRecord, StockGroup } from '../domain/types';
import { calculateGain } from '../domain/portfolio';
import { formatStockPrice } from '../domain/priceDisplay';
import { earliestSaleDate, filterSalesHistory, taipeiDate } from '../domain/salesHistory';
import { Dialog } from './Dialog';

interface SalesHistoryDialogProps {
  records: SaleRecord[];
  groups: StockGroup[];
  filter: 'recent' | string;
  today?: string;
  onFilterChange: (filter: 'recent' | string) => void;
  onClose: () => void;
  onEdit: (record: SaleRecord) => void;
  onRestore: (record: SaleRecord, groupId?: string) => Promise<boolean>;
}

function displayName(record: SaleRecord) {
  return record.stock.customLabel || record.stock.name || record.stock.symbol;
}

function monthOptions(today: string) {
  const earliest = earliestSaleDate(today);
  const [startYear = 0, startMonth = 1] = earliest.split('-').map(Number);
  const [endYear = startYear, endMonth = startMonth] = today.split('-').map(Number);
  const startIndex = startYear * 12 + startMonth - 1;
  const endIndex = endYear * 12 + endMonth - 1;
  const options: { value: string; label: string }[] = [];
  for (let index = endIndex; index >= startIndex; index -= 1) {
    const year = Math.floor(index / 12);
    const month = index % 12 + 1;
    options.push({ value: `${year}-${String(month).padStart(2, '0')}`, label: `${year}年${month}月` });
  }
  return options;
}

function signedMoney(market: SaleRecord['stock']['market'], value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const amount = new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: market === 'TW' ? 0 : 2,
    maximumFractionDigits: market === 'TW' ? 0 : 2,
  }).format(Math.abs(value));
  return `${sign}${market === 'TW' ? 'NT$' : 'US$'}${amount}`;
}

function realizedGain(record: SaleRecord) {
  if (record.stock.averageCost === undefined || !Number.isFinite(record.stock.averageCost)) return null;
  try {
    const gain = calculateGain(record.salePrice, record.stock.averageCost, record.stock.shares);
    return `${signedMoney(record.stock.market, gain.amount)}${gain.label === 'per-share' ? ' / 每股' : ''}`;
  } catch {
    return null;
  }
}

function currencyLabel(market: SaleRecord['stock']['market']) {
  return market === 'TW' ? 'TWD' : 'USD';
}

export function SalesHistoryDialog({ records, groups, filter, today = taipeiDate(), onFilterChange, onClose, onEdit, onRestore }: SalesHistoryDialogProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [restoreErrors, setRestoreErrors] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const filterRef = useRef<HTMLSelectElement>(null);
  const mounted = useRef(true);
  const filtered = filterSalesHistory(records, filter, today);
  const options = monthOptions(today);
  const close = () => { if (!pendingId) onClose(); };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function restore(record: SaleRecord, groupId?: string) {
    if (pendingId) return;
    setPendingId(record.id);
    setRestoreErrors((current) => ({ ...current, [record.id]: '' }));
    try {
      const restored = await onRestore(record, groupId);
      if (!restored) setRestoreErrors((current) => ({ ...current, [record.id]: '還原失敗，歷史資料仍保留。請重試。' }));
      else if (mounted.current) filterRef.current?.focus();
    } catch {
      setRestoreErrors((current) => ({ ...current, [record.id]: '還原失敗，歷史資料仍保留。請重試。' }));
    } finally {
      setPendingId(null);
    }
  }

  return <Dialog
    title="歷史記錄"
    description="賣出資料僅保存在本機，依台灣日期保留近一年。"
    onClose={close}
    className="sales-history-dialog"
  >
    <div className="sales-history-content">
      <div className="sales-history-toolbar">
        <label htmlFor="sales-history-filter">顯示期間</label>
        <select ref={filterRef} id="sales-history-filter" value={filter} onChange={(event) => onFilterChange(event.target.value === 'recent' ? 'recent' : event.target.value)}>
          <option value="recent">近 30 日</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? <p className="sales-history-empty" role="status">{filter === 'recent' ? '近 30 日沒有已賣出的持倉。' : '這個月份沒有已賣出的持倉。'}</p> :
        <div className="sales-history-list" aria-label="已賣出持倉">
          {filtered.map((record) => {
            const name = displayName(record);
            const originalGroupExists = groups.some((group) => group.id === record.stock.groupId);
            const destination = destinations[record.id] ?? '';
            const gain = realizedGain(record);
            return <article className="sales-history-row" key={record.id} aria-label={`${name} ${record.stock.symbol}，${record.saleDate} 已賣出`}>
              <header className="sales-history-row-heading">
                <div className="sales-history-identity">
                  <span className={`market-pill ${record.stock.market.toLowerCase()}`}>{record.stock.market === 'TW' ? '台股' : '美股'}</span>
                  <div><h3>{name}</h3><p>{record.stock.symbol}{record.stock.customLabel ? ` · ${record.stock.name}` : ''}</p></div>
                </div>
                <time dateTime={record.saleDate}>{record.saleDate.replaceAll('-', '/')}</time>
              </header>
              <dl className="sales-history-details">
                <div><dt>買入均價</dt><dd>{record.stock.averageCost === undefined ? '—' : `${currencyLabel(record.stock.market)} ${formatStockPrice(record.stock.averageCost, record.stock.market)}`}</dd></div>
                <div><dt>持股數量</dt><dd>{record.stock.shares === undefined ? '—' : `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 8 }).format(record.stock.shares)} 股`}</dd></div>
                <div><dt>每股賣出價</dt><dd>{currencyLabel(record.stock.market)} {formatStockPrice(record.salePrice, record.stock.market)}</dd></div>
                <div><dt>已實現損益</dt><dd className={gain ? (gain.startsWith('+') ? 'gain-positive' : gain.startsWith('−') ? 'gain-negative' : '') : ''}>{gain ?? '—'}</dd></div>
              </dl>
              {!originalGroupExists && <div className="sales-history-restore-target">
                <label htmlFor={`restore-group-${record.id}`}>還原 {record.stock.symbol}：原分區「{record.originalGroupName}」已不存在，請選擇分區</label>
                <select id={`restore-group-${record.id}`} value={destination} onChange={(event) => setDestinations((current) => ({ ...current, [record.id]: event.target.value }))} disabled={pendingId !== null}>
                  <option value="">選擇分區</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>}
              {restoreErrors[record.id] && <p className="form-error" role="alert">{restoreErrors[record.id]}</p>}
              <footer className="sales-history-actions">
                <button type="button" className="secondary-button" onClick={() => onEdit(record)} disabled={pendingId !== null}>編輯賣出資料</button>
                <button type="button" className="primary-button" onClick={() => void restore(record, originalGroupExists ? undefined : destination)} disabled={pendingId !== null || (!originalGroupExists && !destination)}>{pendingId === record.id ? '還原中…' : '還原持倉'}</button>
              </footer>
            </article>;
          })}
        </div>}
      <p className="sales-history-retention">已實現損益不含手續費、交易稅與股息；未填持股數量時顯示每股價差。</p>
      <p className="sales-history-retention">只保留近一年，超過期限的記錄會在載入或日期變更時自動清除。</p>
    </div>
  </Dialog>;
}
