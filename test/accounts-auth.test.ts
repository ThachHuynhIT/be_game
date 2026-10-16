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
});
describe("usernames", () => {
  it("normalizes spaces and case into one key, keeps the typed form", () => {
    expect(normalizeUsername("  Lan   Anh ")).toEqual({ ok: true, username: "Lan Anh", key: "lan anh" });
    expect(normalizeUsername("Thạch_99")).toMatchObject({ ok: true, key: "thạch_99" });
  });
  it("rejects bad lengths and characters", () => {
    for (const bad of ["ab", "x".repeat(21), "a<b>", "lan!", ""]) expect(normalizeUsername(bad).ok).toBe(false);
    expect(validatePassword("1234567")).not.toBeNull();
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
