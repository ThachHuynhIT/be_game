import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INDEX_PRUNE_INTERVAL_MS,
  LEADERBOARD_CACHE_MS,
  RECENT_ROOMS_CACHE_MS,
  createRedisRoomStore,
} from "../src/server/store";

/** The few ioredis calls the lobby/leaderboard reads make, counting every command sent. */
function fakeRedis() {
  const calls: string[] = [];
  const pipeline = () => {
    const queued: string[] = [];
    const p = {
      hget: (key: string) => (queued.push(`hget ${key}`), p),
      hmget: (key: string) => (queued.push(`hmget ${key}`), p),
      exec: async () => {
        calls.push(...queued);
        return queued.map((q) =>
          q.startsWith("hget") ? [null, JSON.stringify({ code: q.split(":").pop() })] : [null, ["Ann", "3", "1", "1", "0"]],
        );
      },
    };
    return p;
  };
  const redis = {
    zremrangebyscore: async () => (calls.push("zremrangebyscore"), 0),
    zrevrangebyscore: async () => (calls.push("zrevrangebyscore"), ["AAAA", "BBBB"]),
    zrevrange: async () => (calls.push("zrevrange"), ["ann"]),
    eval: async () => (calls.push("eval"), 1),
    pipeline,
  };
  return { redis, calls };
}

describe("RedisRoomStore read caching", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("serves repeated and concurrent lobby reads from one Redis read until the cache expires", async () => {
    const { redis, calls } = fakeRedis();
    const store = createRedisRoomStore(redis as never);

    const [a, b] = await Promise.all([store.recentRooms(60), store.recentRooms(60)]);
    expect(a.map((r) => r.code)).toEqual(["AAAA", "BBBB"]);
    expect(b).toBe(a);
    const first = calls.length; // prune + range + 2 hget
    expect(first).toBe(4);

    vi.advanceTimersByTime(RECENT_ROOMS_CACHE_MS - 1);
    await store.recentRooms(60);
    expect(calls.length).toBe(first);

    vi.advanceTimersByTime(1);
    await store.recentRooms(60);
    // Fresh read, but no second prune within INDEX_PRUNE_INTERVAL_MS.
    expect(calls.slice(first)).toEqual(["zrevrangebyscore", "hget tienlen:room:AAAA", "hget tienlen:room:BBBB"]);

    vi.advanceTimersByTime(INDEX_PRUNE_INTERVAL_MS);
    const before = calls.length;
    await store.recentRooms(60);
    expect(calls[before]).toBe("zremrangebyscore");
  });

  it("does not cache a failed read", async () => {
    const { redis, calls } = fakeRedis();
    let fail = true;
    const range = redis.zrevrangebyscore;
    redis.zrevrangebyscore = async () => {
      if (fail) throw new Error("down");
      return range();
    };
    const store = createRedisRoomStore(redis as never);
    await expect(store.recentRooms(60)).rejects.toThrow("down");
    fail = false;
    await expect(store.recentRooms(60)).resolves.toHaveLength(2);
    expect(calls).toContain("hget tienlen:room:AAAA");
  });

  it("caches the leaderboard, and refreshes it after this instance records a game", async () => {
    const { redis, calls } = fakeRedis();
    const store = createRedisRoomStore(redis as never);

    await store.leaderboard(20);
    await store.leaderboard(20);
    expect(calls.filter((c) => c === "zrevrange")).toHaveLength(1);

    await store.recordGame({ id: "g1", at: 1, results: [] } as never);
    await store.leaderboard(20);
    expect(calls.filter((c) => c === "zrevrange")).toHaveLength(2);

    vi.advanceTimersByTime(LEADERBOARD_CACHE_MS);
    await store.leaderboard(20);
    expect(calls.filter((c) => c === "zrevrange")).toHaveLength(3);
  });
});
