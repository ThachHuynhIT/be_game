import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { createMemoryAccountStore, type AccountStore } from "../src/accounts/store";
import { createPgAccountStore } from "../src/accounts/pg";
import { MIGRATIONS, migrate } from "../src/accounts/migrations";

async function pgStore(): Promise<AccountStore> {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return createPgAccountStore(new Pool());
}
const base = { passwordHash: "scrypt$x", role: "user" as const, icon: "", color: "#fbbf24" };

describe.each([["memory", async () => createMemoryAccountStore()], ["postgres (pg-mem)", pgStore]])("%s account store", (_, make) => {
  it("creates a user and refuses a second one with the same key", async () => {
    const s = await make();
    const u = await s.createUser({ ...base, usernameKey: "lan", username: "Lan" });
    expect(u).toMatchObject({ username: "Lan", role: "user", disabled: false, sessionVersion: 0 });
    expect(await s.createUser({ ...base, usernameKey: "lan", username: "LAN" })).toBeNull();
    expect((await s.userByKey("lan"))?.id).toBe(u!.id);
    expect((await s.userById(u!.id))?.username).toBe("Lan");
  });
  it("patches fields and bumps the session version", async () => {
    const s = await make();
    const u = (await s.createUser({ ...base, usernameKey: "minh", username: "Minh" }))!;
    const v = await s.updateUser(u.id, { role: "admin", icon: "🦊", bumpSession: true });
    expect(v).toMatchObject({ role: "admin", icon: "🦊", sessionVersion: 1 });
    expect(await s.updateUser("00000000-0000-0000-0000-000000000000", { icon: "x" })).toBeNull();
  });
  it("lists users by name, newest first, with paging", async () => {
    const s = await make();
    for (const n of ["An", "Bình", "Anh"]) await s.createUser({ ...base, usernameKey: n.toLowerCase(), username: n });
    const r = await s.listUsers("an", 1, 50);
    expect(r.total).toBe(2);
    expect(r.rows.map((x) => x.username).sort()).toEqual(["An", "Anh"]);
    expect((await s.listUsers("", 2, 2)).rows).toHaveLength(1);
  });
  it("orders newest first by createdAt", async () => {
    const s = await make();
    for (const [n, t] of [["old", 1000], ["new", 3000], ["mid", 2000]] as const) await s.createUser({ ...base, usernameKey: n, username: n, createdAt: new Date(t) });
    expect((await s.listUsers("", 1, 50)).rows.map((x) => x.username)).toEqual(["new", "mid", "old"]);
  });
  it("treats % in the search as a literal", async () => {
    const s = await make();
    await s.createUser({ ...base, usernameKey: "abc", username: "abc" });
    expect((await s.listUsers("%", 1, 50)).total).toBe(0);
  });
});

it("memory: _ in the search does not act as a wildcard", async () => {
  const s = createMemoryAccountStore();
  await s.createUser({ ...base, usernameKey: "axb", username: "axb" });
  expect((await s.listUsers("a_b", 1, 50)).total).toBe(0);
});

describe("migrations", () => {
  it("can run twice on the same db", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    await createPgAccountStore(pool);
    const s = await createPgAccountStore(pool);
    expect(await s.createUser({ ...base, usernameKey: "a", username: "a" })).not.toBeNull();
  });
  it("survives a pre-existing users table with no schema_migrations row", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    await migrate((sql, params) => pool.query(sql, params as any[]));
    await pool.query("delete from schema_migrations");
    const s = await createPgAccountStore(pool);
    expect(await s.createUser({ ...base, usernameKey: "a", username: "a" })).not.toBeNull();
  });
});

describe("migration locking (transaction-scoped, pooler-safe)", () => {
  /** pg-mem pool whose clients pretend pg_advisory_xact_lock exists (as on real Postgres) and log every statement. */
  function lockingPool(onLock: () => void = () => {}) {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const log: string[] = [];
    const released: unknown[] = [];
    const connect = pool.connect.bind(pool);
    let connects = 0;
    pool.connect = (async () => {
      connects++;
      const client = await connect();
      const query = client.query.bind(client);
      const release = client.release.bind(client);
      client.query = (async (sql: string, params?: unknown[]) => {
        log.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
        if (/pg_advisory_xact_lock/.test(sql)) {
          onLock();
          return { rows: [{}] };
        }
        return query(sql, params as any[]);
      }) as any;
      client.release = ((arg?: unknown) => {
        released.push(arg);
        return release();
      }) as any;
      return client;
    }) as any;
    return { pool, log, released, connects: () => connects };
  }

  it("migrates inside BEGIN / SET LOCAL lock_timeout / pg_advisory_xact_lock / COMMIT on one client", async () => {
    const t = lockingPool();
    const s = await createPgAccountStore(t.pool);
    expect(t.connects()).toBe(1);
    expect(t.log.slice(0, 4)).toEqual(["begin", "set local lock_timeout =", "set local statement_timeout =", "select pg_advisory_xact_lock($1)"]);
    expect(t.log[t.log.length - 1]).toBe("commit");
    expect(t.log.some((l) => /advisory_unlock|pg_advisory_lock\(/.test(l))).toBe(false);
    expect(t.released).toEqual([undefined]);
    expect(await s.createUser({ ...base, usernameKey: "a", username: "a" })).not.toBeNull();
  });

  it("skips the lock and the dedicated client when every migration is recorded", async () => {
    const t = lockingPool();
    await createPgAccountStore(t.pool);
    t.log.length = 0;
    await createPgAccountStore(t.pool);
    expect(t.connects()).toBe(1);
    expect(t.log.filter((l) => /begin|advisory|create/.test(l))).toEqual([]);
  });

  it("rolls back and fails (to be retried) when the lock times out, and a later attempt succeeds", async () => {
    let fail = true;
    const t = lockingPool(() => {
      if (fail) throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    });
    await expect(createPgAccountStore(t.pool)).rejects.toThrow(/lock timeout/);
    expect(t.log).toEqual(["begin", "set local lock_timeout =", "set local statement_timeout =", "select pg_advisory_xact_lock($1)", "rollback"]);
    expect(t.released).toEqual([undefined]);
    fail = false;
    const s = await createPgAccountStore(t.pool);
    expect(await s.createUser({ ...base, usernameKey: "a", username: "a" })).not.toBeNull();
  });

  it("falls back to an unlocked transaction when the lock function is missing (pg-mem)", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    await createPgAccountStore(pool);
    expect((await pool.query("select id from schema_migrations")).rows.length).toBeGreaterThan(0);
  });
});

describe("account service init", () => {
  it("does not cache an init that hangs: it times out and the next call retries", async () => {
    const { getAccountService, resetAccountServiceForTests, createAccountService } = await import("../src/accounts/service");
    const { memoryRateLimiter } = await import("../src/accounts/rateLimit");
    let calls = 0;
    resetAccountServiceForTests({
      timeoutMs: 30,
      build: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve(createAccountService(createMemoryAccountStore(), memoryRateLimiter()))),
    });
    await expect(getAccountService()).rejects.toThrow(/timed out/);
    await expect(getAccountService()).resolves.toBeTruthy();
    expect(calls).toBe(2);
    resetAccountServiceForTests();
  });

  it("does not cache a failed init", async () => {
    const { getAccountService, resetAccountServiceForTests, createAccountService } = await import("../src/accounts/service");
    const { memoryRateLimiter } = await import("../src/accounts/rateLimit");
    let calls = 0;
    resetAccountServiceForTests({
      build: async () => {
        if (++calls === 1) throw new Error("neon down");
        return createAccountService(createMemoryAccountStore(), memoryRateLimiter());
      },
    });
    await expect(getAccountService()).rejects.toThrow("neon down");
    await expect(getAccountService()).resolves.toBeTruthy();
    resetAccountServiceForTests();
  });
});

describe("migration 2: integrity constraints", () => {
  const fresh = () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    return new Pool();
  };

  it("rejects an unknown role and a result for a missing user", async () => {
    const pool = fresh();
    const s = await createPgAccountStore(pool);
    const u = (await s.createUser({ ...base, usernameKey: "a", username: "a" }))!;
    await expect(pool.query("update users set role = 'root' where id = $1", [u.id])).rejects.toThrow();
    await expect(
      pool.query("insert into game_results (game, record_id, user_id, points, rank, won, at, day) values ('tienlen', 'r1', '00000000-0000-4000-8000-000000000009', 1, 1, true, now(), '2026-10-16')"),
    ).rejects.toThrow();
    await s.recordResults("tienlen", "r2", new Date(), [{ usernameKey: "a", points: 3, rank: 1 }]);
    expect((await s.leaderboard("tienlen", 10))[0]).toMatchObject({ name: "a", points: 3 });
  });

  it("upgrades a v1 database (dropping orphan results) and is safe to re-run", async () => {
    const pool = fresh();
    const q = (sql: string, params?: unknown[]) => pool.query(sql, params as any[]);
    await q("create table schema_migrations (id int primary key)");
    for (const stmt of MIGRATIONS[0].sql!.split(";").map((x) => x.trim()).filter(Boolean)) await q(stmt);
    await q("insert into schema_migrations (id) values (1)");
    await q("insert into game_results (game, record_id, user_id, points, rank, won, at, day) values ('tienlen', 'r1', '00000000-0000-4000-8000-000000000009', 1, 1, true, now(), '2026-10-16')");
    await createPgAccountStore(pool);
    expect((await q("select id from schema_migrations order by id")).rows.map((r: any) => Number(r.id))).toEqual([1, 2]);
    expect((await q("select * from game_results")).rows).toHaveLength(0);
    // Lost bookkeeping (row deleted) must not break a second run over existing constraints.
    await q("delete from schema_migrations where id = 2");
    await createPgAccountStore(pool);
    expect((await q("select id from schema_migrations order by id")).rows.map((r: any) => Number(r.id))).toEqual([1, 2]);
  });
});
