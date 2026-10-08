import { useEffect, useState, type FormEvent } from 'react';
import type { AppState, Market, Stock } from '../domain/types';
import { validateStock } from '../domain/portfolio';
import { Dialog } from './Dialog';

export type StockDraft = Omit<Stock, 'id' | 'order' | 'quote' | 'quoteStatus' | 'alertLatches' | 'notificationFailure' | 'pendingNotification' | 'quoteError'>;

interface StockFormDialogProps {
  state: AppState;
  stock?: Stock;
  initialGroupId?: string;
  onClose: () => void;
  onSave: (draft: StockDraft) => void;
  lookupSymbolName?: (market: Market, symbol: string) => Promise<string | null>;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  return Number(value);
}

export function StockFormDialog({ state, stock, initialGroupId, onClose, onSave, lookupSymbolName }: StockFormDialogProps) {
  const [market, setMarket] = useState(stock?.market ?? (initialGroupId === 'group-us' ? 'US' : 'TW'));
  const [symbol, setSymbol] = useState(stock?.symbol ?? '');
  const [name, setName] = useState(stock?.name === stock?.symbol ? '' : stock?.name ?? '');
  const [customLabel, setCustomLabel] = useState(stock?.customLabel ?? '');
  const [groupId, setGroupId] = useState(stock?.groupId ?? initialGroupId ?? state.groups[0]?.id ?? '');
  const [averageCost, setAverageCost] = useState(stock?.averageCost === undefined ? '' : String(stock.averageCost));
  const [shares, setShares] = useState(stock?.shares === undefined ? '' : String(stock.shares));
  const [above, setAbove] = useState(stock?.alert.above === undefined ? '' : String(stock.alert.above));
  const [below, setBelow] = useState(stock?.alert.below === undefined ? '' : String(stock.alert.below));
  const [error, setError] = useState('');
  const [lookupResult, setLookupResult] = useState<{ market: Market; symbol: string; name: string } | null>(null);
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'success' | 'not-found' | 'failed'>('idle');
  const [lookupMessage, setLookupMessage] = useState('');
  const normalizedSymbol = symbol.trim().toUpperCase();
  const validSymbol = market === 'TW' ? /^\d{4,6}[A-Z]?$/.test(normalizedSymbol) : /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalizedSymbol);
  const currentLookupResult = lookupResult?.market === market && lookupResult.symbol === normalizedSymbol ? lookupResult : null;

  useEffect(() => {
    if (stock || !lookupSymbolName || !validSymbol) {
      setLookupResult(null);
      setLookupStatus('idle');
      setLookupMessage('');
      return;
    }

    let active = true;
    setLookupResult(null);
    setLookupStatus('idle');
    setLookupMessage('');
    const timer = window.setTimeout(() => {
      setLookupStatus('loading');
      void lookupSymbolName(market, normalizedSymbol).then((name) => {
        if (!active) return;
        if (name?.trim()) {
          setLookupResult({ market, symbol: normalizedSymbol, name: name.trim() });
          setLookupStatus('success');
        } else {
          setLookupStatus('not-found');
          setLookupMessage('查無公司名稱');
        }
      }).catch((cause: unknown) => {
        if (!active) return;
        setLookupStatus('failed');
        setLookupMessage(cause instanceof Error ? cause.message : '公司名稱查詢失敗');
      });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [market, normalizedSymbol, stock, lookupSymbolName, validSymbol]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validSymbol) { setError(market === 'TW' ? '請輸入正確台股代號，例如 2330 或 00679B' : '請輸入正確美股代號，例如 AAPL 或 BRK.B'); return; }
    const identityChanged = Boolean(stock && (stock.market !== market || stock.symbol.toUpperCase() !== normalizedSymbol));
    const typedNameIsPrevious = identityChanged && name.trim() === stock?.name;
    const resolvedName = stock
      ? (!name.trim() || typedNameIsPrevious ? normalizedSymbol : name.trim())
      : lookupResult?.market === market && lookupResult.symbol === normalizedSymbol ? lookupResult.name : normalizedSymbol;
    const draft: StockDraft = {
      market, symbol: normalizedSymbol, name: resolvedName,
      ...(customLabel.trim() ? { customLabel: customLabel.trim() } : {}), groupId,
      ...(optionalNumber(averageCost) !== undefined ? { averageCost: optionalNumber(averageCost) } : {}),
      ...(optionalNumber(shares) !== undefined ? { shares: optionalNumber(shares) } : {}),
      gainDisplay: stock?.gainDisplay ?? 'percent',
      alert: { ...(optionalNumber(above) !== undefined ? { above: optionalNumber(above) } : {}), ...(optionalNumber(below) !== undefined ? { below: optionalNumber(below) } : {}) },
    };
    const validation = validateStock(draft);
    if (validation) { setError(validation); return; }
    setError('');
    onSave(draft);
  }

  return <Dialog title={stock ? '編輯股票' : '新增股票'} description="持股與提醒資料只保存在這部裝置。" onClose={onClose} className="form-dialog">
    <form className="stack-form" onSubmit={submit} noValidate>
      <div className="form-grid two">
          <label>市場<select value={market} onChange={(event) => setMarket(event.target.value as 'TW' | 'US')}><option value="TW">台股 · TWD</option><option value="US">美股 · USD</option></select></label>
          <div className="symbol-field"><label htmlFor="stock-symbol-input">股票代號</label><div className="symbol-input-wrap">
            <input id="stock-symbol-input" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" required placeholder={market === 'TW' ? '例如 2330、00679B' : '例如 AAPL、BRK.B'} />
            {!stock && lookupStatus === 'success' && currentLookupResult && <span className="symbol-name-suffix" title={currentLookupResult.name} aria-live="polite">{currentLookupResult.name}</span>}
          </div></div>
        </div>
      {!stock && <div className="symbol-name-lookup" aria-live="polite">
        {!lookupSymbolName ? <p className="form-note">安裝擴充功能後可自動查詢公司名稱；目前會使用代號作為名稱。</p> : <>
          {lookupStatus === 'loading' && <p className="form-note" role="status">查詢股票名稱中…</p>}
          {lookupStatus === 'not-found' && <p className="form-note" role="status">{lookupMessage}，仍可用代號加入。</p>}
          {lookupStatus === 'failed' && <p className="form-note" role="status">{lookupMessage}，仍可用代號加入。</p>}
        </>}
      </div>}
      <div className="form-grid two">
        {stock && <label>名稱 <span className="optional">可留空，由行情來源補上</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="公司或 ETF 名稱" /></label>}
        <label>自訂標籤 <span className="optional">選填</span><input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="例如：退休組合" /></label>
      </div>
      <label>分區<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <div className="form-section-title">持股資料 <span>可只追蹤，不必填持股</span></div>
      <div className="form-grid two">
        <label>每股買入均價 <span className="optional">{market === 'TW' ? 'TWD' : 'USD'}，選填</span><input inputMode="decimal" value={averageCost} onChange={(event) => setAverageCost(event.target.value)} placeholder="0.00" /></label>
        <label>持股數量 <span className="optional">{market === 'TW' ? '股' : '股，可填小數'}</span><input inputMode="decimal" value={shares} onChange={(event) => setShares(event.target.value)} placeholder="0" /></label>
      </div>
      <div className="form-section-title">到價提醒 <span>高於與低於分開設定</span></div>
      <div className="form-grid two">
        <label>高於 <span className="optional">{market === 'TW' ? 'TWD' : 'USD'}</span><input inputMode="decimal" value={above} onChange={(event) => setAbove(event.target.value)} placeholder="不設定" /></label>
        <label>低於 <span className="optional">{market === 'TW' ? 'TWD' : 'USD'}</span><input inputMode="decimal" value={below} onChange={(event) => setBelow(event.target.value)} placeholder="不設定" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="form-note">損益不含手續費、交易稅與股息。未填持股數量時，金額顯示每股價差。</p>
      <footer className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">{stock ? '儲存變更' : '加入追蹤'}</button></footer>
    </form>
  </Dialog>;
}
