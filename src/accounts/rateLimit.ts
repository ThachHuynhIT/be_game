export interface RateLimiter {
  /** Records a hit; true = allowed. */
  hit(bucket: string, limit: number, windowSec: number): Promise<boolean>;
}

export function redisRateLimiter(redis: {
  incr(k: string): Promise<number>;
  set(k: string, v: string | number, ...args: (string | number)[]): Promise<unknown>;
}): RateLimiter {
  return {
    async hit(bucket, limit, windowSec) {
      const key = `be_game:rl:${bucket}`;
      // Create the key with its TTL atomically (no-op if it exists), then count; a key never lacks a TTL.
      await redis.set(key, 0, "EX", windowSec, "NX");
      const n = await redis.incr(key);
      return n <= limit;
    },
  };
}

export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return {
    async hit(bucket, limit, windowSec) {
      const t = now();
      if (t - lastSweep >= 60_000) {
        lastSweep = t;
        for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
      }
      let b = buckets.get(bucket);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + windowSec * 1000 };
        buckets.set(bucket, b);
      }
      b.count++;
      return b.count <= limit;
    },
  };
}
