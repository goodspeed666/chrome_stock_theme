import { useState, type FormEvent } from 'react';
import type { SaleRecord } from '../domain/types';
import { earliestSaleDate, taipeiDate, validateSale } from '../domain/salesHistory';
import { formatStockPrice } from '../domain/priceDisplay';
import { Dialog } from './Dialog';

interface SaleFormDialogProps {
  stock: SaleRecord['stock'];
  today?: string;
  salePrice?: number;
  saleDate?: string;
  editing?: boolean;
  onClose: () => void;
  onSave: (salePrice: number, saleDate: string) => Promise<boolean>;
}

function displayName(stock: SaleRecord['stock']) {
  return stock.customLabel || stock.name || stock.symbol;
}

export function SaleFormDialog({ stock, today = taipeiDate(), salePrice, saleDate, editing = false, onClose, onSave }: SaleFormDialogProps) {
  const [priceInput, setPriceInput] = useState(salePrice === undefined ? '' : String(salePrice));
  const [dateInput, setDateInput] = useState(saleDate ?? today);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const currency = stock.market === 'TW' ? 'TWD' : 'USD';
  const close = () => { if (!pending) onClose(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedPrice = Number(priceInput);
    const validation = validateSale(parsedPrice, dateInput, today);
    if (validation) { setError(validation); return; }
    setError('');
    setPending(true);
    try {
      const saved = await onSave(parsedPrice, dateInput);
      if (!saved) setError('儲存失敗，資料沒有變更。請確認後再試一次。');
    } catch {
      setError('儲存失敗，資料沒有變更。請確認後再試一次。');
    } finally {
      setPending(false);
    }
  }

  return <Dialog
    title={editing ? '編輯賣出資料' : '標記為已賣出'}
    description={editing ? '更新賣出價格與日期。' : '會移除整個持倉並保存在本機歷史記錄，不會送出交易委託。'}
    onClose={close}
    className="small-dialog sale-form-dialog"
  >
    <form className="stack-form sale-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="sale-form-stock">
        <span className={`market-pill ${stock.market.toLowerCase()}`}>{stock.market === 'TW' ? '台股' : '美股'}</span>
        <div><b>{displayName(stock)}</b><span>{stock.symbol}</span></div>
      </div>
      <label htmlFor="sale-price-input">每股賣出價格（{currency}） <span className="required-marker" aria-hidden="true">*</span></label>
      <input
        id="sale-price-input"
        aria-describedby={error ? 'sale-form-error' : 'sale-price-help'}
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={priceInput}
        onChange={(event) => { setPriceInput(event.target.value); setError(''); }}
        disabled={pending}
        required
      />
      <p id="sale-price-help" className="form-note">{salePrice !== undefined && !editing ? `已帶入最近報價 ${formatStockPrice(salePrice, stock.market)}，可直接修改。` : '請填寫成交的每股價格。'}</p>
      <label htmlFor="sale-date-input">賣出日期 <span className="required-marker" aria-hidden="true">*</span></label>
      <input
        id="sale-date-input"
        aria-describedby={error ? 'sale-form-error' : 'sale-date-help'}
        type="date"
        min={earliestSaleDate(today)}
        max={today}
        value={dateInput}
        onChange={(event) => { setDateInput(event.target.value); setError(''); }}
        disabled={pending}
        required
      />
      <p id="sale-date-help" className="form-note">歷史記錄只保留近一年，日期不可晚於今天。</p>
      {error && <p id="sale-form-error" className="form-error" role="alert">{error}</p>}
      <footer className="form-actions">
        <button type="button" className="secondary-button" onClick={close} disabled={pending}>取消</button>
        <button type="submit" className="primary-button" disabled={pending}>{pending ? '儲存中…' : editing ? '儲存變更' : '確認已賣出'}</button>
      </footer>
    </form>
  </Dialog>;
}
