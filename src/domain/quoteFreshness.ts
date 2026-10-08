import type { Quote } from './types';

export function isNewerQuote(current: Pick<Quote, 'timestamp'> | undefined, incoming: Pick<Quote, 'timestamp'>): boolean {
  return Number.isFinite(incoming.timestamp) && incoming.timestamp > 0 && (!current || incoming.timestamp > current.timestamp);
}
