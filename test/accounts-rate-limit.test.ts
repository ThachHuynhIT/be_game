import { describe, expect, it, vi } from "vitest";
import { type RateLimiter, memoryRateLimiter } from "../src/accounts/rateLimit";
import { LOGIN_PER_IP, LOGIN_PER_PAIR, LOGIN_WINDOW_SEC, TOO_MANY, createAccountService } from "../src/accounts/service";
import { createMemoryAccountStore } from "../src/accounts/store";

const T = 1_790_000_000_000;
const PW = "matkhau123";

async function setup(limiter?: RateLimiter) {
  let t = T;
  const lim = limiter ?? memoryRateLimiter(() => t);
  const svc = createAccountService(createMemoryAccountStore(), lim, () => t);
  // Registration has its own bucket (reg:ip); use a dedicated IP for it.
  const reg = await svc.register({ username: "Lan", password: PW }, "10.0.0.250");
  if (!reg.ok) throw new Error(reg.error);
  return { svc, at: (ms: number) => (t = T + ms) };
}
const wrong = { username: "Lan", password: "saimatkhau" };
const right = { username: "Lan", password: PW };

describe("login rate limit", () => {
  it("failures from IP A do not lock the owner out on IP B", async () => {
    const { svc } = await setup();
    for (let i = 0; i < LOGIN_PER_PAIR; i++) expect(await svc.login(wrong, "1.1.1.1")).toMatchObject({ status: 401 });
    expect(await svc.login(wrong, "1.1.1.1")).toMatchObject({ status: 429, error: TOO_MANY });
    expect((await svc.login(right, "2.2.2.2")).ok).toBe(true);
  });

  it("the same (name, IP) pair stays limited, even with the right password", async () => {
    const { svc } = await setup();
    for (let i = 0; i < LOGIN_PER_PAIR; i++) await svc.login(wrong, "1.1.1.1");
    expect(await svc.login(right, "1.1.1.1")).toMatchObject({ status: 429 });
  });

  it("case, spaces and NFC share one pair bucket", async () => {
    const { svc } = await setup();
    for (const username of ["Lan", "lan", " LAN ", "lAn", "Lan".normalize("NFD")]) await svc.login({ username, password: "x" }, "1.1.1.1");
    expect(await svc.login(right, "1.1.1.1")).toMatchObject({ status: 429 });
  });

  it("keeps a per-IP cap across many names", async () => {
    const { svc } = await setup();
    for (let i = 0; i < LOGIN_PER_IP; i++) expect(await svc.login({ username: `Ten${i}`, password: "x" }, "3.3.3.3")).toMatchObject({ status: 401 });
    expect(await svc.login({ username: "Khac", password: "x" }, "3.3.3.3")).toMatchObject({ status: 429 });
    expect((await svc.login(right, "4.4.4.4")).ok).toBe(true);
  });

  it("opens again exactly when the window ends", async () => {
    const { svc, at } = await setup();
    for (let i = 0; i < LOGIN_PER_PAIR; i++) await svc.login(wrong, "1.1.1.1");
    at(LOGIN_WINDOW_SEC * 1000 - 1);
    expect(await svc.login(right, "1.1.1.1")).toMatchObject({ status: 429 });
    at(LOGIN_WINDOW_SEC * 1000);
    expect((await svc.login(right, "1.1.1.1")).ok).toBe(true);
  });

  it("uses only ip and normalized pair buckets: no per-name bucket, no raw invalid names", async () => {
    const buckets: string[] = [];
    const inner = memoryRateLimiter();
    const spy: RateLimiter = { hit: (b, l, w) => (buckets.push(b), inner.hit(b, l, w)) };
    const { svc } = await setup(spy);
    buckets.length = 0;
    await svc.login({ username: " LAN ", password: "x" }, "1.1.1.1");
    await svc.login({ username: "a!b<script>", password: "x" }, "1.1.1.1");
    expect(buckets).toEqual(["login:ip:1.1.1.1", "login:pair:lan:1.1.1.1", "login:ip:1.1.1.1"]);
  });

  it("fails open when the limiter throws, logging without names or IPs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { svc } = await setup({ hit: () => Promise.reject(new Error("redis down")) });
      expect((await svc.login(right, "1.1.1.1")).ok).toBe(true);
      const text = log.mock.calls.flat().join(" ");
      expect(text).toContain("rate limiter unavailable");
      expect(text).not.toContain("1.1.1.1");
      expect(text.toLowerCase()).not.toContain("lan");
    } finally {
      log.mockRestore();
    }
  });
});
