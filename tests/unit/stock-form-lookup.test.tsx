import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockFormDialog } from '../../src/components/StockFormDialog';
import { DEFAULT_STATE, type Stock } from '../../src/domain/types';

const state = structuredClone(DEFAULT_STATE);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('new-stock company name lookup', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('debounces for 400 ms and saves the returned name in the new-stock draft', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const lookup = vi.fn().mockResolvedValue('台積電');
    render(<StockFormDialog state={state} onClose={vi.fn()} onSave={onSave} lookupSymbolName={lookup} />);

    fireEvent.change(screen.getByLabelText('股票代號'), { target: { value: '2330' } });
    await act(async () => { vi.advanceTimersByTime(399); });
    expect(lookup).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(lookup).toHaveBeenCalledWith('TW', '2330');
    await act(async () => { await Promise.resolve(); });

    const symbolInput = screen.getByLabelText('股票代號');
    const resolvedName = screen.getByText('台積電');
    expect(symbolInput).toHaveValue('2330');
    expect(resolvedName).toHaveClass('symbol-name-suffix');
    expect(resolvedName).toHaveAttribute('title', '台積電');
    expect(screen.queryByText(/^公司名稱：/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入追蹤' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ market: 'TW', symbol: '2330', name: '台積電' }));
  });

  it('clears an old result on identity change and ignores an older response that resolves last', async () => {
    vi.useFakeTimers();
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const lookup = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<StockFormDialog state={state} onClose={vi.fn()} onSave={vi.fn()} lookupSymbolName={lookup} />);

    const symbol = screen.getByLabelText('股票代號');
    fireEvent.change(symbol, { target: { value: '2330' } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(lookup).toHaveBeenNthCalledWith(1, 'TW', '2330');
    expect(screen.getByText('查詢股票名稱中…')).toBeVisible();

    fireEvent.change(symbol, { target: { value: '2317' } });
    expect(screen.queryByText('台積電')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(lookup).toHaveBeenNthCalledWith(2, 'TW', '2317');

    await act(async () => { second.resolve('鴻海'); await second.promise; });
    expect(screen.getByText('鴻海')).toBeVisible();
    await act(async () => { first.resolve('台積電'); await first.promise; });
    expect(screen.getByText('鴻海')).toBeVisible();
    expect(screen.queryByText('台積電')).not.toBeInTheDocument();
  });

  it('falls back to the ticker after a failed lookup and explains the fallback', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const lookup = vi.fn().mockRejectedValue(new Error('尚未設定 Finnhub API 金鑰'));
    render(<StockFormDialog state={state} onClose={vi.fn()} onSave={onSave} lookupSymbolName={lookup} />);

    fireEvent.change(screen.getByLabelText('股票代號'), { target: { value: 'AAPL' } });
    fireEvent.change(screen.getByLabelText('市場'), { target: { value: 'US' } });
    await act(async () => { vi.advanceTimersByTime(400); await Promise.resolve(); });
    expect(screen.getByText(/尚未設定 Finnhub API 金鑰/)).toBeVisible();
    expect(screen.getByText(/仍可用代號加入/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '加入追蹤' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ market: 'US', symbol: 'AAPL', name: 'AAPL' }));
  });

  it('shows install guidance in preview without making a lookup request', () => {
    const onSave = vi.fn();
    const lookup = vi.fn();
    render(<StockFormDialog state={state} onClose={vi.fn()} onSave={onSave} />);

    expect(screen.getByText(/安裝擴充功能後可自動查詢公司名稱/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('股票代號'), { target: { value: '2330' } });
    fireEvent.click(screen.getByRole('button', { name: '加入追蹤' }));
    expect(lookup).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ symbol: '2330', name: '2330' }));
  });

  it('preserves manually edited names and does not look them up in edit mode', () => {
    vi.useFakeTimers();
    const stock: Stock = {
      id: 'a', market: 'TW', symbol: '2330', name: '自訂公司名稱', order: 0, groupId: 'group-tw', gainDisplay: 'percent',
      alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'no-trade',
    };
    const lookup = vi.fn();
    const onSave = vi.fn();
    render(<StockFormDialog state={state} stock={stock} onClose={vi.fn()} onSave={onSave} lookupSymbolName={lookup} />);
    fireEvent.change(screen.getByLabelText(/^名稱/), { target: { value: '我的手動名稱' } });
    fireEvent.change(screen.getByLabelText('股票代號'), { target: { value: '2317' } });
    act(() => { vi.advanceTimersByTime(800); });
    expect(lookup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ symbol: '2317', name: '我的手動名稱' }));
  });
});
