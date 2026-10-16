import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccountService, resetAccountServiceForTests } from "../src/accounts/service";
import { createGameServer } from "../src/server/app";

let server: Server;
let base = "";
let ipN = 0;
const saved = { admins: process.env.ADMIN_USERNAMES, secret: process.env.SESSION_SECRET, vercel: process.env.VERCEL };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));

beforeAll(async () => {
  process.env.ADMIN_USERNAMES = "boss";
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.VERCEL;
  server = createGameServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  restore("ADMIN_USERNAMES", saved.admins);
  restore("SESSION_SECRET", saved.secret);
  restore("VERCEL", saved.vercel);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
beforeEach(() => resetAccountServiceForTests());
afterEach(() => resetAccountServiceForTests());

async function call(method: string, path: string, body?: unknown, opts: { token?: string; ip?: string; ua?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? `10.0.0.${++ipN}`, ...opts.headers };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ua) headers["user-agent"] = opts.ua;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const register = (username: string, password = "matkhau123", ip?: string) => call("POST", "/api/auth/register", { username, password }, { ip });

describe("account routes", () => {
  it("registers without leaking hashes", async () => {
    const r = await register("Lan");
    expect(r.status).toBe(200);
    expect(r.json.session).toContain(".");
    expect(r.json.user).toMatchObject({ username: "Lan", role: "user" });
    expect(r.text).not.toContain("scrypt");
  });

  it("rejects duplicates and invalid input", async () => {
    await register("Lan");
    const dup = await register(" lan ");
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("Tên đăng nhập đã có người dùng");
    expect((await register("ab")).status).toBe(400);
    expect((await register("Minh", "")).status).toBe(400);
    expect((await register("Minh2", "1")).status).toBe(200);
  });

  it("login errors are indistinguishable", async () => {
    await register("Lan");
    const wrong = await call("POST", "/api/auth/login", { username: "Lan", password: "saimatkhau" });
    const none = await call("POST", "/api/auth/login", { username: "Nobody", password: "saimatkhau" });
    expect(wrong.status).toBe(401);
    expect(none.status).toBe(401);
    expect(wrong.json.error).toBe("Sai tên đăng nhập hoặc mật khẩu");
    expect(none.json).toEqual(wrong.json);
    expect((await call("POST", "/api/auth/login", { username: "lan", password: "matkhau123" })).status).toBe(200);
  });

  it("me and logout", async () => {
    expect((await call("GET", "/api/auth/me")).status).toBe(401);
    const { json } = await register("Lan");
    const me = await call("GET", "/api/auth/me", undefined, { token: json.session });
    expect(me.status).toBe(200);
    expect(me.json.user.username).toBe("Lan");
    expect((await call("POST", "/api/auth/logout", {}, { token: json.session })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", undefined, { token: json.session })).status).toBe(401);
  });

  it("patches profile and password", async () => {
    const { json } = await register("Lan");
    const t = json.session;
    const color = await call("PATCH", "/api/auth/me", { color: "#f87171" }, { token: t });
    expect(color.json.user.color).toBe("#f87171");
    const bad = await call("PATCH", "/api/auth/me", { password: "matkhaumoi1", oldPassword: "sai" }, { token: t });
    expect(bad.status).toBe(400);
    const ok = await call("PATCH", "/api/auth/me", { password: "matkhaumoi1", oldPassword: "matkhau123" }, { token: t });
    expect(ok.status).toBe(200);
    expect(ok.json.session).toContain(".");
    expect((await call("GET", "/api/auth/me", undefined, { token: t })).status).toBe(401);
    expect((await call("GET", "/api/auth/me", undefined, { token: ok.json.session })).status).toBe(200);
  });

  it("renames the account", async () => {
    const lan = (await register("Lan")).json.session;
    const minh = (await register("Minh")).json.session;
    const svc = await getAccountService();
    const id = (await svc.store.userByKey("lan"))!.id;
    await svc.store.recordResults("tienlen", "r1", new Date(), [{ usernameKey: "lan", points: 5, rank: 1 }]);
    const ok = await call("PATCH", "/api/auth/me", { username: "  Lan   Anh ", color: "#f87171" }, { token: lan });
    expect(ok.status).toBe(200);
    expect(ok.json.user.username).toBe("Lan Anh");
    expect(ok.json.user.color).toBe("#f87171");
    expect((await call("GET", "/api/auth/me", undefined, { token: lan })).json.user.username).toBe("Lan Anh");
    expect((await svc.store.leaderboard("tienlen", 10)).map((r) => r.name)).toEqual(["Lan Anh"]);
    expect((await svc.store.userById(id))!.usernameKey).toBe("lan anh");
    // case/spacing-only change of own key is allowed
    expect((await call("PATCH", "/api/auth/me", { username: "lan anh" }, { token: lan })).status).toBe(200);
    const taken = await call("PATCH", "/api/auth/me", { username: "LAN ANH" }, { token: minh });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toBe("Tên đăng nhập đã có người dùng");
    // the old name is free for others
    expect((await register("Lan")).status).toBe(200);
    const res = await call("PATCH", "/api/auth/me", { username: "Boss" }, { token: minh });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("Tên này đã được giữ");
    expect((await call("PATCH", "/api/auth/me", { username: "a!" }, { token: minh })).status).toBe(400);
    expect((await call("GET", "/api/auth/me", undefined, { token: minh })).json.user.username).toBe("Minh");
  });

  it("an admin may rename to an admin-reserved name", async () => {
    const boss = (await register("boss")).json.session;
    expect((await call("PATCH", "/api/auth/me", { username: "BOSS" }, { token: boss })).status).toBe(200);
  });

  it("admin gate and stats", async () => {
    const lan = (await register("Lan")).json;
    const boss = (await register("boss")).json;
    expect(boss.user.role).toBe("admin");
    expect((await call("GET", "/api/admin/stats?days=7", undefined, { token: lan.session })).status).toBe(403);
    expect((await call("GET", "/api/admin/stats?days=7")).status).toBe(401);
    const ok = await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session });
    expect(ok.status).toBe(200);
    expect(ok.json.daily).toHaveLength(7);
    expect((await call("GET", "/api/admin/stats?days=5", undefined, { token: boss.session })).status).toBe(400);
    const users = await call("GET", "/api/admin/users?q=la", undefined, { token: boss.session });
    expect(users.json.users.map((u: any) => u.username)).toEqual(["Lan"]);
    expect(users.json.pageSize).toBe(50);
  });

  it("admin disables users immediately and cannot demote self", async () => {
    const lan = (await register("Lan")).json;
    const boss = (await register("boss")).json;
    // warm the cache
    expect((await call("GET", "/api/auth/me", undefined, { token: lan.session })).status).toBe(200);
    const r = await call("PATCH", `/api/admin/users/${lan.user.id}`, { disabled: true }, { token: boss.session });
    expect(r.status).toBe(200);
    expect(r.json.user.disabled).toBe(true);
    expect((await call("GET", "/api/auth/me", undefined, { token: lan.session })).status).toBe(401);
    // Unlocking does not revive the token issued before the lock.
    expect((await call("PATCH", `/api/admin/users/${lan.user.id}`, { disabled: false }, { token: boss.session })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", undefined, { token: lan.session })).status).toBe(401);
    expect((await call("PATCH", `/api/admin/users/${boss.user.id}`, { role: "user" }, { token: boss.session })).status).toBe(400);
    expect((await call("PATCH", `/api/admin/users/${boss.user.id}`, { disabled: true }, { token: boss.session })).status).toBe(400);
    expect((await call("PATCH", "/api/admin/users/00000000-0000-4000-8000-000000000000", { disabled: true }, { token: boss.session })).status).toBe(404);
  });

  it("tracks page views", async () => {
    const boss = (await register("boss")).json;
    const stats = async () => (await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session })).json.totals.views;
    expect((await call("POST", "/api/track", { path: "/?x=1#h", device: "abcdefghijklmnop" })).status).toBe(204);
    expect(await stats()).toBe(1);
    expect((await call("POST", "/api/track", { path: "/", device: "x" })).status).toBe(400);
    expect((await call("POST", "/api/track", { path: "nope", device: "abcdefghijklmnop" })).status).toBe(400);
    expect((await call("POST", "/api/track", { path: "/", device: "abcdefghijklmnop" }, { ua: "Googlebot/2.1" })).status).toBe(204);
    expect(await stats()).toBe(1);
  });

  it("rate limits registration per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await register(`User${i}`, "matkhau123", "9.9.9.9")).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it("answers CORS preflight", async () => {
    const r = await call("OPTIONS", "/api/auth/login", undefined, { headers: { origin: "https://play.example.com", "access-control-request-method": "POST" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(r.headers.get("access-control-allow-methods")).toContain("PATCH");
  });

  it("returns 503 in Vietnamese when the store fails", async () => {
    const svc = await getAccountService();
    svc.store.userByKey = () => Promise.reject(new Error("boom"));
    const r = await call("POST", "/api/auth/login", { username: "Lan", password: "matkhau123" });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("Máy chủ tài khoản đang lỗi, thử lại sau");
  });

  it("reports the account store on /api/health", async () => {
    const r = await call("GET", "/api/health");
    expect(r.json.accounts).toBe("memory");
  });

  it("rejects bad JSON", async () => {
    const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(res.status).toBe(400);
  });

  it("accepts a text/plain beacon body on /api/track", async () => {
    const boss = (await register("boss")).json;
    const res = await fetch(base + "/api/track", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": "7.7.7.7" },
      body: JSON.stringify({ path: "/games", device: "abcdefghijklmnop" }),
    });
    expect(res.status).toBe(204);
    const stats = await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session });
    expect(stats.json.totals.views).toBe(1);
  });

  const regAs = (headers: Record<string, string>, n: number) =>
    fetch(base + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ username: `Ip${n}`, password: "matkhau123" }) }).then((r) => r.status);

  it("keys the rate limit on cf-connecting-ip, ignoring a spoofed leading XFF", async () => {
    const out: number[] = [];
    for (let i = 0; i < 6; i++) out.push(await regAs({ "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": `1.1.1.${i}, 5.5.5.5` }, i));
    expect(out[5]).toBe(429);
  });

  it("uses x-real-ip on Vercel and ignores cf-connecting-ip", async () => {
    process.env.VERCEL = "1";
    process.env.SESSION_SECRET = "x".repeat(40);
    process.env.ACCOUNTS_MEMORY = "1";
    try {
      const out: number[] = [];
      for (let i = 0; i < 6; i++) out.push(await regAs({ "x-real-ip": "6.6.6.6", "cf-connecting-ip": `2.2.2.${i}` }, i));
      expect(out[5]).toBe(429);
    } finally {
      delete process.env.VERCEL;
      delete process.env.SESSION_SECRET;
      delete process.env.ACCOUNTS_MEMORY;
    }
  });

  describe("production without DATABASE_URL", () => {
    const prod = (memory: boolean) => {
      process.env.NODE_ENV = "production";
      process.env.SESSION_SECRET = "x".repeat(40);
      if (memory) process.env.ACCOUNTS_MEMORY = "1";
    };
    const savedNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      restore("NODE_ENV", savedNodeEnv);
      delete process.env.SESSION_SECRET;
      delete process.env.ACCOUNTS_MEMORY;
      delete process.env.VERCEL;
    });

    it("is unconfigured: auth, admin and track 503, health says so, joins are refused", async () => {
      prod(false);
      for (const [m, p, b] of [
        ["POST", "/api/auth/register", { username: "Lan", password: "matkhau123" }],
        ["POST", "/api/auth/login", { username: "Lan", password: "matkhau123" }],
        ["GET", "/api/auth/me", undefined],
        ["GET", "/api/admin/stats?days=7", undefined],
        ["POST", "/api/track", { path: "/games", device: "abcdefghijklmnop" }],
      ] as const) {
        const r = await call(m, p, b);
        expect([p, r.status, r.json?.error]).toEqual([p, 503, "Máy chủ chưa cấu hình đăng nhập"]);
      }
      expect((await call("GET", "/api/health")).json.accounts).toBe("unconfigured");
      await expect(getAccountService()).rejects.toThrow(/unconfigured/);
      const { createRoomHub, attachConnection } = await import("../src/server/hub");
      const { createMemoryRoomStore } = await import("../src/server/store");
      const { FakeSocket } = await import("./helpers/fakeSocket");
      const hub = createRoomHub(createMemoryRoomStore());
      const code = await hub.createRoom();
      const s = new FakeSocket();
      attachConnection(s, { hub });
      expect(await s.request({ type: "join", code, token: "token-aaaaaaaa", session: "a.b" })).toMatchObject({ ok: false, error: "Máy chủ chưa cấu hình đăng nhập" });
    });

    it("VERCEL alone also counts as production", async () => {
      process.env.VERCEL = "1";
      process.env.SESSION_SECRET = "x".repeat(40);
      expect((await call("POST", "/api/auth/login", { username: "Lan", password: "matkhau123" })).status).toBe(503);
    });

    it("ACCOUNTS_MEMORY=1 opts in to the memory store", async () => {
      prod(true);
      expect((await register("Lan")).status).toBe(200);
      expect((await call("GET", "/api/health")).json.accounts).toBe("memory");
    });

    it("logs loudly once, naming only the missing variables", async () => {
      const { vi } = await import("vitest");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      prod(false);
      const { warnIfAccountsUnconfigured } = await import("../src/accounts/service");
      warnIfAccountsUnconfigured();
      warnIfAccountsUnconfigured();
      const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("ACCOUNTS UNCONFIGURED"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("DATABASE_URL");
      expect(lines[0]).not.toContain("x".repeat(40));
      spy.mockRestore();
    });
  });

  it("requires JSON content type, rejects foreign origins, and 404s a malformed admin id", async () => {
    const plain = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(plain.status).toBe(415);
    process.env.ALLOWED_ORIGIN = "https://good.example.com";
    try {
      const bad = await call("POST", "/api/auth/login", { username: "Lan", password: "matkhau123" }, { headers: { origin: "https://evil.example.com" } });
      expect(bad.status).toBe(403);
    } finally {
      delete process.env.ALLOWED_ORIGIN;
    }
    const boss = (await register("boss")).json;
    expect((await call("PATCH", "/api/admin/users/%E0%A4%A", { disabled: true }, { token: boss.session })).status).toBe(404);
  });

  it("refuses tracked paths under /play/ (reserved for WebSocket joins)", async () => {
    const boss = (await register("boss")).json;
    const r = await call("POST", "/api/track", { path: "/play/tienlen", device: "abcdefghijklmnop" });
    expect(r.status).toBe(400);
    expect((await call("POST", "/api/track", { path: "/play/x?y=1", device: "abcdefghijklmnop" })).status).toBe(400);
    expect((await call("POST", "/api/track", { path: "/player", device: "abcdefghijklmnop" })).status).toBe(204);
    const stats = await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session });
    expect(stats.json.totals.playDevices).toBe(0);
  });

  it("strips control characters from tracked paths", async () => {
    const boss = (await register("boss")).json;
    expect((await call("POST", "/api/track", { path: "/a\u0000b\n", device: "abcdefghijklmnop" })).status).toBe(204);
    const stats = await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session });
    expect(stats.json.topPages[0].path).toBe("/ab");
  });
});
