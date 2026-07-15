interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();
const WINDOW_MS = 60_000;
const LIMIT = 20;

export function checkRateLimit(identifier: string): {
  allowed: boolean;
  limit: number;
  remaining: number;
} {
  const now = Date.now();
  const current = store.get(identifier);

  if (!current || current.resetAt <= now) {
    store.set(identifier, {
      count: 1,
      resetAt: now + WINDOW_MS
    });

    return {
      allowed: true,
      limit: LIMIT,
      remaining: LIMIT - 1
    };
  }

  current.count += 1;
  store.set(identifier, current);

  return {
    allowed: current.count <= LIMIT,
    limit: LIMIT,
    remaining: Math.max(0, LIMIT - current.count)
  };
}
