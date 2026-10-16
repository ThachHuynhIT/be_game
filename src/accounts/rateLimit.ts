export interface RateLimiter {
  /** Records a hit; true = allowed. */
  hit(bucket: string, limit: number, windowSec: number): Promise<boolean>;
}

export function redisRateLimiter(redis: { incr(k: string): Promise<number>; expire(k: string, s: number): Promise<unknown> }): RateLimiter {
  return {
    async hit(bucket, limit, windowSec) {
      const key = `be_game:rl:${bucket}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSec);
      return n <= limit;
    },
  };
}

export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(bucket, limit, windowSec) {
      const t = now();
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
