import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_NAME, getAccountService, resetAccountServiceForTests } from "../src/accounts/service";
import { grantAdmin } from "../src/tools/bootstrap-admin";
import { createGameServer } from "../src/server/app";
import { ADAPTERS } from "../src/server/adapters";
import { getRoomStore, type GameKind } from "../src/server/store";
import { seedMathRandom } from "./helpers/rng";

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
const ADMIN_PW = "matkhau-admin-123";
/** Registers a normal account, grants admin by id the way operators do (bootstrap-admin, with a new password), signs in again. */
async function registerAdmin(username = "Sep") {
  const { json } = await register(username);
  const svc = await getAccountService();
  const r = await grantAdmin(svc.store, json.user.id, true, ADMIN_PW);
  if (!r.ok) throw new Error(r.error);
  svc.forget(json.user.id);
  // Granting set a new password and signed the old session out.
  const login = await call("POST", "/api/auth/login", { username, password: ADMIN_PW });
  if (login.status !== 200) throw new Error("admin login " + login.status);
  return login.json;
}

/** A new room stays out of the lobby until its first save (the creator joining); fixtures are saved once to be listed. */
async function listed<S extends { code: string }>(store: { create(s: S): Promise<boolean>; save(s: S, v: number): Promise<boolean> }, room: S) {
  await store.create(room);
  await store.save(room, 1);
}

describe("account routes", () => {
  it("skips a room store that never resolves and still returns healthy rooms", async () => {
    const { json } = await register("HungStore");
    const store = await getRoomStore("tienlen");
    const spy = vi.spyOn(store, "recentRooms").mockImplementation(() => new Promise(() => {}));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await call("GET", "/api/auth/rooms", undefined, { token: json.session });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, rooms: [] });
    } finally { spy.mockRestore(); log.mockRestore(); }
  }, 10_000);
  it("requires a session to list my playing rooms", async () => {
    expect((await call("GET", "/api/auth/rooms")).status).toBe(401);
  });

  it("lists only active playing rooms owned by me, across all seven games, without private fields", async () => {
    const { json } = await register("RoomOwner");
    const uid = json.user.id;
    const expected: { game: GameKind; code: string }[] = [];
    const now = Date.now();
    // `start` deals with Math.random; an unseeded Tiến Lên deal is sometimes an instant win that ends the game.
    const unseed = seedMathRandom(1);
    try {
      for (const game of Object.keys(ADAPTERS) as GameKind[]) {
        const adapter = ADAPTERS[game];
        const store = await getRoomStore(game);
        const code = `M${game}`;
        const room = adapter.newRoom(code);
        let id = 0;
        for (let i = 0; i < 3; i++) expect(adapter.join(room, `room-token-${i}`, `Player${i}`, now, () => `p${++id}`, i === 0 ? uid : `other-${i}`).ok).toBe(true);
        expect(adapter.command(room, "room-token-0", { type: "start" }, now).ok).toBe(true);
        expect(adapter.summary(room, now)).toMatchObject({ status: "playing" });
        await listed(store, room);
        expected.push({ game, code });
        const clone = JSON.parse(JSON.stringify(room));
        clone.code = `K${game}`;
        clone.seats[0].kicked = true;
        await listed(store, clone);
        const offline = JSON.parse(JSON.stringify(room));
        offline.code = `O${game}`;
        for (const p of offline.seats) if (p) p.lastSeen = now - 60_000;
        await listed(store, offline);
        const waiting = adapter.newRoom(`W${game}`);
        adapter.join(waiting, "waiting-token", "RoomOwner", now, () => "waiting", uid);
        await listed(store, waiting);
      }
    } finally {
      unseed();
    }
    const r = await call("GET", "/api/auth/rooms", undefined, { token: json.session });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, rooms: expected });
    expect(r.text).not.toContain("token");
    expect(r.text).not.toContain(uid);
  });

  it("still lists other games if one room store fails", async () => {
    const { json } = await register("StoreError");
    const store = await getRoomStore("tienlen");
    const spy = vi.spyOn(store, "recentRooms").mockRejectedValue(new Error("store down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await call("GET", "/api/auth/rooms", undefined, { token: json.session })).json).toEqual({ ok: true, rooms: [] });
    } finally { spy.mockRestore(); log.mockRestore(); }
  });
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
    expect((await register("Minh2", "1234567")).status).toBe(400);
    expect((await register("Minh2", "12345678")).status).toBe(200);
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

  it("stores per-account UI prefs (GET/PATCH /api/auth/prefs)", async () => {
    expect((await call("GET", "/api/auth/prefs")).status).toBe(401);
    expect((await call("PATCH", "/api/auth/prefs", { game: "typhu", prefs: {} })).status).toBe(401);
    const { json } = await register("PrefUser");
    const t = json.session;
    expect(await call("GET", "/api/auth/prefs", undefined, { token: t }).then((r) => [r.status, r.json])).toEqual([200, { ok: true, prefs: {} }]);
    const p1 = await call("PATCH", "/api/auth/prefs", { game: "typhu", prefs: { view: "minimal", fx: { dice: true } } }, { token: t });
    expect(p1.status).toBe(200);
    expect(p1.json).toEqual({ ok: true, prefs: { typhu: { view: "minimal", fx: { dice: true } } } });
    await call("PATCH", "/api/auth/prefs", { game: "meono", prefs: { sound: false } }, { token: t });
    const p2 = await call("PATCH", "/api/auth/prefs", { game: "typhu", prefs: { view: "full" } }, { token: t });
    expect(p2.json.prefs).toEqual({ typhu: { view: "full" }, meono: { sound: false } });
    expect((await call("GET", "/api/auth/prefs", undefined, { token: t })).json).toEqual({ ok: true, prefs: { typhu: { view: "full" }, meono: { sound: false } } });
    // Prefs stay out of the public user.
    expect((await call("GET", "/api/auth/me", undefined, { token: t })).json.user).not.toHaveProperty("prefs");
    // Another account sees its own (empty) prefs.
    const other = (await register("PrefOther")).json.session;
    expect((await call("GET", "/api/auth/prefs", undefined, { token: other })).json.prefs).toEqual({});
  });

  it("rejects invalid prefs in Vietnamese and other methods with 405", async () => {
    const t = (await register("PrefBad")).json.session;
    const bad = async (body: unknown) => {
      const r = await call("PATCH", "/api/auth/prefs", body, { token: t });
      expect(r.status).toBe(400);
      expect(r.json.ok).toBe(false);
      return r.json.error as string;
    };
    expect(await bad({ game: "chess", prefs: {} })).toBe("Game không hợp lệ");
    expect(await bad({ prefs: {} })).toBe("Game không hợp lệ");
    expect(await bad({ game: "typhu", prefs: [1] })).toBe("Cài đặt không hợp lệ");
    expect(await bad({ game: "typhu", prefs: null })).toBe("Cài đặt không hợp lệ");
    expect(await bad({ game: "typhu", prefs: "x" })).toBe("Cài đặt không hợp lệ");
    expect(await bad({ game: "typhu" })).toBe("Cài đặt không hợp lệ");
    expect(await bad({ game: "typhu", prefs: { s: "x".repeat(2000) } })).toBe("Cài đặt quá lớn");
    expect((await call("PATCH", "/api/auth/prefs", { game: "typhu", prefs: { s: "x".repeat(1990) } }, { token: t })).status).toBe(200);
    expect((await call("GET", "/api/auth/prefs", undefined, { token: t })).json.prefs.typhu.s).toHaveLength(1990);
    expect((await call("POST", "/api/auth/prefs", { game: "typhu", prefs: {} }, { token: t })).status).toBe(405);
    expect((await call("DELETE", "/api/auth/prefs", undefined, { token: t })).status).toBe(405);
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

  it("registering an admin-reserved name is refused, and nobody can make themselves admin", async () => {
    for (const name of ["boss", " BOSS "]) {
      const r = await register(name);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe(RESERVED_NAME);
    }
    const lan = (await register("Lan")).json;
    expect(lan.user.role).toBe("user");
    expect((await call("PATCH", "/api/auth/me", { role: "admin" }, { token: lan.session })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", undefined, { token: lan.session })).json.user.role).toBe("user");
    expect((await call("GET", "/api/admin/stats?days=7", undefined, { token: lan.session })).status).toBe(403);
  });

  it("an admin may rename to an admin-reserved name", async () => {
    const boss = (await registerAdmin()).session;
    expect((await call("PATCH", "/api/auth/me", { username: "BOSS" }, { token: boss })).status).toBe(200);
  });

  it("admin gate and stats", async () => {
    const lan = (await register("Lan")).json;
    const boss = await registerAdmin();
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
    const boss = await registerAdmin();
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

  describe("owner (OWNER_USERNAME)", () => {
    afterEach(() => void delete process.env.OWNER_USERNAME);
    const snapshot = async (id: string) => {
      const u = await (await getAccountService()).store.userById(id);
      return { hash: u?.passwordHash, role: u?.role, disabled: u?.disabled, ver: u?.sessionVersion };
    };
    /** The owner registers first (the name is reserved once OWNER_USERNAME is set), then another admin. */
    async function setup() {
      const chu = await registerAdmin("Chu Nha");
      process.env.OWNER_USERNAME = " chu  NHA ";
      const boss = await registerAdmin("Sep");
      return { chu, boss };
    }

    it("another admin cannot change the owner's role, lock them or set their password; nothing changes", async () => {
      const { chu, boss } = await setup();
      const before = await snapshot(chu.user.id);
      const cases: [unknown, string][] = [
        [{ role: "user" }, "Không thể đổi quyền của chủ sở hữu"],
        [{ role: "admin" }, "Không thể đổi quyền của chủ sở hữu"],
        [{ disabled: true }, "Không thể khoá chủ sở hữu"],
        [{ password: "mat-khau-moi-dai-du" }, "Không thể đặt mật khẩu cho chủ sở hữu"],
        [{ password: "1" }, "Không thể đặt mật khẩu cho chủ sở hữu"],
        [{ role: "user", disabled: true, password: "mat-khau-moi-dai-du" }, "Không thể đổi quyền của chủ sở hữu"],
      ];
      for (const [body, error] of cases) {
        const r = await call("PATCH", `/api/admin/users/${chu.user.id}`, body, { token: boss.session });
        expect(r.status, JSON.stringify(body)).toBe(403);
        expect(r.json).toEqual({ ok: false, error });
      }
      expect(await snapshot(chu.user.id)).toEqual(before);
      expect((await call("GET", "/api/auth/me", undefined, { token: chu.session })).status).toBe(200);
      // Unlocking is allowed (only locking is guarded).
      const unlock = await call("PATCH", `/api/admin/users/${chu.user.id}`, { disabled: false }, { token: boss.session });
      expect(unlock.status).toBe(200);
      expect(unlock.json.user.isOwner).toBe(true);
    });

    it("flags the owner in the list and in PATCH responses, and nobody else", async () => {
      const { chu, boss } = await setup();
      const list = await call("GET", "/api/admin/users", undefined, { token: boss.session });
      const flags = Object.fromEntries(list.json.users.map((u: { username: string; isOwner: boolean }) => [u.username, u.isOwner]));
      expect(flags).toEqual({ "Chu Nha": true, Sep: false });
      const lan = (await register("Lan")).json;
      const r = await call("PATCH", `/api/admin/users/${lan.user.id}`, { disabled: true }, { token: boss.session });
      expect(r.json.user.isOwner).toBe(false);
      expect((await call("GET", "/api/auth/me", undefined, { token: chu.session })).json.user).not.toHaveProperty("isOwner");
    });

    it("the owner still changes their own password, through the admin route or PATCH me", async () => {
      const { chu } = await setup();
      const self = await call("PATCH", `/api/admin/users/${chu.user.id}`, { password: "mat-khau-chu-moi-1" }, { token: chu.session });
      expect(self.status).toBe(200);
      const login = await call("POST", "/api/auth/login", { username: "Chu Nha", password: "mat-khau-chu-moi-1" });
      expect(login.status).toBe(200);
      const me = await call("PATCH", "/api/auth/me", { password: "mat-khau-chu-moi-2", oldPassword: "mat-khau-chu-moi-1" }, { token: login.json.session });
      expect(me.status).toBe(200);
      expect((await call("POST", "/api/auth/login", { username: "Chu Nha", password: "mat-khau-chu-moi-2" })).status).toBe(200);
    });

    it("reserves the owner's name: nobody registers it, a non-admin cannot rename to it, it grants no role", async () => {
      process.env.OWNER_USERNAME = "Chu Nha";
      for (const name of ["Chu Nha", " CHU  nha "]) {
        const r = await register(name);
        expect(r.status).toBe(400);
        expect(r.json.error).toBe(RESERVED_NAME);
      }
      const lan = (await register("Lan")).json;
      const rename = await call("PATCH", "/api/auth/me", { username: "chu nha" }, { token: lan.session });
      expect(rename.status).toBe(400);
      expect(rename.json.error).toBe(RESERVED_NAME);
      expect((await call("GET", "/api/auth/me", undefined, { token: lan.session })).json.user).toMatchObject({ username: "Lan", role: "user" });
      // An admin may still rename to the free owner name (documented limit).
      const boss = await registerAdmin("Sep");
      expect((await call("PATCH", "/api/auth/me", { username: "Chu Nha" }, { token: boss.session })).status).toBe(200);
    });

    it("the user list takes filter, sort and order, and rejects anything else", async () => {
      const { boss } = await setup();
      const lan = (await register("Lan")).json;
      await call("PATCH", `/api/admin/users/${lan.user.id}`, { disabled: true }, { token: boss.session });
      const get = (qs: string) => call("GET", `/api/admin/users?${qs}`, undefined, { token: boss.session });
      const names = async (qs: string) => (await get(qs)).json.users.map((u: { username: string }) => u.username);
      expect(await names("filter=owner")).toEqual(["Chu Nha"]);
      expect(await names("filter=admin&sort=createdAt&order=asc")).toEqual(["Chu Nha", "Sep"]);
      expect(await names("filter=disabled")).toEqual(["Lan"]);
      expect(await names("q=CHU&filter=admin")).toEqual(["Chu Nha"]);
      const r = await get("filter=disabled&page=1");
      expect(r.json).toMatchObject({ total: 1, page: 1, pageSize: 50 });
      for (const bad of ["filter=everyone", "sort=username", "sort=created_at%20desc%3B", "order=sideways"]) {
        const b = await get(bad);
        expect(b.status, bad).toBe(400);
        expect(b.json).toEqual({ ok: false, error: "Bộ lọc hoặc sắp xếp không hợp lệ" });
      }
      expect((await call("GET", "/api/admin/users?filter=owner")).status).toBe(401);
      // Lan's session was revoked by the lock; a signed-in non-admin gets 403 (tested in "admin gate and stats").
      expect((await call("GET", "/api/admin/users?filter=owner", undefined, { token: lan.session })).status).toBe(401);
    });

    it("with OWNER_USERNAME unset there is no owner protection", async () => {
      const chu = await registerAdmin("Chu Nha");
      const boss = await registerAdmin("Sep");
      const r = await call("PATCH", `/api/admin/users/${chu.user.id}`, { disabled: true }, { token: boss.session });
      expect(r.status).toBe(200);
      expect(r.json.user.isOwner).toBe(false);
    });
  });

  describe("admin password reset refuses a one-character password", () => {
    const snapshot = async (id: string) => {
      const u = await (await getAccountService()).store.userById(id);
      return { hash: u?.passwordHash, role: u?.role, disabled: u?.disabled, ver: u?.sessionVersion };
    };

    it("for a user target, with nothing changed", async () => {
      const boss = await registerAdmin();
      const lan = (await register("Lan")).json;
      const before = await snapshot(lan.user.id);
      const r = await call("PATCH", `/api/admin/users/${lan.user.id}`, { password: "1" }, { token: boss.session });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ ok: false, error: "Mật khẩu cần ít nhất 8 ký tự" });
      expect(await snapshot(lan.user.id)).toEqual(before);
      expect((await call("GET", "/api/auth/me", undefined, { token: lan.session })).status).toBe(200);
      expect((await call("POST", "/api/auth/login", { username: "Lan", password: "1" })).status).toBe(401);
      expect((await call("POST", "/api/auth/login", { username: "Lan", password: "matkhau123" })).status).toBe(200);
    });

    it("for an admin target, and when promoting", async () => {
      const boss = await registerAdmin();
      const other = await registerAdmin("Pho");
      const before = await snapshot(other.user.id);
      const r = await call("PATCH", `/api/admin/users/${other.user.id}`, { password: "1" }, { token: boss.session });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ ok: false, error: "Mật khẩu admin cần ít nhất 12 ký tự" });
      expect(await snapshot(other.user.id)).toEqual(before);
      const lan = (await register("Lan")).json;
      const promote = await call("PATCH", `/api/admin/users/${lan.user.id}`, { role: "admin", password: "1" }, { token: boss.session });
      expect(promote.status).toBe(400);
      expect((await snapshot(lan.user.id)).role).toBe("user");
    });

    it("for non-string passwords", async () => {
      const boss = await registerAdmin();
      const lan = (await register("Lan")).json;
      const before = await snapshot(lan.user.id);
      for (const password of [1, null, ["12345678"], { a: 1 }]) {
        const r = await call("PATCH", `/api/admin/users/${lan.user.id}`, { password }, { token: boss.session });
        expect(r.status, JSON.stringify(password)).toBe(400);
      }
      expect(await snapshot(lan.user.id)).toEqual(before);
    });
  });

  it("tracks page views", async () => {
    const boss = await registerAdmin();
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
    const boss = await registerAdmin();
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
    const boss = await registerAdmin();
    expect((await call("PATCH", "/api/admin/users/%E0%A4%A", { disabled: true }, { token: boss.session })).status).toBe(404);
  });

  it("refuses tracked paths under /play/ (reserved for WebSocket joins)", async () => {
    const boss = await registerAdmin();
    const r = await call("POST", "/api/track", { path: "/play/tienlen", device: "abcdefghijklmnop" });
    expect(r.status).toBe(400);
    expect((await call("POST", "/api/track", { path: "/play/x?y=1", device: "abcdefghijklmnop" })).status).toBe(400);
    expect((await call("POST", "/api/track", { path: "/player", device: "abcdefghijklmnop" })).status).toBe(204);
    const stats = await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session });
    expect(stats.json.totals.playDevices).toBe(0);
  });

  it("strips control characters from tracked paths", async () => {
    const boss = await registerAdmin();
    expect((await call("POST", "/api/track", { path: "/a\u0000b\n", device: "abcdefghijklmnop" })).status).toBe(204);
    const stats = await call("GET", "/api/admin/stats?days=7", undefined, { token: boss.session });
    expect(stats.json.topPages[0].path).toBe("/ab");
  });
});
