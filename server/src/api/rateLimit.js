// In-memory token buckets keyed by (rule, client). Good enough for a single instance; a
// multi-instance deployment would move this to a shared store (see README limitations).
// Memory is bounded: idle buckets are swept, and the table has a hard size cap.

const MAX_KEYS = 50_000;

export function createRateLimiter({ scale = 1, now = Date.now } = {}) {
  const buckets = new Map();

  // rule: { name, capacity, perMs } — `capacity` requests, refilled evenly over `perMs`.
  function take(rule, key, cost = 1) {
    const id = `${rule.name}:${key}`;
    const capacity = Math.max(1, Math.round(rule.capacity * scale));
    const rate = capacity / rule.perMs;
    const t = now();
    let b = buckets.get(id);
    if (!b) {
      if (buckets.size >= MAX_KEYS) sweep(true);
      b = { tokens: capacity, at: t };
      buckets.set(id, b);
    } else {
      b.tokens = Math.min(capacity, b.tokens + (t - b.at) * rate);
      b.at = t;
    }
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: Math.ceil((cost - b.tokens) / rate / 1000) };
  }

  // Drops buckets idle long enough to have refilled (they'd be recreated full anyway).
  function sweep(aggressive = false) {
    const t = now();
    const idle = aggressive ? 60_000 : 60 * 60_000;
    for (const [id, b] of buckets) if (t - b.at > idle) buckets.delete(id);
    if (buckets.size < MAX_KEYS) return;
    // Still full (many distinct clients): evict the oldest tenth rather than grow unbounded.
    let n = Math.ceil(MAX_KEYS / 10);
    for (const id of buckets.keys()) {
      buckets.delete(id);
      if (--n <= 0) break;
    }
  }

  const timer = setInterval(sweep, 5 * 60_000);
  timer.unref();

  return { take, sweep, size: () => buckets.size, close: () => clearInterval(timer) };
}

// Limits per client IP (or per player where noted). Tuned for real play, not for bursts.
export const RULES = {
  global: { name: 'global', capacity: 240, perMs: 60_000 }, // any API call
  createPlayer: { name: 'create-player', capacity: 5, perMs: 60 * 60_000 },
  rename: { name: 'rename', capacity: 6, perMs: 60 * 60_000 }, // per player
  raceStart: { name: 'race-start', capacity: 40, perMs: 10 * 60_000 }, // per player
  raceFinish: { name: 'race-finish', capacity: 40, perMs: 10 * 60_000 }, // per player
  leaderboard: { name: 'leaderboard', capacity: 60, perMs: 60_000 },
  events: { name: 'events', capacity: 30, perMs: 60_000 },
};
