import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateAll, migrateGame } from "../src/tools/migrate-store";
import { keysFor } from "../src/server/store";

type R = InstanceType<typeof RedisMock>;
let src: R;
let dst: R;
const k = keysFor("typhu");

// ioredis-mock keeps data per port (verified: a set on port 1 is null on port 2), so no keyPrefix is needed.
beforeEach(async () => {
  src = new RedisMock({ port: 1 });
  dst = new RedisMock({ port: 2 });
  await src.flushall();
  await dst.flushall();
});

async function seedPlayer(r: R, key: string, f: { name: string; points: number; games: number; wins: number; last: number }) {
  await r.zincrby(k.lbPoints, f.points, key);
  await r.hset(k.lbPlayer(key), { name: f.name, points: f.points, games: f.games, wins: f.wins, last: f.last });
}

describe("migrateGame", () => {
  it("adds leaderboard totals for players on both sides and keeps the newest name", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    await seedPlayer(dst, "lan", { name: "lan", points: 4, games: 1, wins: 0, last: 100 });
    await seedPlayer(src, "minh", { name: "Minh", points: -2, games: 1, wins: 0, last: 150 });
    const r = await migrateGame(src as never, dst as never, "typhu", false);
    expect(r.players).toBe(2);
    expect(Number(await dst.zscore(k.lbPoints, "lan"))).toBe(14);
    expect(await dst.hgetall(k.lbPlayer("lan"))).toMatchObject({ name: "Lan", points: "14", games: "4", wins: "1", last: "200" });
    expect(Number(await dst.zscore(k.lbPoints, "minh"))).toBe(-2);
  });

  it("copies rooms the destination does not have, with their remaining TTL and lobby score", async () => {
    await src.hset(k.room("AAAAA"), { state: '{"code":"AAAAA"}', version: 7 });
    await src.pexpire(k.room("AAAAA"), 3_600_000);
    await src.zadd(k.index, 1234, "AAAAA");
    await src.hset(k.room("BBBBB"), { state: '{"code":"BBBBB","src":1}', version: 2 });
    await src.zadd(k.index, 99, "BBBBB");
    await dst.hset(k.room("BBBBB"), { state: '{"code":"BBBBB","dst":1}', version: 9 });
    const r = await migrateGame(src as never, dst as never, "typhu", false);
    expect(r).toMatchObject({ roomsCopied: 1, roomsSkipped: 1 });
    expect(await dst.hgetall(k.room("AAAAA"))).toEqual({ state: '{"code":"AAAAA"}', version: "7" });
    const ttl = await dst.pttl(k.room("AAAAA"));
    expect(ttl).toBeGreaterThan(3_590_000);
    expect(Number(await dst.zscore(k.index, "AAAAA"))).toBe(1234);
    expect((await dst.hgetall(k.room("BBBBB"))).state).toBe('{"code":"BBBBB","dst":1}');
  });

  it("skips index entries whose room is gone and never copies dedupe markers", async () => {
    await src.zadd(k.index, 1, "GONE1");
    await src.set(k.record("g-1"), "1");
    const r = await migrateGame(src as never, dst as never, "typhu", false);
    expect(r.roomsCopied).toBe(0);
    expect(await dst.exists(k.record("g-1"))).toBe(0);
    expect(await dst.zcard(k.index)).toBe(0);
  });

  it("writes nothing on a dry run but reports what it would do", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    await src.hset(k.room("AAAAA"), { state: "{}", version: 1 });
    await src.zadd(k.index, 1, "AAAAA");
    const r = await migrateGame(src as never, dst as never, "typhu", true);
    expect(r).toMatchObject({ players: 1, roomsCopied: 1, roomsSkipped: 0 });
    expect(await dst.dbsize()).toBe(0);
  });
});

describe("migrateAll", () => {
  it("covers every game", async () => {
    const all = await migrateAll(src as never, dst as never, true);
    expect(all.map((r) => r.game).sort()).toEqual(["bang", "cangua", "meono", "oanquan", "splendor", "tienlen", "typhu"]);
  });
});
