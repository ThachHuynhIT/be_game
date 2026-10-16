import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { createMemoryAccountStore, type AccountStore } from "../src/accounts/store";
import { createPgAccountStore } from "../src/accounts/pg";
import { migrate } from "../src/accounts/migrations";

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
