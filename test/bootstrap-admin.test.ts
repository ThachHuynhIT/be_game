import { describe, expect, it } from "vitest";
import { createMemoryAccountStore } from "../src/accounts/store";
import { grantAdmin } from "../src/tools/bootstrap-admin";

const base = { passwordHash: "scrypt$x", icon: "", color: "#fbbf24" };

describe("bootstrap-admin", () => {
  it("shows the account without --yes and changes nothing", async () => {
    const store = createMemoryAccountStore();
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    expect(await grantAdmin(store, u.id, false)).toEqual({ ok: true, status: "dry-run", username: "Lan" });
    expect((await store.userById(u.id))!.role).toBe("user");
  });

  it("grants admin by id and touches no session or other account", async () => {
    const store = createMemoryAccountStore();
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    const v = (await store.createUser({ ...base, usernameKey: "minh", username: "Minh", role: "user" }))!;
    expect(await grantAdmin(store, u.id, true)).toEqual({ ok: true, status: "granted", username: "Lan" });
    const after = (await store.userById(u.id))!;
    expect(after.role).toBe("admin");
    expect(after.sessionVersion).toBe(u.sessionVersion);
    expect(after.passwordHash).toBe(u.passwordHash);
    expect((await store.userById(v.id))!.role).toBe("user");
    expect(await grantAdmin(store, u.id, true)).toEqual({ ok: true, status: "already", username: "Lan" });
  });

  it("refuses an unknown id and a disabled account", async () => {
    const store = createMemoryAccountStore();
    expect(await grantAdmin(store, "00000000-0000-4000-8000-000000000000", true)).toMatchObject({ ok: false });
    const u = (await store.createUser({ ...base, usernameKey: "lan", username: "Lan", role: "user" }))!;
    await store.updateUser(u.id, { disabled: true });
    expect(await grantAdmin(store, u.id, true)).toMatchObject({ ok: false });
    expect((await store.userById(u.id))!.role).toBe("user");
  });
});
