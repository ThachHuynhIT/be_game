export interface RateLimiter {
  /** Records a hit; true = allowed. */
  hit(bucket: string, limit: number, windowSec: number): Promise<boolean>;
}

// One atomic step: count the hit, then give the key its window if it has no TTL. The key is new, or it was left
// without a TTL by the previous SET NX EX + INCR pair: when the key expired between those two calls, INCR re-created
// it with no TTL and that bucket stayed blocked for good. Keys left that way heal on their next hit.
const HIT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export function redisRateLimiter(redis: { eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> }): RateLimiter {
  return {
    async hit(bucket, limit, windowSec) {
      const n = Number(await redis.eval(HIT_SCRIPT, 1, `be_game:rl:${bucket}`, windowSec));
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
