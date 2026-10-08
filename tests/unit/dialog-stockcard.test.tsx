import { useEffect, useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../../src/components/Dialog';
import { StockCard } from '../../src/components/StockCard';
import type { Stock } from '../../src/domain/types';

function FocusHarness() {
  const [revision, setRevision] = useState(0);
  const close = () => undefined;
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('external-state-update', update);
    return () => window.removeEventListener('external-state-update', update);
  }, []);
  return <Dialog title="編輯股票" onClose={close}><label>每股均價<input aria-label="每股均價" defaultValue="100" /></label><span>{revision}</span></Dialog>;
}

const staleStock: Stock = {
  id: 'stale-a', market: 'TW', symbol: '2330', name: '台積電', order: 0, groupId: 'group-tw', gainDisplay: 'percent',
  alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'stale', quoteError: 'rate-limited',
  quote: { price: 1000, previousClose: 980, dayChange: 20, dayChangePercent: 2.04, timestamp: Date.now() - 10_000, status: 'live', source: 'Fugle' },
};

describe('dialog and quote error feedback', () => {
  it('keeps the active form field focused across external state renders', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    const cost = screen.getByLabelText('每股均價');
    cost.focus();
    await user.type(cost, '5');
    act(() => window.dispatchEvent(new Event('external-state-update')));
    expect(cost).toHaveFocus();
    expect(cost).toHaveValue('1005');
  });

  it('shows why the preserved last quote is stale and keeps its actual price visible', () => {
    const noop = vi.fn();
    render(<StockCard stock={staleStock} groups={[{ id: 'group-tw', name: '台股', order: 0 }]} onEdit={noop} onRemove={noop} onMove={noop} onGainDisplayChange={noop} onRetryNotification={noop} onDragStart={noop} onDrop={noop} dragging={false} />);
    expect(screen.getByText('1,000')).toBeVisible();
    expect(screen.getByText('+20.00')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('最近成交仍保留 · 請求過於頻繁');
  });

  it('keeps two decimals on US quotes, price changes, and alert thresholds above 100', () => {
    const noop = vi.fn();
    const usStock: Stock = {
      ...staleStock,
      id: 'us-a', market: 'US', symbol: 'NVDA', name: 'NVIDIA', groupId: 'group-us',
      alert: { above: 139.49, below: 105.25 },
      quoteStatus: 'live', quoteError: undefined,
      quote: { ...staleStock.quote!, price: 184.27, dayChange: 124.56, dayChangePercent: 5.91 },
    };
    render(<StockCard stock={usStock} groups={[{ id: 'group-us', name: '美股', order: 0 }]} onEdit={noop} onRemove={noop} onMove={noop} onGainDisplayChange={noop} onRetryNotification={noop} onDragStart={noop} onDrop={noop} dragging={false} />);
    const card = screen.getByRole('article', { name: 'NVIDIA，美股 NVDA' });
    expect(within(card).getByText('184.27')).toBeVisible();
    expect(within(card).getByText('+124.56')).toBeVisible();
    expect(within(card).getByText('高於 US$139.49')).toBeVisible();
    expect(within(card).getByText('低於 US$105.25')).toBeVisible();
  });

  it('retains Taiwan truncation for prices and alert thresholds at or above 100', () => {
    const noop = vi.fn();
    const twStock: Stock = {
      ...staleStock,
      id: 'tw-b', symbol: '0050', name: '元大台灣50',
      alert: { above: 139.49, below: 95.25 },
      quote: { ...staleStock.quote!, price: 184.27, dayChange: 124.56, dayChangePercent: 5.91 },
    };
    render(<StockCard stock={twStock} groups={[{ id: 'group-tw', name: '台股', order: 0 }]} onEdit={noop} onRemove={noop} onMove={noop} onGainDisplayChange={noop} onRetryNotification={noop} onDragStart={noop} onDrop={noop} dragging={false} />);
    const card = screen.getByRole('article', { name: '元大台灣50，台股 0050' });
    expect(within(card).getByText('184')).toBeVisible();
    expect(within(card).getByText('+124')).toBeVisible();
    expect(within(card).getByText('高於 NT$139')).toBeVisible();
    expect(within(card).getByText('低於 NT$95.25')).toBeVisible();
  });

  it('shows a retry action for a persisted pending notification without a failure state', () => {
    const noop = vi.fn();
    const timestamp = Date.now() - 5_000;
    const pendingStock: Stock = {
      ...staleStock,
      quoteStatus: 'live',
      quoteError: undefined,
      quote: { ...staleStock.quote!, timestamp },
      alert: { above: 990 },
      pendingNotification: { rule: 'above', threshold: 990, price: 1000, quoteTimestamp: timestamp },
    };
    render(<StockCard stock={pendingStock} groups={[{ id: 'group-tw', name: '台股', order: 0 }]} onEdit={noop} onRemove={noop} onMove={noop} onGainDisplayChange={noop} onRetryNotification={noop} onDragStart={noop} onDrop={noop} dragging={false} />);
    expect(screen.getByText('通知待送出')).toBeVisible();
    expect(screen.getByRole('button', { name: '重試' })).toBeVisible();
  });
});
