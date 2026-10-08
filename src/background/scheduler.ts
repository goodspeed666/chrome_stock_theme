import type { Market } from '../domain/types';

export const SCHEDULER_KEY = 'stockDesktopScheduler.v1';
export const REQUEST_LIMIT_PER_MINUTE = 50;
export const MAX_BATCH_PER_PROVIDER = 24;

export interface ProviderBudget {
  recentRequests: number[];
  cooldownUntil: number;
  cursor: number;
}

export interface SchedulerState {
  version: 1;
  providers: Record<Market, ProviderBudget>;
}

export interface ScheduledCandidate {
  market: Market;
  symbol: string;
  apiKey: string;
  key: string;
  order: number;
}

export function emptyBudget(): ProviderBudget { return { recentRequests: [], cooldownUntil: 0, cursor: 0 }; }

export function emptyScheduler(): SchedulerState {
  return { version: 1, providers: { TW: emptyBudget(), US: emptyBudget() } };
}

export type RequestReservation =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'minute-limit'; retryAfterMs: number };

export function reserveRequest(budget: ProviderBudget, now: number): RequestReservation {
  budget.recentRequests = budget.recentRequests.filter((timestamp) => now - timestamp >= 0 && now - timestamp < 60_000);
  if (budget.cooldownUntil > now) return { allowed: false, reason: 'cooldown', retryAfterMs: budget.cooldownUntil - now };
  if (budget.recentRequests.length >= REQUEST_LIMIT_PER_MINUTE) {
    const oldestRequest = Math.min(...budget.recentRequests);
    return { allowed: false, reason: 'minute-limit', retryAfterMs: Math.max(1, oldestRequest + 60_000 - now) };
  }
  budget.recentRequests.push(now);
  return { allowed: true };
}

export function normalizeScheduler(value: unknown): SchedulerState {
  if (!value || typeof value !== 'object') return emptyScheduler();
  const providers = (value as Partial<SchedulerState>).providers;
  return {
    version: 1,
    providers: {
      TW: { ...emptyBudget(), ...providers?.TW, recentRequests: Array.isArray(providers?.TW?.recentRequests) ? providers.TW.recentRequests.filter(Number.isFinite) : [] },
      US: { ...emptyBudget(), ...providers?.US, recentRequests: Array.isArray(providers?.US?.recentRequests) ? providers.US.recentRequests.filter(Number.isFinite) : [] },
    },
  };
}

export function selectBatch(candidates: ScheduledCandidate[], budget: ProviderBudget, now: number): ScheduledCandidate[] {
  budget.recentRequests = budget.recentRequests.filter((timestamp) => now - timestamp >= 0 && now - timestamp < 60_000);
  if (budget.cooldownUntil > now || candidates.length === 0) return [];
  const capacity = Math.min(MAX_BATCH_PER_PROVIDER, REQUEST_LIMIT_PER_MINUTE - budget.recentRequests.length, candidates.length);
  if (capacity <= 0) return [];
  const start = budget.cursor % candidates.length;
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
  const selected = rotated.slice(0, capacity);
  budget.cursor = (start + selected.length) % candidates.length;
  budget.recentRequests.push(...selected.map(() => now));
  return selected;
}

export function applyCooldown(state: SchedulerState, market: Market, now: number, retryAfterMs?: number): SchedulerState {
  const duration = Math.max(30_000, retryAfterMs ?? 60_000);
  return { ...state, providers: { ...state.providers, [market]: { ...state.providers[market], cooldownUntil: Math.max(state.providers[market].cooldownUntil, now + duration) } } };
}
