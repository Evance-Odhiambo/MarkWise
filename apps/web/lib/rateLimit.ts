// In-memory rate limiter with automatic cleanup to prevent unbounded growth.
// For multi-instance deployments, replace with Redis-backed storage.
interface RateLimitOptions {
  windowMs: number; // Time window in ms
  max: number;      // Max requests per window
}

const hits = new Map<string, { count: number; expires: number }>();

const MAX_ENTRIES = 100_000;
const EVICT_RATIO = 0.2; // evict 20% of entries when cap is reached

// Periodic cleanup: remove expired entries every 60 seconds
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.expires) hits.delete(key);
    }
    // If still over cap after expiry cleanup, evict oldest entries
    if (hits.size > MAX_ENTRIES) {
      const toEvict = Math.ceil(hits.size * EVICT_RATIO);
      let evicted = 0;
      for (const key of hits.keys()) {
        hits.delete(key);
        if (++evicted >= toEvict) break;
      }
    }
  }, 60_000).unref();
}

export function rateLimit(options: RateLimitOptions) {
  scheduleCleanup();
  return async function (key: string): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.expires) {
      hits.set(key, { count: 1, expires: now + options.windowMs });
      return { allowed: true, remaining: options.max - 1 };
    }

    entry.count++;
    return {
      allowed: entry.count <= options.max,
      remaining: Math.max(0, options.max - entry.count),
    };
  };
}
