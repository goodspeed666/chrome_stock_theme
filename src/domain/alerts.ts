import type { QuoteStatus, Stock } from './types';

export interface AlertEvent {
  stockId: string;
  rule: 'above' | 'below';
  threshold: number;
  price: number;
  quoteTimestamp: number;
}

export interface AlertEvaluation {
  stock: Stock;
  events: AlertEvent[];
}

export function evaluateAlerts(stock: Stock, price: number, quoteTimestamp: number, now = Date.now(), status: QuoteStatus = 'live'): AlertEvaluation {
  const age = now - quoteTimestamp;
  const quoteIsFresh = (status === 'live' || status === 'closed') && Number.isFinite(price) && price > 0 && Number.isFinite(quoteTimestamp) && quoteTimestamp <= now && age <= 120_000;
  const quoteIsNew = !stock.quote || quoteTimestamp > stock.quote.timestamp;
  const events: AlertEvent[] = [];
  if (!quoteIsFresh || !quoteIsNew) return { stock, events };

  const latches = { ...stock.alertLatches };
  const above = stock.alert.above;
  const below = stock.alert.below;
  const isAbove = above !== undefined && price > above;
  const isBelow = below !== undefined && price < below;
  if (!isAbove) latches.above = false;
  else if (!latches.above) {
    latches.above = true;
    events.push({ stockId: stock.id, rule: 'above', threshold: above, price, quoteTimestamp });
  }
  if (!isBelow) latches.below = false;
  else if (!latches.below) {
    latches.below = true;
    events.push({ stockId: stock.id, rule: 'below', threshold: below, price, quoteTimestamp });
  }
  return { stock: { ...stock, alertLatches: latches }, events };
}

export function resetAlertLatches(stock: Stock, alert = stock.alert): Pick<Stock, 'alert' | 'alertLatches'> {
  return { alert, alertLatches: { above: false, below: false } };
}
