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
});
