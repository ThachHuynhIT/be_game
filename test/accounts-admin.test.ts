import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/accounts/password";
import { memoryRateLimiter } from "../src/accounts/rateLimit";
import { ADMIN_NEEDS_PASSWORD, RESERVED_NAME, createAccountService } from "../src/accounts/service";
import { createMemoryAccountStore } from "../src/accounts/store";
import { MAX_PASSWORD, MIN_ADMIN_PASSWORD, MIN_PASSWORD, validatePassword } from "../src/accounts/username";

const saved = process.env.ADMIN_USERNAMES;
beforeEach(() => {
  process.env.ADMIN_USERNAMES = "Boss, Quản Trị";
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = saved;
});

let ipN = 0;
const ip = () => `10.9.0.${++ipN}`;
const setup = () => {
  const store = createMemoryAccountStore();
  return { store, svc: createAccountService(store, memoryRateLimiter()) };
};
const pw = (n: number) => "a".repeat(n);

describe("password policy", () => {
  it.each([
    ["user", MIN_PASSWORD],
    ["admin", MIN_ADMIN_PASSWORD],
  ] as const)("%s: min-1 and 0 rejected, min and %#72 accepted, 73 rejected", (role, min) => {
    expect(validatePassword("", role)).not.toBeNull();
    expect(validatePassword(pw(min - 1), role)).not.toBeNull();
    expect(validatePassword(pw(min), role)).toBeNull();
    expect(validatePassword(pw(MAX_PASSWORD), role)).toBeNull();
    expect(validatePassword(pw(MAX_PASSWORD + 1), role)).not.toBeNull();
  });
  it("counts NFC code points, not UTF-16 units or NFD marks", () => {
    expect(validatePassword("😀".repeat(MIN_PASSWORD))).toBeNull();
    expect(validatePassword("😀".repeat(MIN_PASSWORD - 1))).not.toBeNull();
    // "ậ" is 1 code point in NFC but 3 in NFD: 7 of them stay too short.
    expect(validatePassword("ậ".repeat(MIN_PASSWORD - 1).normalize("NFD"))).not.toBeNull();
    expect(validatePassword("😀".repeat(MAX_PASSWORD + 1))).not.toBeNull();
  });
  it("defaults to the user policy and names the admin minimum in its message", () => {
    expect(validatePassword(pw(MIN_PASSWORD))).toBeNull();
    expect(validatePassword(pw(MIN_PASSWORD), "admin")).toContain(String(MIN_ADMIN_PASSWORD));
  });
});

describe("admin names grant nothing", () => {
  it.each(["Boss", "boss", "  BOSS ", "quản trị", "Quản  Trị", "Quản Trị".normalize("NFD")])("registering %j is refused and creates no account", async (name) => {
    const { svc, store } = setup();
    const r = await svc.register({ username: name, password: pw(MIN_PASSWORD) }, ip());
    expect(r).toEqual({ ok: false, status: 400, error: RESERVED_NAME });
    expect((await store.listUsers("", 1, 50)).total).toBe(0);
  });

  it("a listed name that an account already holds keeps its stored role at login", async () => {
    const { svc } = setup();
    delete process.env.ADMIN_USERNAMES;
    const reg = await svc.register({ username: "Boss", password: pw(MIN_PASSWORD) }, ip());
    if (!reg.ok) throw new Error(reg.error);
    expect(reg.user.role).toBe("user");
    process.env.ADMIN_USERNAMES = "Boss";
    const login = await svc.login({ username: "boss", password: pw(MIN_PASSWORD) }, ip());
    if (!login.ok) throw new Error(login.error);
    expect(login.user.role).toBe("user");
  });

  it("an existing admin stays admin, and an old short password still signs in", async () => {
    const { svc, store } = setup();
    const u = await store.createUser({ usernameKey: "boss", username: "Boss", passwordHash: await hashPassword("1"), role: "admin", icon: "", color: "#fbbf24" });
    if (!u) throw new Error("setup");
    const login = await svc.login({ username: "Boss", password: "1" }, ip());
    if (!login.ok) throw new Error(login.error);
    expect(login.user.role).toBe("admin");
    const old = await store.createUser({ usernameKey: "lan", username: "Lan", passwordHash: await hashPassword("abc"), role: "user", icon: "", color: "#fbbf24" });
    if (!old) throw new Error("setup");
    expect((await svc.login({ username: "Lan", password: "abc" }, ip())).ok).toBe(true);
  });

  it("a user cannot rename to a reserved name; an admin can", async () => {
    const { svc, store } = setup();
    const lan = await svc.register({ username: "Lan", password: pw(MIN_PASSWORD) }, ip());
    if (!lan.ok) throw new Error(lan.error);
    const row = (await store.userById(lan.user.id))!;
    expect(await svc.updateMe(row, { username: "BOSS" })).toEqual({ ok: false, status: 400, error: RESERVED_NAME });
    const admin = (await store.updateUser(row.id, { role: "admin" }))!;
    expect((await svc.updateMe(admin, { username: "BOSS" })).ok).toBe(true);
  });
});

describe("setting a password follows the role", () => {
  it("register needs the user minimum", async () => {
    const { svc } = setup();
    expect(await svc.register({ username: "Lan", password: pw(MIN_PASSWORD - 1) }, ip())).toMatchObject({ ok: false, status: 400 });
    expect((await svc.register({ username: "Lan", password: pw(MIN_PASSWORD) }, ip())).ok).toBe(true);
  });

  it("changing my own password uses my role's minimum", async () => {
    const { svc, store } = setup();
    const reg = await svc.register({ username: "Lan", password: pw(MIN_PASSWORD) }, ip());
    if (!reg.ok) throw new Error(reg.error);
    const user = (await store.userById(reg.user.id))!;
    expect(await svc.updateMe(user, { password: pw(MIN_PASSWORD - 1), oldPassword: pw(MIN_PASSWORD) })).toMatchObject({ ok: false, status: 400 });
    expect((await svc.updateMe(user, { password: "b".repeat(MIN_PASSWORD), oldPassword: pw(MIN_PASSWORD) })).ok).toBe(true);
    const admin = (await store.updateUser(user.id, { role: "admin" }))!;
    expect(await svc.updateMe(admin, { password: pw(MIN_ADMIN_PASSWORD - 1), oldPassword: "b".repeat(MIN_PASSWORD) })).toMatchObject({ ok: false, status: 400 });
    expect((await svc.updateMe(admin, { password: pw(MIN_ADMIN_PASSWORD), oldPassword: "b".repeat(MIN_PASSWORD) })).ok).toBe(true);
  });

  it("an admin reset uses the role the account ends up with", async () => {
    const { svc, store } = setup();
    const mk = async (name: string, role: "user" | "admin") =>
      (await store.createUser({ usernameKey: name.toLowerCase(), username: name, passwordHash: await hashPassword(pw(MIN_ADMIN_PASSWORD)), role, icon: "", color: "#fbbf24" }))!;
    const me = await mk("Chu", "admin");
    const user = await mk("Lan", "user");
    const other = await mk("Minh", "admin");
    expect((await svc.adminUpdate(me, user.id, { password: pw(MIN_PASSWORD) })).ok).toBe(true);
    expect(await svc.adminUpdate(me, user.id, { role: "admin", password: pw(MIN_PASSWORD) })).toMatchObject({ ok: false, status: 400 });
    expect((await store.userById(user.id))!.role).toBe("user");
    expect(await svc.adminUpdate(me, other.id, { password: pw(MIN_ADMIN_PASSWORD - 1) })).toMatchObject({ ok: false, status: 400 });
    expect((await svc.adminUpdate(me, other.id, { password: pw(MIN_ADMIN_PASSWORD) })).ok).toBe(true);
    expect((await svc.adminUpdate(me, other.id, { role: "user", password: pw(MIN_PASSWORD) })).ok).toBe(true);
    expect(await svc.adminUpdate(me, "00000000-0000-4000-8000-000000000000", { password: pw(MIN_ADMIN_PASSWORD) })).toMatchObject({ ok: false, status: 404 });
  });

  it("promoting to admin needs a new admin-length password in the same request", async () => {
    const { svc, store } = setup();
    const mk = async (name: string, role: "user" | "admin") =>
      (await store.createUser({ usernameKey: name.toLowerCase(), username: name, passwordHash: await hashPassword("1"), role, icon: "", color: "#fbbf24" }))!;
    const me = await mk("Chu", "admin");
    const lan = await mk("Lan", "user");
    expect(await svc.adminUpdate(me, lan.id, { role: "admin" })).toEqual({ ok: false, status: 400, error: ADMIN_NEEDS_PASSWORD });
    expect((await store.userById(lan.id))!.role).toBe("user");
    const ok = await svc.adminUpdate(me, lan.id, { role: "admin", password: pw(MIN_ADMIN_PASSWORD) });
    expect(ok).toMatchObject({ ok: true, user: { role: "admin" } });
    const after = (await store.userById(lan.id))!;
    expect(after.sessionVersion).toBeGreaterThan(lan.sessionVersion);
    // Already admin: "role: admin" alone is a no-op, and demoting needs no password.
    expect((await svc.adminUpdate(me, lan.id, { role: "admin" })).ok).toBe(true);
    expect((await svc.adminUpdate(me, lan.id, { role: "user" })).ok).toBe(true);
  });
});
