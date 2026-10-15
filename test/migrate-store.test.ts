import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import RedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateAll, migrateGame, migratedMarkerKey, runMigration } from "../src/tools/migrate-store";
import { keysFor } from "../src/server/store";

// vitest runs from the repo root (npm test), so paths are resolved from the cwd (tsconfig is CommonJS, no import.meta).
const CLI = resolve(process.cwd(), "src/tools/migrate-store.ts");
const TSX = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
/** Runs the real CLI through tsx. Fake hosts only: the refusal checks exit before any connection is attempted. */
function runCli(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [TSX, CLI, ...args], { encoding: "utf8", timeout: 30_000, env: { ...process.env, ...env } });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

type R = InstanceType<typeof RedisMock>;
let src: R;
let dst: R;
const k = keysFor("typhu");

// ioredis-mock keeps data per port (verified: a set on port 1 is null on port 2), so no keyPrefix is needed.
afterEach(() => {
  // Each mock subscribes to a shared per-port emitter; disconnect releases it.
  src.disconnect();
  dst.disconnect();
});

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

describe("runMigration re-run guard", () => {
  const source = { host: "redis", port: "6379" };
  const marker = migratedMarkerKey(source);
  const at = new Date("2026-10-15T08:00:00.000Z");
  const run = (o: { dryRun?: boolean; force?: boolean } = {}) =>
    runMigration(src as never, dst as never, { source, dryRun: o.dryRun ?? false, force: o.force ?? false, now: () => at });

  it("names the marker after the source host and port", () => {
    expect(marker).toBe("be_game:migrated:redis:6379");
  });

  it("sets the marker (ISO time) after a successful real run", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    const out = await run();
    expect(out.status).toBe("done");
    expect(await dst.get(marker)).toBe("2026-10-15T08:00:00.000Z");
  });

  it("refuses a second real run: no writes, no leaderboard change", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    await run();
    await seedPlayer(src, "minh", { name: "Minh", points: 5, games: 1, wins: 1, last: 300 });
    const before = await dst.dbsize();
    const out = await run();
    expect(out).toEqual({
      status: "refused",
      message: "already migrated from redis at 2026-10-15T08:00:00.000Z: re-running would add leaderboards twice (pass --force to override)",
    });
    expect(Number(await dst.zscore(k.lbPoints, "lan"))).toBe(10);
    expect(await dst.zscore(k.lbPoints, "minh")).toBeNull();
    expect(await dst.dbsize()).toBe(before);
  });

  it("--force runs again (and adds again)", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    await run();
    const out = await run({ force: true });
    expect(out.status).toBe("done");
    expect(Number(await dst.zscore(k.lbPoints, "lan"))).toBe(20);
  });

  it("a dry run writes no marker and still runs when the marker exists, only reporting it", async () => {
    const first = await run({ dryRun: true });
    expect(first).toMatchObject({ status: "done", alreadyMigratedAt: null });
    expect(await dst.exists(marker)).toBe(0);
    await dst.set(marker, "2026-01-01T00:00:00.000Z");
    const second = await run({ dryRun: true });
    expect(second).toMatchObject({ status: "done", alreadyMigratedAt: "2026-01-01T00:00:00.000Z" });
    expect(await dst.get(marker)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves no marker when a game fails midway", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    const failing = { ...dst, get: dst.get.bind(dst), multi: () => { throw new Error("boom"); } };
    await expect(runMigration(src as never, failing as never, { source, dryRun: false, force: false })).rejects.toThrow("boom");
    expect(await dst.exists(marker)).toBe(0);
  });
});

describe("CLI guards", () => {
  it("never prints a store password, even when a URL is malformed", () => {
    const r = runCli(["--from", "redis://u:SECRETPW@h:99999", "--to", "redis://x:y@h2:6379", "--dry-run"]);
    expect(r.status).toBe(1);
    expect(r.output).not.toContain("SECRETPW");
    expect(r.output).toContain("invalid --from URL");
  }, 30_000);

  it("reads env:NAME values (the URL never goes on argv) and still never prints a malformed one", () => {
    const r = runCli(["--from", "env:MIGRATE_TEST_FROM", "--to", "redis://x:y@h2:6379", "--dry-run"], { MIGRATE_TEST_FROM: "redis://u:SECRETPW@h:99999" });
    expect(r.status).toBe(1);
    expect(r.output).toContain("invalid --from URL");
    expect(r.output).not.toContain("SECRETPW");
    expect(r.output).not.toContain("is not set");
  }, 30_000);

  it("refuses env:NAME that is unset or empty, with a fixed message", () => {
    for (const env of [{}, { MIGRATE_TEST_UNSET: "" }] as Record<string, string>[]) {
      const r = runCli(["--from", "redis://a:b@h:6379", "--to", "env:MIGRATE_TEST_UNSET", "--dry-run"], env);
      expect(r.status).toBe(1);
      expect(r.output).toContain("--to env:MIGRATE_TEST_UNSET is not set");
      expect(r.output).not.toContain("→");
    }
  }, 30_000);

  it("refuses to migrate a store into itself, before connecting", () => {
    const r = runCli(["--from", "redis://a:SAMEPW@h:6379", "--to", "redis://b:OTHERPW@h:6379"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("--from and --to are the same store");
    expect(r.output).not.toContain("SAMEPW");
    expect(r.output).not.toContain("→");
  }, 30_000);
});
