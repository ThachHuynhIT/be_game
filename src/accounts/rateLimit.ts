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
