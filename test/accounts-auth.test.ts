import { createHmac } from "node:crypto";
import RedisMock from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/accounts/password";
import { readSession, signSession } from "../src/accounts/session";
import { normalizeUsername, validatePassword } from "../src/accounts/username";
import { memoryRateLimiter, redisRateLimiter } from "../src/accounts/rateLimit";

describe("passwords", () => {
  it("hashes with scrypt and a random salt, verifies only the right password", async () => {
    const a = await hashPassword("matkhau123");
    const b = await hashPassword("matkhau123");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("matkhau123", a)).toBe(true);
    expect(await verifyPassword("matkhau124", a)).toBe(false);
    expect(await verifyPassword("matkhau123", "garbage")).toBe(false);
  });
});
describe("sessions", () => {
  it("a second login revokes the first session and issues a valid replacement", async () => {
    const { createAccountService } = await import("../src/accounts/service");
    const { createMemoryAccountStore } = await import("../src/accounts/store");
    const svc = createAccountService(createMemoryAccountStore(), memoryRateLimiter());
    const input = { username: "Lan", password: "matkhau123" };
    const reg = await svc.register(input, "10.1.1.1");
    const first = await svc.login(input, "10.1.1.2");
    if (!reg.ok || !first.ok) throw new Error("setup");
    expect(await svc.authenticate(first.session)).not.toBeNull();
    const second = await svc.login(input, "10.1.1.3");
    if (!second.ok) throw new Error(second.error);
    expect(await svc.authenticate(first.session)).toBeNull();
    expect(await svc.authenticate(reg.session)).toBeNull();
    expect(await svc.authenticate(second.session)).not.toBeNull();
  });

  it("does not issue a stale session when the login update loses the user", async () => {
    const { createAccountService } = await import("../src/accounts/service");
    const { createMemoryAccountStore } = await import("../src/accounts/store");
    const store = createMemoryAccountStore();
    const svc = createAccountService(store, memoryRateLimiter());
    const input = { username: "Lan", password: "matkhau123" };
    expect((await svc.register(input, "10.2.1.1")).ok).toBe(true);
    store.updateUser = async () => null;
    expect(await svc.login(input, "10.2.1.2")).toMatchObject({ ok: false, status: 500 });
  });
  const now = 1_790_000_000_000;
  it("round-trips, rejects a tampered or foreign token, and expires after 30 days", () => {
    const t = signSession({ uid: "u1", ver: 2 }, "s3cret", now);
    expect(readSession(t, "s3cret", now)).toEqual({ uid: "u1", ver: 2 });
    expect(readSession(t, "other", now)).toBeNull();
    const [p, sig] = t.split(".");
    expect(readSession(`${p}x.${sig}`, "s3cret", now)).toBeNull();
    expect(readSession(t, "s3cret", now + 31 * 86_400_000)).toBeNull();
    expect(readSession("nope", "s3cret", now)).toBeNull();
  });
  it("is valid until just before 30 days and expired at exactly 30 days", () => {
    const DAY = 86_400_000;
    // now is a whole second, so exp = now/1000 + 30 days; readSession refuses once exp <= the current second.
    const t = signSession({ uid: "u1", ver: 2 }, "s3cret", now);
    expect(readSession(t, "s3cret", now + 30 * DAY - 1_000)).toEqual({ uid: "u1", ver: 2 });
    expect(readSession(t, "s3cret", now + 30 * DAY - 1)).toEqual({ uid: "u1", ver: 2 });
    expect(readSession(t, "s3cret", now + 30 * DAY)).toBeNull();
    // A token signed partway through a second still lasts the full 30 days from that second.
    const mid = signSession({ uid: "u1", ver: 2 }, "s3cret", now + 999);
    expect(readSession(mid, "s3cret", now + 30 * DAY - 1)).toEqual({ uid: "u1", ver: 2 });
    expect(readSession(mid, "s3cret", now + 30 * DAY)).toBeNull();
  });
});
describe("usernames", () => {
  it("normalizes spaces and case into one key, keeps the typed form", () => {
    expect(normalizeUsername("  Lan   Anh ")).toEqual({ ok: true, username: "Lan Anh", key: "lan anh" });
    expect(normalizeUsername("Thạch_99")).toMatchObject({ ok: true, key: "thạch_99" });
  });
  it("rejects bad lengths and characters", () => {
    for (const bad of ["ab", "x".repeat(21), "a<b>", "lan!", ""]) expect(normalizeUsername(bad).ok).toBe(false);
    expect(validatePassword("")).not.toBeNull();
    expect(validatePassword("1")).toBeNull();
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("x".repeat(73))).not.toBeNull();
  });
});
describe("rate limits", () => {
  it.each([["memory", () => memoryRateLimiter()], ["redis", () => redisRateLimiter(new RedisMock() as never)]])("%s allows `limit` hits per window", async (_, make) => {
    const rl = make();
    for (let i = 0; i < 3; i++) expect(await rl.hit("login:ip:1.2.3.4", 3, 900)).toBe(true);
    expect(await rl.hit("login:ip:1.2.3.4", 3, 900)).toBe(false);
    expect(await rl.hit("login:ip:5.6.7.8", 3, 900)).toBe(true);
  });
});

describe("review fixes", () => {
  it("NFC/NFD passwords are equivalent; length counts code points; oversized params rejected", async () => {
    const nfc = "mậtkhẩu12".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    const h = await hashPassword(nfd);
    expect(await verifyPassword(nfc, h)).toBe(true);
    expect(validatePassword(nfd)).toBeNull();
    expect(validatePassword("😀".repeat(8))).toBeNull();
    expect(validatePassword("😀".repeat(73))).not.toBeNull();
    expect(await verifyPassword(nfc, h.replace("scrypt$32768$8$1", "scrypt$65536$8$1"))).toBe(false);
    expect(await verifyPassword(nfc, h.replace("scrypt$32768$8$1", "scrypt$32768$8$2"))).toBe(false);
  });
  it("rejects malformed session tokens", () => {
    const now = 1_790_000_000_000;
    const t = signSession({ uid: "u1", ver: 2 }, "s", now);
    const [p, sig] = t.split(".");
    expect(readSession(`${p}.${sig}ab`, "s", now)).toBeNull();
    expect(readSession(`${p}.${sig.slice(0, -2)}`, "s", now)).toBeNull();
    const forge = (payload: string) => {
      const b = Buffer.from(payload).toString("base64url");
      return `${b}.${createHmac("sha256", "s").update(b).digest("base64url")}`;
    };
    const exp = Math.floor(now / 1000) + 100;
    expect(readSession(forge("not json"), "s", now)).toBeNull();
    expect(readSession(forge(JSON.stringify({ uid: 1, ver: 1, exp })), "s", now)).toBeNull();
    expect(readSession(forge(JSON.stringify({ uid: "u", ver: "1", exp })), "s", now)).toBeNull();
    expect(readSession(forge(JSON.stringify({ uid: "u", ver: -1, exp })), "s", now)).toBeNull();
    expect(readSession(forge(JSON.stringify({ uid: "u", ver: 1.5, exp })), "s", now)).toBeNull();
    expect(readSession(forge(JSON.stringify({ uid: "u", ver: 1, exp: null })), "s", now)).toBeNull();
    expect(readSession(forge(JSON.stringify({ uid: "u", ver: 1, exp })), "s", now)).toEqual({ uid: "u", ver: 1 });
  });
  it("rejects zero-width characters in usernames", () => {
    expect(normalizeUsername("lan\u200Banh").ok).toBe(false);
  });
  it("redis: a bucket left without a TTL heals on its next hit instead of blocking for good", async () => {
    const redis = new RedisMock();
    // What the old SET NX EX + INCR pair left behind when the key expired between the two calls.
    await redis.set("be_game:rl:t:stuck", "7");
    expect(await redis.ttl("be_game:rl:t:stuck")).toBe(-1);
    const rl = redisRateLimiter(redis as never);
    expect(await rl.hit("t:stuck", 3, 900)).toBe(false); // still counted: 8 > 3
    const ttl = await redis.ttl("be_game:rl:t:stuck");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
    // A key that already has its window keeps it (the TTL is not pushed back on every hit).
    await redis.expire("be_game:rl:t:stuck", 5);
    await rl.hit("t:stuck", 3, 900);
    expect(await redis.ttl("be_game:rl:t:stuck")).toBeLessThanOrEqual(5);
  });
  it("redis bucket always has a TTL; memory limiter resets after the window", async () => {
    const redis = new RedisMock();
    await redisRateLimiter(redis as never).hit("t:1", 3, 900);
    const ttl = await redis.ttl("be_game:rl:t:1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
    let t = 0;
    const rl = memoryRateLimiter(() => t);
    expect(await rl.hit("b", 1, 10)).toBe(true);
    expect(await rl.hit("b", 1, 10)).toBe(false);
    t = 61_000;
    expect(await rl.hit("b", 1, 10)).toBe(true);
  });
});

describe("admin lock revokes sessions", () => {
  it("lock then unlock: the token issued before the lock stays rejected", async () => {
    const { createAccountService } = await import("../src/accounts/service");
    const { createMemoryAccountStore } = await import("../src/accounts/store");
    const svc = createAccountService(createMemoryAccountStore(), memoryRateLimiter());
    const boss = await svc.register({ username: "Admin", password: "matkhau123" }, "1.1.1.1");
    const lan = await svc.register({ username: "Lan", password: "matkhau123" }, "1.1.1.2");
    if (!boss.ok || !lan.ok) throw new Error("register");
    const admin = await svc.store.updateUser(boss.user.id, { role: "admin" });
    expect(await svc.authenticate(lan.session)).not.toBeNull();
    expect((await svc.adminUpdate(admin!, lan.user.id, { disabled: true })).ok).toBe(true);
    expect((await svc.adminUpdate(admin!, lan.user.id, { disabled: false })).ok).toBe(true);
    expect(await svc.authenticate(lan.session)).toBeNull();
    const again = await svc.login({ username: "Lan", password: "matkhau123" }, "1.1.1.3");
    expect(again.ok && (await svc.authenticate(again.session))).toBeTruthy();
  });
});

describe("auth cache across instances", () => {
  it("re-reads the user when a token is newer than the cached session version", async () => {
    const { createAccountService } = await import("../src/accounts/service");
    const { createMemoryAccountStore } = await import("../src/accounts/store");
    const store = createMemoryAccountStore();
    const a = createAccountService(store, memoryRateLimiter());
    const b = createAccountService(store, memoryRateLimiter());
    const reg = await a.register({ username: "Lan", password: "matkhau123" }, "1.1.1.1");
    if (!reg.ok) throw new Error("register");
    expect(await a.authenticate(reg.session)).not.toBeNull(); // instance A caches ver 0
    const changed = await b.updateMe((await b.authenticate(reg.session))!, { password: "matkhau456", oldPassword: "matkhau123" });
    if (!changed.ok || !changed.session) throw new Error("password change");
    expect((await a.authenticate(changed.session))?.username).toBe("Lan"); // ver 1 > cached 0: re-read, not a sign-out
    expect(await a.authenticate(reg.session)).toBeNull(); // the old token is dead everywhere
  });
});
