import { describe, expect, it } from "vitest";
import { verifyPassword } from "../src/accounts/password";
import { createMemoryAccountStore } from "../src/accounts/store";
import { grantAdmin } from "../src/tools/bootstrap-admin";

const base = { passwordHash: "scrypt$x", icon: "", color: "#fbbf24" };
const NEW = "mat-khau-admin-12";

describe("bootstrap-admin", () => {
  it("shows the account without --yes and changes nothing", async () => {
    const store = createMemoryAccountStore();
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    expect(await grantAdmin(store, u.id, false)).toEqual({ ok: true, status: "dry-run", username: "Lan" });
    expect((await store.userById(u.id))!.role).toBe("user");
  });

  it("grants admin by id with a new admin-length password and signs the old sessions out; touches no other account", async () => {
    const store = createMemoryAccountStore();
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    const v = (await store.createUser({ ...base, usernameKey: "minh", username: "Minh", role: "user" }))!;
    expect(await grantAdmin(store, u.id, true, NEW)).toEqual({ ok: true, status: "granted", username: "Lan" });
    const after = (await store.userById(u.id))!;
    expect(after.role).toBe("admin");
    expect(await verifyPassword(NEW, after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBeGreaterThan(u.sessionVersion);
    expect(await store.userById(v.id)).toMatchObject({ role: "user", passwordHash: base.passwordHash, sessionVersion: v.sessionVersion });
    expect(await grantAdmin(store, u.id, true)).toEqual({ ok: true, status: "already", username: "Lan" });
  });

  it("refuses to apply without a password or with one below the admin minimum, changing nothing", async () => {
    const store = createMemoryAccountStore();
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    expect(await grantAdmin(store, u.id, true)).toMatchObject({ ok: false });
    expect(await grantAdmin(store, u.id, true, "short-pw-11")).toMatchObject({ ok: false });
    expect(await store.userById(u.id)).toMatchObject({ role: "user", passwordHash: base.passwordHash, sessionVersion: u.sessionVersion });
  });

  it("refuses an unknown id and a disabled account", async () => {
    const store = createMemoryAccountStore();
    expect(await grantAdmin(store, "00000000-0000-4000-8000-000000000000", true, NEW)).toMatchObject({ ok: false });
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    await store.updateUser(u.id, { disabled: true });
    expect(await grantAdmin(store, u.id, true, NEW)).toMatchObject({ ok: false });
    expect((await store.userById(u.id))!.role).toBe("user");
  });
});
