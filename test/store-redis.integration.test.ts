// Runs the Redis room store's Lua scripts and pub/sub against a real Redis (ioredis-mock does not run Lua).
//   REDIS_TEST_URL=redis://127.0.0.1:6379 npm run test:redis
// Needs a disposable, local Redis. Every key goes under a per-run prefix (ioredis `keyPrefix`, which also prefixes
// the KEYS of EVAL) and only those keys are deleted afterwards. Pub/sub channels are not prefixed by ioredis, so
// room codes carry a per-run tag instead. RECORD_SCRIPT builds keys from ARGV, out of keyPrefix's reach: that test
// writes unprefixed, run-tagged keys and removes exactly those.
import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GameRecord } from "../src/game/protocol";
import { type RoomStore, createRedisRoomStore, keysFor, nameKey } from "../src/server/store";

const URL_ = process.env.REDIS_TEST_URL;
if (!URL_) throw new Error("REDIS_TEST_URL is not set: npm run test:redis needs a disposable Redis (CI starts redis:7)");
const HOST = new URL(URL_).hostname;
// Loopback only: "redis" is the production Redis's host name inside compose.selfhost.yml, so it is not allowed.
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(HOST))
  throw new Error(`REDIS_TEST_URL must point at a local, disposable Redis (got host ${HOST})`);
for (const name of ["REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL"])
  if (process.env[name] && process.env[name] === URL_) throw new Error(`REDIS_TEST_URL is the server's ${name}: use a disposable Redis`);

const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const PREFIX = `it:${RUN}:`;
const K = keysFor("tienlen");
const ROOM_TTL_SECONDS = 12 * 60 * 60;
let n = 0;
const newCode = () => `IT${RUN}${++n}`;

type TestRoom = { code: string; by?: string; round?: number };

const clients: Redis[] = [];
const stores: RoomStore<TestRoom>[] = [];
const connect = (prefix = PREFIX) => {
  const c = new IORedis(URL_, { keyPrefix: prefix, maxRetriesPerRequest: 1, connectTimeout: 5_000 });
  clients.push(c);
  return c;
};
const newStore = () => {
  const s = createRedisRoomStore<TestRoom>(connect());
  stores.push(s);
  return s;
};
/** Unprefixed: reads TTLs and scores by full key name and cleans up. */
let admin: Redis;
/** Removal of the few unprefixed keys a test had to write (see the recordGame test). */
const unprefixedCleanup: (() => Promise<void>)[] = [];
const full = (key: string) => PREFIX + key;

/** Polls a condition with a hard deadline (no fixed sleeps). */
async function waitFor(cond: () => boolean | Promise<boolean>, what: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  admin = connect("");
  // Fails the run (not a skip) when Redis is unreachable.
  expect(await admin.ping()).toBe("PONG");
});

afterAll(async () => {
  for (const s of stores) (s as unknown as { sub: Redis | null }).sub?.disconnect();
  if (admin) {
    for (const clean of unprefixedCleanup) await clean();
    const keys: string[] = [];
    for await (const batch of admin.scanStream({ match: `${PREFIX}*`, count: 200 })) keys.push(...(batch as string[]));
    if (keys.length) await admin.del(...keys);
    expect(await admin.exists(...(keys.length ? keys : [`${PREFIX}none`]))).toBe(0);
  }
  for (const c of clients) c.disconnect();
});

describe("Redis room store (real Redis)", () => {
  it("create stores version 1 with the room TTL and an index entry, and refuses a taken code", async () => {
    const s = newStore();
    const code = newCode();
    const before = Date.now();
    expect(await s.create({ code })).toBe(true);
    expect(await s.create({ code, by: "again" })).toBe(false);
    expect(await s.load(code)).toEqual({ state: { code }, version: 1 });
    const ttl = await admin.ttl(full(K.room(code)));
    expect(ttl).toBeGreaterThan(ROOM_TTL_SECONDS - 10);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_SECONDS);
    expect(Number(await admin.zscore(full(K.index), code))).toBeGreaterThanOrEqual(before);
  });

  it("CAS: of two connections saving the same version, exactly one wins, 20 rounds out of 20", async () => {
    const a = newStore();
    const b = newStore();
    const watcher = newStore();
    const code = newCode();
    await a.create({ code });
    const seen: (number | undefined)[] = [];
    await watcher.subscribe(code, (v) => seen.push(v));

    const ROUNDS = 20;
    for (let round = 0; round < ROUNDS; round++) {
      // Barrier: both sides read the same version before either writes.
      const [ra, rb] = await Promise.all([a.load(code), b.load(code)]);
      expect(ra!.version).toBe(rb!.version);
      const v = ra!.version;
      const [wa, wb] = await Promise.all([a.save({ code, by: "A", round }, v), b.save({ code, by: "B", round }, v)]);
      expect([wa, wb].filter(Boolean)).toHaveLength(1);
      const after = await a.load(code);
      expect(after!.version).toBe(v + 1);
      expect(after!.state).toEqual({ code, by: wa ? "A" : "B", round });
    }

    // One more save as a sentinel: once it arrives, every earlier message has too (same channel, in order).
    await a.save({ code, by: "sentinel" }, ROUNDS + 1);
    await waitFor(() => seen.includes(ROUNDS + 2), "the sentinel message");
    // Only winners published: versions 2..21, then the sentinel's 22.
    expect(seen).toEqual(Array.from({ length: ROUNDS + 1 }, (_, i) => i + 2));
  });

  it("a losing save changes nothing: no state, version, TTL, index score or message", async () => {
    const s = newStore();
    const watcher = newStore();
    const code = newCode();
    await s.create({ code, by: "first" });
    await admin.expire(full(K.room(code)), 100);
    await admin.zadd(full(K.index), 1, code);
    const seen: (number | undefined)[] = [];
    await watcher.subscribe(code, (v) => seen.push(v));

    expect(await s.save({ code, by: "stale" }, 7)).toBe(false);
    expect(await s.load(code)).toEqual({ state: { code, by: "first" }, version: 1 });
    expect(await admin.ttl(full(K.room(code)))).toBeLessThanOrEqual(100);
    expect(await admin.zscore(full(K.index), code)).toBe("1");

    // The winning save does all of it, and its message is the first one seen.
    expect(await s.save({ code, by: "second" }, 1)).toBe(true);
    expect(await s.load(code)).toEqual({ state: { code, by: "second" }, version: 2 });
    expect(await admin.ttl(full(K.room(code)))).toBeGreaterThan(ROOM_TTL_SECONDS - 10);
    expect(Number(await admin.zscore(full(K.index), code))).toBeGreaterThan(1);
    await waitFor(() => seen.length > 0, "the winning save's message");
    expect(seen).toEqual([2]);
  });

  it("an expired room loads as null, refuses saves, and its code can be created again", async () => {
    const s = newStore();
    const code = newCode();
    await s.create({ code, by: "old" });
    await admin.pexpire(full(K.room(code)), 1);
    await waitFor(async () => (await admin.exists(full(K.room(code)))) === 0, "the room to expire");
    expect(await s.load(code)).toBeNull();
    expect(await s.save({ code, by: "late" }, 1)).toBe(false);
    expect(await admin.exists(full(K.room(code)))).toBe(0);
    expect(await s.create({ code, by: "new" })).toBe(true);
    expect(await s.load(code)).toEqual({ state: { code, by: "new" }, version: 1 });
  });

  it("subscribe fans out to every listener; the last unsubscribe releases the channel", async () => {
    const writer = newStore();
    const reader = newStore();
    const code = newCode();
    const channel = K.channel(code); // channels are not prefixed
    await writer.create({ code });
    const one: (number | undefined)[] = [];
    const two: (number | undefined)[] = [];
    const offOne = await reader.subscribe(code, (v) => one.push(v));
    const offTwo = await reader.subscribe(code, (v) => two.push(v));
    expect(await admin.pubsub("NUMSUB", channel)).toEqual([channel, 1]); // one Redis subscription for both

    await writer.save({ code }, 1);
    await waitFor(() => one.length === 1 && two.length === 1, "both listeners");
    expect([one, two]).toEqual([[2], [2]]);

    offOne();
    await writer.save({ code }, 2);
    await waitFor(() => two.length === 2, "the remaining listener");
    expect(one).toEqual([2]);
    expect(two).toEqual([2, 3]);

    offTwo();
    await waitFor(async () => ((await admin.pubsub("NUMSUB", channel)) as [string, number])[1] === 0, "the channel to be released");
  });

  it("recordGame runs its Lua (cjson) once per record id", async () => {
    // RECORD_SCRIPT builds the player-hash keys from ARGV, not KEYS, so ioredis' keyPrefix cannot reach them:
    // this test runs unprefixed, with run-tagged names, and removes exactly the keys and members it wrote.
    const s = createRedisRoomStore<TestRoom>(connect(""));
    const name = `It${RUN}`;
    const keys = [name, `${name}b`].map(nameKey);
    unprefixedCleanup.push(async () => {
      await admin.zrem(K.lbPoints, ...keys);
      await admin.del(...keys.map(K.lbPlayer), K.record(`rec-${RUN}`));
    });
    const record: GameRecord = {
      id: `rec-${RUN}`,
      at: 1_700_000_000_000,
      instantWin: null,
      results: [
        { id: "p1", name, rank: 0, delta: 3 },
        { id: "p2", name: `${name}b`, rank: 1, delta: -3 },
      ],
    };
    await s.recordGame(record);
    await s.recordGame(record); // retried: ignored
    // Read the stored rows directly: the shared points zset may hold other runs' entries above ours.
    expect(await admin.zscore(K.lbPoints, keys[0])).toBe("3");
    expect(await admin.zscore(K.lbPoints, keys[1])).toBe("-3");
    expect(await admin.hgetall(K.lbPlayer(keys[0]))).toEqual({ name, points: "3", games: "1", wins: "1", last: String(record.at) });
    expect(await admin.hgetall(K.lbPlayer(keys[1]))).toEqual({ name: `${name}b`, points: "-3", games: "1", wins: "0", last: String(record.at) });
    expect(await admin.exists(K.record(`rec-${RUN}`))).toBe(1);
  });
});
