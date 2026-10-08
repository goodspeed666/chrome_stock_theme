import { useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('status')).toHaveTextContent('最近成交仍保留 · 請求過於頻繁');
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
