import type { Market } from '../domain/types';

export const SCHEDULER_KEY = 'stockDesktopScheduler.v1';
export const REQUEST_LIMIT_PER_MINUTE = 50;
export const MAX_BATCH_PER_PROVIDER = 24;
// Seven days preserves ordinary long Retry-After values while bounding corrupt or extreme cooldowns.
export const MAX_PROVIDER_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

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

export function normalizeScheduler(value: unknown, now = Date.now()): SchedulerState {
  if (!value || typeof value !== 'object') return emptyScheduler();
  const providers = (value as Partial<SchedulerState>).providers;
  const safeNow = Number.isFinite(now) && now >= 0 ? now : Date.now();
  const maxCooldownUntil = safeNow + MAX_PROVIDER_COOLDOWN_MS;
  const normalizeBudget = (stored: ProviderBudget | undefined): ProviderBudget => {
    const cooldownUntil = typeof stored?.cooldownUntil === 'number' && Number.isFinite(stored.cooldownUntil) && stored.cooldownUntil >= 0
      ? Math.min(stored.cooldownUntil, maxCooldownUntil)
      : 0;
    return {
      ...emptyBudget(),
      ...stored,
      recentRequests: Array.isArray(stored?.recentRequests) ? stored.recentRequests.filter(Number.isFinite) : [],
      cooldownUntil,
    };
  };
  return {
    version: 1,
    providers: {
      TW: normalizeBudget(providers?.TW),
      US: normalizeBudget(providers?.US),
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
  const safeNow = Number.isFinite(now) && now >= 0 ? now : Date.now();
  const maxCooldownUntil = safeNow + MAX_PROVIDER_COOLDOWN_MS;
  const current = state.providers[market];
  const currentCooldown = Number.isFinite(current.cooldownUntil) && current.cooldownUntil >= 0
    ? Math.min(current.cooldownUntil, maxCooldownUntil)
    : 0;
  const requestedDuration = retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs < 0
    ? 60_000
    : retryAfterMs;
  const duration = Math.min(MAX_PROVIDER_COOLDOWN_MS, Math.max(30_000, requestedDuration));
  const nextCooldown = Math.min(maxCooldownUntil, safeNow + duration);
  return { ...state, providers: { ...state.providers, [market]: { ...current, cooldownUntil: Math.max(currentCooldown, nextCooldown) } } };
}
