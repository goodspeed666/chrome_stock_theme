import { useState } from 'react';
import type { Stock, StockGroup } from '../domain/types';
import { calculateGain } from '../domain/portfolio';
import { formatSignedStockPrice, formatStockPrice } from '../domain/priceDisplay';
import { Icon } from './Icons';

interface StockCardProps {
  stock: Stock;
  groups: StockGroup[];
  onEdit: () => void;
  onRemove: () => void;
  onMove: (groupId: string, index: number) => void;
  onGainDisplayChange: () => void;
  onRetryNotification: () => void;
  onDragStart: () => void;
  onDrop: (index: number) => void;
  dragging: boolean;
}

const statusLabels: Record<string, string> = {
  live: '最新成交', stale: '報價過期', closed: '休市資料', 'not-connected': '尚未連接行情',
  'invalid-symbol': '無效代號', credentials: '金鑰錯誤', 'rate-limited': '請求過於頻繁',
  'network-error': '網路連線失敗', 'provider-error': '行情來源錯誤', 'no-trade': '尚無新成交',
};

function currency(market: Stock['market'], value: number) {
  return `${market === 'TW' ? 'NT$' : 'US$'}${formatStockPrice(value, market)}`;
}

function signedMoney(market: Stock['market'], value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const amount = new Intl.NumberFormat('zh-TW', {
    style: 'decimal',
    minimumFractionDigits: market === 'TW' ? 0 : 2,
    maximumFractionDigits: market === 'TW' ? 0 : 2,
  }).format(Math.abs(value));
  return `${sign}${market === 'TW' ? '$' : 'US$'}${amount}`;
}

function signed(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${Math.abs(value).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stamp(stock: Stock) {
  if (!stock.quote) return '—';
  return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: stock.market === 'TW' ? 'Asia/Taipei' : 'America/New_York' }).format(stock.quote.timestamp);
}

export function StockCard({ stock, groups, onEdit, onRemove, onMove, onGainDisplayChange, onRetryNotification, onDragStart, onDrop, dragging }: StockCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const displayName = stock.customLabel || stock.name || stock.symbol;
  const quoteLabel = stock.quote ? (stock.quoteStatus === 'stale' ? '報價過期' : stock.quoteStatus === 'closed' ? '休市資料' : '最新成交') : statusLabels[stock.quoteStatus];
  let gain: ReturnType<typeof calculateGain> | null = null;
  if (stock.quote && stock.averageCost) {
    try { gain = calculateGain(stock.quote.price, stock.averageCost, stock.shares); } catch { gain = null; }
  }
  const gainMoneyText = gain ? `${signedMoney(stock.market, gain.amount)}${gain.label === 'per-share' ? ' / 每股' : ''}` : '';
  const gainMoneyLength = Array.from(gainMoneyText).length;
  const gainMoneyFontSize = `${Math.max(12, Math.min(14, 200 / Math.max(gainMoneyLength, 1)))}px`;
  const longGainMoney = gainMoneyLength > 10;
  const limitUp = stock.market === 'TW'
    && (stock.quoteStatus === 'live' || stock.quoteStatus === 'closed')
    && stock.quote?.source === 'Fugle'
    && stock.quote.isLimitUpPrice === true
    && stock.quote.isLimitDownPrice !== true
    && stock.quote.isTrial !== true
    && stock.quote.isTradingHalted !== true
    && stock.quote.isLimitUpHalt !== true
    && stock.quote.isLimitDownHalt !== true;
  const hasAlert = stock.alert.above !== undefined || stock.alert.below !== undefined;
  const hasNotification = Boolean(stock.notificationFailure || stock.pendingNotification || stock.limitNotificationFailure || stock.pendingLimitNotification);
  const notificationFailure = stock.notificationFailure || stock.limitNotificationFailure;
  const pendingLimitLabel = stock.pendingLimitNotification?.direction === 'limit-up' ? '漲停通知待送出' : stock.pendingLimitNotification?.direction === 'limit-down' ? '跌停通知待送出' : '通知待送出';

  return <article className={`stock-card ${dragging ? 'is-dragging' : ''} ${limitUp ? 'is-limit-up' : ''}`} draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDrop(stock.order); }} aria-label={`${displayName}，${stock.market === 'TW' ? '台股' : '美股'} ${stock.symbol}`}>
    {limitUp && <svg className="stock-fireworks" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <g transform="translate(80 20)"><g className="firework-burst burst-one"><path d="M0-13V-7M0 7V13M-13 0H-7M7 0H13M-9-9L-5-5M5 5L9 9M9-9L5-5M-5 5L-9 9" /><circle r="1.8" /></g></g>
      <g transform="translate(36 50)"><g className="firework-burst burst-two"><path d="M0-11V-6M0 6V11M-11 0H-6M6 0H11M-8-8L-4-4M4 4L8 8M8-8L4-4M-4 4L-8 8" /><circle r="1.5" /></g></g>
      <g transform="translate(88 72)"><g className="firework-burst burst-three"><path d="M0-9V-5M0 5V9M-9 0H-5M5 0H9M-7-7L-4-4M4 4L7 7M7-7L4-4M-4 4L-7 7" /><circle r="1.3" /></g></g>
    </svg>}
    <div className="stock-card-top">
      <div className="stock-id"><span className={`market-pill ${stock.market.toLowerCase()}`}>{stock.market === 'TW' ? 'TW' : 'US'}</span><span className="stock-symbol">{stock.symbol}</span>{limitUp && <span className="limit-up-badge" role="status">漲停</span>}<span className="drag-grip" aria-hidden="true"><Icon name="grip" size={17} /></span></div>
      <details className="card-menu" open={menuOpen} onToggle={(event) => setMenuOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary role="button" aria-label={`${displayName}的操作選單`} aria-expanded={menuOpen}><Icon name="more" size={18} /></summary>
        <div className="card-menu-popover" role="group" aria-label={`${displayName}操作`}>
          <button type="button" onClick={() => { setMenuOpen(false); onEdit(); }}><Icon name="edit" size={15} />編輯</button>
          <label className="menu-move"><Icon name="arrow" size={15} /><span>移至分區</span><select value={stock.groupId} aria-label={`移動 ${displayName} 至`} onChange={(event) => { setMenuOpen(false); onMove(event.target.value, 0); }}><option value={stock.groupId} disabled>選擇分區</option>{groups.filter((group) => group.id !== stock.groupId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <div className="menu-order"><button type="button" onClick={() => { setMenuOpen(false); onMove(stock.groupId, Math.max(0, stock.order - 1)); }}><Icon name="up" size={15} />上移</button><button type="button" onClick={() => { setMenuOpen(false); onMove(stock.groupId, stock.order + 1); }}><Icon name="down" size={15} />下移</button></div>
          <button type="button" className="danger-action" onClick={() => { setMenuOpen(false); onRemove(); }}><Icon name="trash" size={15} />移除股票</button>
        </div>
      </details>
      <div className="stock-name-block"><div className="stock-name" title={stock.customLabel ? stock.name : undefined}>{displayName}</div>{stock.customLabel && <div className="under-name">{stock.name}</div>}</div>
    </div>
    <div className={`stock-values-row ${gain ? 'has-gain' : ''} ${longGainMoney ? 'has-long-gain' : ''}`}>
      <div className="stock-quote-block">
        <div className="price-row">
          {stock.quote ? <div className="current-price">{formatStockPrice(stock.quote.price, stock.market)}</div> : <div className="price-placeholder">—</div>}
          <span className={`quote-status ${stock.quoteStatus}`}><i />{stock.quote ? quoteLabel : (statusLabels[stock.quoteStatus] ?? '等待行情')}</span>
        </div>
        {stock.quote && <div className={`day-move ${stock.quote.dayChange !== null && stock.quote.dayChange > 0 ? 'up' : stock.quote.dayChange !== null && stock.quote.dayChange < 0 ? 'down' : 'flat'}`}>
          <span>今日</span><b>{formatSignedStockPrice(stock.quote.dayChange, stock.market)}</b><span className="day-move-percent">{stock.quote.dayChangePercent === null ? '—' : `${signed(stock.quote.dayChangePercent)}%`}</span>
        </div>}
      </div>
      {gain && <button type="button" className={`gain-panel ${gain.percent > 0 ? 'up' : gain.percent < 0 ? 'down' : 'flat'}`} onClick={onGainDisplayChange} aria-label={`損益顯示切換，目前${stock.gainDisplay === 'percent' ? '百分比' : '金額'}，切換為${stock.gainDisplay === 'percent' ? '金額' : '百分比'}`} title="點擊切換百分比與金額">
        <span className="gain-label">持有損益 <small>{stock.quoteStatus === 'stale' ? '參考值' : ''}</small></span>
        <strong className={stock.gainDisplay === 'money' ? 'gain-amount' : undefined} style={stock.gainDisplay === 'money' ? { fontSize: gainMoneyFontSize } : undefined}>{stock.gainDisplay === 'percent' ? `${gain.percent > 0 ? '+' : gain.percent < 0 ? '−' : '±'}${Math.abs(gain.percent).toFixed(2)}%` : <span className="gain-amount-track">{gainMoneyText}</span>}</strong>
        {stock.gainDisplay === 'percent' && <span className="gain-money-hint" style={{ fontSize: gainMoneyFontSize }}><span className="gain-amount-track">{gainMoneyText}</span></span>}
      </button>}
    </div>
    {stock.quote && stock.quoteStatus === 'stale' && <div className="quote-error-note" role="status">最近成交仍保留 · {statusLabels[stock.quoteError ?? 'stale'] ?? '行情更新失敗'}</div>}
    {(hasAlert || hasNotification || stock.quote) && <footer className="stock-card-footer">
      {hasAlert && <div className="alert-summary"><Icon name="bell" size={14} />{stock.alert.above !== undefined && <span>高於 {currency(stock.market, stock.alert.above)}</span>}{stock.alert.below !== undefined && <span>低於 {currency(stock.market, stock.alert.below)}</span>}</div>}
      {hasNotification && <div className={`notification-failure ${!notificationFailure ? 'pending-notification' : ''}`} role="status"><span>{notificationFailure ? '通知傳送失敗' : stock.pendingLimitNotification ? pendingLimitLabel : '通知待送出'}</span><button type="button" onClick={onRetryNotification}>重試</button></div>}
      {stock.quote && <div className="quote-footer"><time className="quote-update-time" dateTime={new Date(stock.quote.timestamp).toISOString()} aria-label={`最近報價更新時間 ${stamp(stock)}（${stock.market === 'TW' ? '台北' : '紐約'}時間）`}><Icon name="clock" size={13} />{stamp(stock)}</time></div>}
    </footer>}
  </article>;
}
