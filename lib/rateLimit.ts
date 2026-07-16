interface WindowEntry {
  count: number;
  resetAt: number;
}

interface LimitResult {
  allowed: boolean;
  minuteLimit: number;
  minuteRemaining: number;
  dailyLimit: number;
  dailyRemaining: number;
  retryAfterSeconds: number;
}

const minuteStore = new Map<string, WindowEntry>();
const dailyStore = new Map<string, WindowEntry>();
const concurrencyStore = new Map<string, number>();

const MINUTE_WINDOW_MS = 60_000;
const DAY_WINDOW_MS = 86_400_000;
const MINUTE_LIMIT = 18;
const DAILY_LIMIT = 350;
const MAX_CONCURRENT = 2;

function consume(
  store: Map<string, WindowEntry>,
  key: string,
  windowMilliseconds: number,
  limit: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const entry = { count: 1, resetAt: now + windowMilliseconds };
    store.set(key, entry);
    return { allowed: true, remaining: limit - 1, resetAt: entry.resetAt };
  }

  current.count += 1;
  store.set(key, current);
  return {
    allowed: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt
  };
}

export function checkRateLimit(identifier: string, scope: string): LimitResult {
  const key = `${scope}:${identifier}`;
  const minute = consume(minuteStore, key, MINUTE_WINDOW_MS, MINUTE_LIMIT);
  const daily = consume(dailyStore, key, DAY_WINDOW_MS, DAILY_LIMIT);
  const resetAt = !minute.allowed ? minute.resetAt : daily.resetAt;

  return {
    allowed: minute.allowed && daily.allowed,
    minuteLimit: MINUTE_LIMIT,
    minuteRemaining: minute.remaining,
    dailyLimit: DAILY_LIMIT,
    dailyRemaining: daily.remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000))
  };
}

export function acquireConcurrency(identifier: string): boolean {
  const current = concurrencyStore.get(identifier) ?? 0;
  if (current >= MAX_CONCURRENT) return false;
  concurrencyStore.set(identifier, current + 1);
  return true;
}

export function releaseConcurrency(identifier: string): void {
  const current = concurrencyStore.get(identifier) ?? 0;
  if (current <= 1) concurrencyStore.delete(identifier);
  else concurrencyStore.set(identifier, current - 1);
}
