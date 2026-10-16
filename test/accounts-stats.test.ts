import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { createMemoryAccountStore, type AccountStore } from "../src/accounts/store";
import { createPgAccountStore } from "../src/accounts/pg";

async function pgStore(): Promise<AccountStore> {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return createPgAccountStore(new Pool());
}
const base = { passwordHash: "scrypt$x", role: "user" as const, icon: "", color: "#fbbf24" };

describe.each([["memory", async () => createMemoryAccountStore()], ["postgres (pg-mem)", pgStore]])("%s account stats", (_, make) => {
  it("records each player once per game even when two backends record it", async () => {
    const s = await make();
    await s.createUser({ ...base, usernameKey: "lan", username: "Lan" });
    await s.createUser({ ...base, usernameKey: "minh", username: "Minh" });
    const at = new Date("2026-10-16T05:00:00Z");
    const rows = [{ usernameKey: "lan", points: 3, rank: 1 }, { usernameKey: "minh", points: -1, rank: 2 }, { usernameKey: "ghost", points: 1, rank: 3 }];
    await s.recordResults("tienlen", "g-1", at, rows);
    await s.recordResults("tienlen", "g-1", at, rows); // second backend
    await s.recordResults("tienlen", "g-2", at, [{ usernameKey: "lan", points: 2, rank: 2 }]);
    expect(await s.leaderboard("tienlen", 50)).toEqual([
      { name: "Lan", points: 5, games: 2, wins: 1, icon: "", color: "#fbbf24" },
      { name: "Minh", points: -1, games: 1, wins: 0, icon: "", color: "#fbbf24" },
    ]);
    expect(await s.leaderboard("meono", 50)).toEqual([]);
  });

  it("orders the leaderboard by points, then wins, then name, and honours the limit", async () => {
    const s = await make();
    for (const n of ["Cam", "Bao", "An"]) await s.createUser({ ...base, usernameKey: n.toLowerCase(), username: n });
    const at = new Date("2026-10-16T05:00:00Z");
    await s.recordResults("meono", "g-1", at, [{ usernameKey: "cam", points: 2, rank: 1 }, { usernameKey: "bao", points: 2, rank: 2 }, { usernameKey: "an", points: 2, rank: 3 }]);
    await s.recordResults("meono", "g-2", at, [{ usernameKey: "bao", points: 0, rank: 1 }]);
    expect((await s.leaderboard("meono", 50)).map((r) => r.name)).toEqual(["Bao", "Cam", "An"]);
    expect((await s.leaderboard("meono", 2)).map((r) => r.name)).toEqual(["Bao", "Cam"]);
  });

  it("counts views, devices, games, players and new users per day (UTC+7), padding empty days", async () => {
    const s = await make();
    const now = new Date("2026-10-16T10:00:00Z"); // 17:00 in Vietnam
    const u = (await s.createUser({ ...base, usernameKey: "lan", username: "Lan", createdAt: now }))!;
    await s.trackView({ path: "/", device: "dev-a", userId: null, at: new Date("2026-10-15T18:00:00Z") }); // 16/10 01:00 VN
    await s.trackView({ path: "/tien-len", device: "dev-a", userId: u.id, at: now });
    await s.trackView({ path: "/", device: "dev-b", userId: null, at: new Date("2026-10-14T03:00:00Z") });
    await s.trackView({ path: "/play/tienlen", device: "dev-a", userId: u.id, at: now });
    await s.recordResults("tienlen", "g-1", now, [{ usernameKey: "lan", points: 3, rank: 1 }]);
    const st = await s.stats(7, now);
    expect(st.days).toBe(7);
    expect(st.daily).toHaveLength(7);
    expect(st.daily.at(-1)).toMatchObject({ day: "2026-10-16", views: 2, devices: 1, games: 1, players: 1, newUsers: 1 });
    expect(st.daily.at(-3)).toMatchObject({ day: "2026-10-14", views: 1, devices: 1, games: 0 });
    expect(st.daily[0]).toMatchObject({ day: "2026-10-10", views: 0 });
    expect(st.totals).toMatchObject({ users: 1, newUsers: 1, views: 3, devices: 2, games: 1, players: 1, playDevices: 1 });
    expect(st.byGame).toEqual([{ game: "tienlen", games: 1, players: 1 }]);
    expect(st.topPages[0]).toEqual({ path: "/", views: 2 });
    expect(st.topPlayers).toEqual([{ name: "Lan", games: 1, points: 3 }]);
  });

  it("excludes data outside the window from totals but not users", async () => {
    const s = await make();
    const now = new Date("2026-10-16T10:00:00Z");
    await s.createUser({ ...base, usernameKey: "old", username: "Old", createdAt: new Date("2026-01-01T00:00:00Z") });
    await s.trackView({ path: "/", device: "d", userId: null, at: new Date("2026-09-01T00:00:00Z") });
    const st = await s.stats(7, now);
    expect(st.totals).toMatchObject({ users: 1, newUsers: 0, views: 0, devices: 0 });
  });

  it("prunes views older than the cut-off", async () => {
    const s = await make();
    const now = new Date("2026-10-16T00:00:00Z");
    await s.trackView({ path: "/", device: "d", userId: null, at: new Date("2026-01-01T00:00:00Z") });
    await s.trackView({ path: "/", device: "d", userId: null, at: now });
    expect(await s.pruneViews(180, now)).toBe(1);
    expect((await s.stats(7, now)).totals.views).toBe(1);
  });

  it("lists game counts in listUsers", async () => {
    const s = await make();
    const u = (await s.createUser({ ...base, usernameKey: "lan", username: "Lan" }))!;
    await s.recordResults("tienlen", "g-1", new Date(), [{ usernameKey: "lan", points: 1, rank: 1 }]);
    expect((await s.listUsers("", 1, 50)).rows.find((r) => r.id === u.id)?.games).toBe(1);
  });
});

describe.each([["memory", async () => createMemoryAccountStore()], ["postgres (pg-mem)", pgStore]])("%s stats hardening", (_, make) => {
  it("counts the same record_id in two games as two games", async () => {
    const s = await make();
    const now = new Date("2026-10-16T10:00:00Z");
    await s.createUser({ ...base, usernameKey: "lan", username: "Lan" });
    await s.recordResults("tienlen", "r1", now, [{ usernameKey: "lan", points: 1, rank: 1 }]);
    await s.recordResults("meono", "r1", now, [{ usernameKey: "lan", points: 1, rank: 1 }]);
    const st = await s.stats(7, now);
    expect(st.totals.games).toBe(2);
    expect(st.daily.at(-1)?.games).toBe(2);
  });
  it("breaks topPlayers ties by name", async () => {
    const s = await make();
    const now = new Date("2026-10-16T10:00:00Z");
    for (const n of ["Bao", "An"]) {
      await s.createUser({ ...base, usernameKey: n.toLowerCase(), username: n });
      await s.recordResults("tienlen", "r1", now, [{ usernameKey: n.toLowerCase(), points: 1, rank: 1 }]);
    }
    expect((await s.stats(7, now)).topPlayers.map((p) => p.name)).toEqual(["An", "Bao"]);
  });
});

describe("pruneViews uses the indexed day column", () => {
  it("postgres (pg-mem): deletes by day < cutoff, keeps the cutoff day", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const s = await createPgAccountStore(pool);
    const now = new Date("2026-10-16T05:00:00Z"); // VN day 2026-10-16; 180 days earlier = 2026-04-19
    const ins = (at: Date, day: string) => pool.query("insert into page_views (at, day, path, device_id) values ($1, $2, '/', 'd')", [at, day]);
    await ins(now, "2026-04-18"); // `at` is recent but the day is old: only a day-based prune removes it
    await ins(now, "2026-04-19");
    await ins(now, "2026-10-16");
    const sql: string[] = [];
    const query = pool.query.bind(pool);
    pool.query = ((text: string, params?: unknown[]) => (sql.push(text), query(text, params as any[]))) as any;
    expect(await s.pruneViews(180, now)).toBe(1);
    expect(sql.some((t) => /delete from page_views where day < \$1/.test(t))).toBe(true);
    expect((await query("select day from page_views order by day")).rows.map((r: any) => r.day)).toEqual(["2026-04-19", "2026-10-16"]);
  });

  it("memory: same day boundary", async () => {
    const s = createMemoryAccountStore();
    const now = new Date("2026-10-16T05:00:00Z");
    await s.trackView({ path: "/", device: "d", userId: null, at: new Date("2026-04-18T05:00:00Z") });
    await s.trackView({ path: "/", device: "d", userId: null, at: new Date("2026-04-19T05:00:00Z") });
    expect(await s.pruneViews(180, now)).toBe(1);
  });

  it("runs at most once per 24 h per process", async () => {
    const { pruneViewsIfDue, resetAccountServiceForTests } = await import("../src/accounts/service");
    resetAccountServiceForTests();
    let calls = 0;
    const store = { pruneViews: async () => (calls++, 0) } as unknown as AccountStore;
    const t0 = 1_800_000_000_000;
    expect(pruneViewsIfDue(store, t0)).toBe(true);
    expect(pruneViewsIfDue(store, t0 + 3600_000)).toBe(false);
    expect(pruneViewsIfDue(store, t0 + 23 * 3600_000)).toBe(false);
    expect(pruneViewsIfDue(store, t0 + 24 * 3600_000)).toBe(true);
    expect(calls).toBe(2);
    resetAccountServiceForTests();
  });
});
