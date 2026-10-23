import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountService, resetAccountServiceForTests } from "../src/accounts/service";
import type { RoomState } from "../src/game/room";
import { createGameServer } from "../src/server/app";
import { attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";
import { accountSession, resetTestSessions } from "./helpers/accounts";
import { FakeSocket } from "./helpers/fakeSocket";

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.VERCEL;
  resetAccountServiceForTests();
  resetTestSessions();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const connect = (hub: ReturnType<typeof createRoomHub>) => {
  const s = new FakeSocket();
  attachConnection(s, { hub });
  return s;
};

/** A (hub A) and B (hub B, same room store) sit down; B drops, A plays min cards until the offline seat is auto-played to the end. */
async function playOutGame(names: [string, string] = ["Lan", "Minh"]) {
  const [lan, minh] = [await accountSession(names[0]), await accountSession(names[1])];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const store = createMemoryRoomStore<RoomState>();
  const hubA = createRoomHub(store);
  const hubB = createRoomHub(store);
  const code = await hubA.createRoom();
  const a = connect(hubA);
  const b = connect(hubB);
  a.say({ type: "join", code, token: "token-aaaaaaaa", session: lan });
  b.say({ type: "join", code, token: "token-bbbbbbbb", session: minh });
  await vi.advanceTimersByTimeAsync(200);
  a.say({ type: "start" });
  await vi.advanceTimersByTimeAsync(200);
  b.close();
  const state = async () => (await store.load(code))!.state;
  const aId = (await state()).seats.find((p) => p?.token === "token-aaaaaaaa")!.id;
  let ended = false;
  for (let t = 0; t < 150 && !ended; t++) {
    await vi.advanceTimersByTimeAsync(1000);
    if (t % 10 === 0) a.say({ type: "ping" });
    const g = (await state()).game;
    if (!g || g.status !== "playing") ended = true;
    else if (g.turn === aId) a.say(g.lastPlay ? { type: "pass" } : { type: "play", cards: [g.mustInclude ?? Math.min(...g.hands[aId])] });
  }
  await vi.advanceTimersByTimeAsync(200);
  return { ended, game: (await state()).game };
}

describe("join needs an account", () => {
  it("refuses a join without a session, and seats the account name instead of the name sent", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    const s = connect(hub);
    expect(await s.request({ type: "join", code, name: "Lan", token: "token-aaaaaaaa" })).toMatchObject({ ok: false, error: "Cần đăng nhập" });
    expect(await s.request({ type: "watch", code, name: "Lan", token: "token-aaaaaaaa", session: "x.y" })).toMatchObject({ ok: false, error: "Cần đăng nhập" });
    const session = await accountSession("Lan");
    expect((await s.request({ type: "join", code, name: "Kẻ giả", token: "token-aaaaaaaa", session })).ok).toBe(true);
    const v = await s.view((x) => x.seats.some(Boolean));
    expect(v.seats.filter(Boolean).map((p) => p!.name)).toEqual(["Lan"]);
  });

  it("refuses the token of a disabled user, even through the auth cache", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    const session = await accountSession("Lan");
    const svc = await getAccountService();
    const s = connect(hub);
    expect((await s.request({ type: "join", code, token: "token-aaaaaaaa", session })).ok).toBe(true);
    const user = (await svc.authenticate(session))!;
    await svc.store.updateUser(user.id, { disabled: true });
    svc.forget(user.id);
    expect(await connect(hub).request({ type: "join", code, token: "token-bbbbbbbb", session })).toMatchObject({ ok: false, error: "Cần đăng nhập" });
  });

  it("says the account server is down when it fails", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    const session = await accountSession("Lan");
    const svc = await getAccountService();
    vi.spyOn(svc, "authenticate").mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await connect(hub).request({ type: "join", code, token: "token-aaaaaaaa", session })).toMatchObject({
      ok: false,
      error: "Máy chủ tài khoản đang lỗi, thử lại sau",
    });
  });

  it("counts the device of a successful join as a play device", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    const session = await accountSession("Lan");
    const svc = await getAccountService();
    expect((await connect(hub).request({ type: "join", code, token: "token-aaaaaaaa", session, device: "abcdefghijklmnop" })).ok).toBe(true);
    for (let i = 0; i < 50 && (await svc.store.stats(7)).totals.playDevices === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect((await svc.store.stats(7)).totals.playDevices).toBe(1);
  });
});

describe("finished games feed the per-account leaderboard", () => {
  it("records each player once, even with two hubs on one room store", async () => {
    const { ended } = await playOutGame();
    expect(ended).toBe(true);
    const rows = await (await getAccountService()).store.leaderboard("tienlen", 50);
    expect(rows.map((r) => r.name).sort()).toEqual(["Lan", "Minh"]);
    expect(rows.every((r) => r.games === 1)).toBe(true);
    expect(rows.reduce((n, r) => n + r.wins, 0)).toBe(1);
  });

  it("seats and credits usernames containing the letter s exactly", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    const s = connect(hub);
    expect((await s.request({ type: "join", code, token: "token-aaaaaaaa", session: await accountSession("Sang sư") })).ok).toBe(true);
    const v = await s.view((x) => x.seats.some(Boolean));
    expect(v.seats.find(Boolean)!.name).toBe("Sang sư");
    const { ended } = await playOutGame(["Sang sư", "boss"]);
    expect(ended).toBe(true);
    const rows = await (await getAccountService()).store.leaderboard("tienlen", 50);
    expect(rows.map((r) => r.name).sort()).toEqual(["Sang sư", "boss"]);
    expect(rows.every((r) => r.games === 1)).toBe(true);
  });

  it("keeps the game going when writing results fails", async () => {
    const svc = await getAccountService();
    vi.spyOn(svc.store, "recordResults").mockRejectedValue(new Error("neon down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ended, game } = await playOutGame();
    expect(ended).toBe(true);
    expect(game?.status).toBe("ended");
    expect(err.mock.calls.some((c) => String(c[0]).includes("account results"))).toBe(true);
  });
});

describe("long names and seat ownership", () => {
  it("rejoins the same account after a username change mid-game", async () => {
    const session = await accountSession("Lan");
    const svc = await getAccountService();
    const store = createMemoryRoomStore<RoomState>();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    const a = connect(hub);
    await a.request({ type: "join", code, token: "token-aaaaaaaa", session });
    await connect(hub).request({ type: "join", code, token: "token-bbbbbbbb", session: await accountSession("Minh") });
    await a.request({ type: "start" });
    await svc.updateMe((await svc.authenticate(session))!, { username: "Lan Moi" });
    expect(await connect(hub).request({ type: "join", code, token: "token-aaaaaaaa", session })).toMatchObject({ ok: true });
    expect((await store.load(code))!.state.seats.filter(Boolean)).toHaveLength(2);
  });

  it("refuses another uid even when its new username equals the seat name", async () => {
    const session = await accountSession("Lan");
    const svc = await getAccountService();
    const store = createMemoryRoomStore<RoomState>();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    const a = connect(hub);
    await a.request({ type: "join", code, token: "token-aaaaaaaa", session });
    await connect(hub).request({ type: "join", code, token: "token-bbbbbbbb", session: await accountSession("Minh") });
    await a.request({ type: "start" });
    await svc.updateMe((await svc.authenticate(session))!, { username: "Lan Moi" });
    const other = await accountSession("Lan");
    const newAccount = await svc.register({ username: "Lan", password: "matkhau123" }, "10.8.0.1");
    if (!newAccount.ok) throw new Error("register");
    expect(await connect(hub).request({ type: "join", code, token: "token-aaaaaaaa", session: newAccount.session })).toMatchObject({ ok: false, error: "Ghế này thuộc tài khoản khác" });
  });
  const LONG = "Nguyễn Văn Ánh Đặngx";
  it("seats a 20-character username unchanged and ranks it", async () => {
    const name = LONG;
    expect([...name]).toHaveLength(20);
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    const s = connect(hub);
    expect((await s.request({ type: "join", code, token: "token-aaaaaaaa", session: await accountSession(name) })).ok).toBe(true);
    const v = await s.view((x) => x.seats.some(Boolean));
    expect(v.seats.find(Boolean)!.name).toBe(name);
  });

  it("refuses to take over a seat kept by token for another account mid-game", async () => {
    const [lan, minh, other] = [await accountSession("Lan"), await accountSession("Minh"), await accountSession("Khac")];
    const store = createMemoryRoomStore<RoomState>();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    const a = connect(hub);
    const b = connect(hub);
    expect((await a.request({ type: "join", code, token: "token-aaaaaaaa", session: lan })).ok).toBe(true);
    expect((await b.request({ type: "join", code, token: "token-bbbbbbbb", session: minh })).ok).toBe(true);
    await a.request({ type: "start" });
    expect(await connect(hub).request({ type: "join", code, token: "token-aaaaaaaa", session: other })).toMatchObject({ ok: false, error: "Ghế này thuộc tài khoản khác" });
    const seat = (await store.load(code))!.state.seats.find((p) => p?.token === "token-aaaaaaaa");
    expect(seat?.name).toBe("Lan");
  });
});

describe("GET /api/leaderboard", () => {
  it("serves the current season, and the old format with season=old", async () => {
    const svc = await getAccountService();
    await accountSession("Lan");
    await svc.store.recordResults("tienlen", "g1", new Date(), [{ usernameKey: "lan", points: 5, rank: 1 }]);
    const server: Server = createGameServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const cur = await (await fetch(`${base}/api/leaderboard?limit=20`)).json();
      expect(cur).toEqual({ season: "current", rows: [{ name: "Lan", points: 5, games: 1, wins: 1, icon: "", color: "#fbbf24" }] });
      const old = await (await fetch(`${base}/api/leaderboard?season=old&limit=20`)).json();
      expect(old).toMatchObject({ ok: true, players: expect.any(Array) });
      vi.spyOn(svc.store, "leaderboard").mockRejectedValue(new Error("secret pg detail"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const bad = await fetch(`${base}/api/leaderboard`);
      expect(bad.status).toBe(503);
      expect(await bad.json()).toEqual({ ok: false, error: "Máy chủ tài khoản đang lỗi, thử lại sau" });
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
