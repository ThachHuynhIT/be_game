/**
 * Rate-limit key for a client address. IPv6 is keyed by its /64: one subscriber usually gets a whole /64, so keying the
 * full address would let a client rotate addresses for a fresh bucket each time. IPv4 (and IPv4-mapped IPv6) and
 * anything unparsable are used as they are.
 */
export function ipBucket(ip: string): string {
  let a = ip.trim().toLowerCase();
  if (a.startsWith("[") && a.includes("]")) a = a.slice(1, a.indexOf("]"));
  a = a.replace(/%.*$/, ""); // zone id
  if (!a.includes(":")) return ip;
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  if (!/^[0-9a-f:]+$/.test(a) || (a.match(/::/g) ?? []).length > 1) return ip;
  const [head, tail = ""] = a.split("::");
  const left = head ? head.split(":") : [];
  const right = a.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = a.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => g.length === 0 || g.length > 4)) return ip;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64";
}

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
