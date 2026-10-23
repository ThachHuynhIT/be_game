import { beforeAll, describe, expect, it, vi } from "vitest";
import { type RoomHub, attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";
import { getAccountService } from "../src/accounts/service";
import { FakeSocket } from "./helpers/fakeSocket";
import { accountSession } from "./helpers/accounts";

const S: Record<string, string> = {};
beforeAll(async () => {
  S.An = await accountSession("An1");
  S.Binh = await accountSession("Binh");
  S.Fox = await accountSession("Fox", { icon: "🦊", color: "#f472b6" });
});
function connect(hub: RoomHub) {
  const s = new FakeSocket();
  attachConnection(s, { hub });
  return s;
}

async function joinedPair(hubA: RoomHub, hubB: RoomHub) {
  const a = connect(hubA);
  const created = await a.request({ type: "create" });
  expect(created.ok).toBe(true);
  const code = (created as { code: string }).code;
  expect((await a.request({ type: "join", code, token: "token-aaaaaaaa", session: S.An })).ok).toBe(true);
  const b = connect(hubB);
  expect((await b.request({ type: "join", code, token: "token-bbbbbbbb", session: S.Binh })).ok).toBe(true);
  return { a, b, code };
}

describe("RoomHub over WebSocket messages", () => {
  it("discards leave queued behind the ping that revokes the socket", async () => {
    const session = await accountSession("QueueRevoked");
    const svc = await getAccountService();
    const store = createMemoryRoomStore();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    let now = Date.now();
    const s = new FakeSocket();
    attachConnection(s, { hub, now: () => now });
    await s.request({ type: "join", code, token: "token-queue-xxxx", session });
    await svc.logout((await svc.authenticate(session))!);
    now += 30_001;
    s.say({ type: "ping" });
    s.say({ type: "leave" });
    await s.waitFor((m) => m.type === "signedOut");
    // Let the already-enqueued leave reach the queue runner.
    await new Promise((r) => setImmediate(r));
    expect(((await store.load(code))!.state as unknown as { seats: ({ token: string } | null)[] }).seats.some((p) => p?.token === "token-queue-xxxx")).toBe(true);
  });
  it("replaces the old device across hubs without freeing the account seat", async () => {
    const store = createMemoryRoomStore();
    const hubA = createRoomHub(store);
    const hubB = createRoomHub(store);
    const { a, b, code } = await joinedPair(hubA, hubB);
    const before = await a.view();
    const replacement = connect(hubB);
    expect((await replacement.request({ type: "join", code, token: "token-new-device", session: S.An })).ok).toBe(true);
    expect(await a.waitFor((m) => (m as { type: string }).type === "signedOut")).toMatchObject({ type: "signedOut", reason: "replaced" });
    expect(a.closed).toEqual({ code: 4001, reason: "replaced" });
    expect((await replacement.view()).meId).toBe(before.meId);
    expect((await replacement.view()).seats.filter(Boolean)).toHaveLength(2);
    b.close(); replacement.close();
  });

  it("checks revoked sessions only on the first ping after 30 seconds and keeps the seat", async () => {
    const session = await accountSession("RevokePing");
    const svc = await getAccountService();
    const store = createMemoryRoomStore();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    let now = Date.now();
    const s = new FakeSocket();
    attachConnection(s, { hub, now: () => now } as Parameters<typeof attachConnection>[1]);
    await s.request({ type: "join", code, token: "token-revoked-xx", session });
    await svc.logout((await svc.authenticate(session))!);
    now += 30_000;
    s.say({ type: "ping" });
    await s.waitFor((m) => m.type === "pong");
    expect(s.inbox.some((m) => (m as { type: string }).type === "signedOut")).toBe(false);
    now++;
    s.say({ type: "ping" });
    expect(await s.waitFor((m) => (m as { type: string }).type === "signedOut")).toMatchObject({ type: "signedOut", reason: "revoked" });
    expect(s.closed).toEqual({ code: 4001, reason: "revoked" });
    expect(JSON.stringify((await store.load(code))!.state)).toContain("token-revoked-xx");
  });

  it("keeps the socket when session reauthentication fails", async () => {
    const session = await accountSession("ErrorPing");
    const svc = await getAccountService();
    const hub = createRoomHub(createMemoryRoomStore());
    const code = await hub.createRoom();
    let now = Date.now();
    const s = new FakeSocket();
    attachConnection(s, { hub, now: () => now } as Parameters<typeof attachConnection>[1]);
    await s.request({ type: "join", code, token: "token-error-xxxx", session });
    const spy = vi.spyOn(svc, "authenticate").mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      now += 30_001;
      s.say({ type: "ping" });
      await s.waitFor((m) => m.type === "pong");
      expect(s.inbox.some((m) => (m as { type: string }).type === "signedOut")).toBe(false);
      expect(log).toHaveBeenCalled();
    } finally { spy.mockRestore(); log.mockRestore(); s.close(); }
  });
  it("creates, joins, starts and deals private hands", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const { a, b } = await joinedPair(hub, hub);
    expect((await b.request({ type: "start" })).ok).toBe(false); // not host
    expect((await a.request({ type: "start" })).ok).toBe(true);
    const va = await a.view((v) => !!v.game);
    const vb = await b.view((v) => !!v.game);
    expect(va.hand).toHaveLength(13);
    expect(vb.hand).toHaveLength(13);
    expect(va.hand.some((c) => vb.hand.includes(c))).toBe(false);
  });

  it("players on different instances (hubs) sharing one store see each other's moves", async () => {
    const store = createMemoryRoomStore();
    const { a, b } = await joinedPair(createRoomHub(store), createRoomHub(store));
    await a.request({ type: "start" });
    const va = await a.view((v) => !!v.game);
    if (va.game!.status !== "playing") return; // tới trắng on the random deal
    const leader = va.game!.turn === va.meId ? a : b;
    const lv = await leader.view((v) => !!v.game);
    const card = lv.game!.mustInclude ?? Math.min(...lv.hand);
    expect((await leader.request({ type: "play", cards: [card] })).ok).toBe(true);
    const other = leader === a ? b : a;
    const seen = await other.view((v) => v.game?.lastPlay?.combo.cards[0] === card);
    expect(seen.game!.turn).toBe(seen.meId);
  });

  it("does not save changes made by a refused mutation", async () => {
    const store = createMemoryRoomStore();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    await hub.mutate(
      code,
      (room) => {
        (room as unknown as { hostId: string }).hostId = "changed";
        return { ok: false };
      },
      (r) => !r.ok,
    );
    expect(((await store.load(code))!.state as unknown as { hostId: string }).hostId).not.toBe("changed");
    await hub.mutate(code, (room) => {
      (room as unknown as { hostId: string }).hostId = "changed";
      return { ok: true };
    });
    expect(((await store.load(code))!.state as unknown as { hostId: string }).hostId).toBe("changed");
  });

  it("rejects illegal moves and unknown rooms", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const s = connect(hub);
    expect(await s.request({ type: "join", code: "ZZZZZ", token: "token-cccccccc", session: S.An })).toMatchObject({
      ok: false,
      error: "Không tìm thấy phòng",
    });
    expect((await s.request({ type: "play", cards: [0] })).ok).toBe(false);
    const { a } = await joinedPair(hub, hub);
    await a.request({ type: "start" });
    const va = await a.view((v) => !!v.game);
    if (va.game!.status !== "playing") return;
    expect(await a.request({ type: "play", cards: [999] })).toMatchObject({ ok: false });
  });

  it("concurrent writes from two instances do not lose updates", async () => {
    const store = createMemoryRoomStore();
    const hubs = [createRoomHub(store), createRoomHub(store)];
    const host = connect(hubs[0]);
    const code = ((await host.request({ type: "create" })) as { code: string }).code;
    const ps = await Promise.all([0, 1, 2, 3].map((i) => accountSession(`Con${i}`)));
    const sockets = [0, 1, 2, 3].map((i) => connect(hubs[i % 2]));
    const acks = await Promise.all(
      sockets.map((s, i) => s.request({ type: "join", code, token: `token-${i}-concurrent`, session: ps[i] })),
    );
    expect(acks.every((r) => r.ok)).toBe(true);
    const v = await sockets[0].view((x) => x.seats.filter(Boolean).length === 4);
    expect(new Set(v.seats.map((s) => s!.id)).size).toBe(4);
  });
});

describe("player look (icon + colour)", () => {
  it("comes from the account, is relayed by name to everyone and tokens never leak", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const a = connect(hub);
    const code = ((await a.request({ type: "create" })) as { code: string }).code;
    await a.request({ type: "join", code, name: "ignored", token: "token-aaaaaaaa", session: S.Fox, look: { icon: "x", color: "red" } });
    const b = connect(hub);
    await b.request({ type: "join", code, token: "token-bbbbbbbb", session: S.Binh });
    const looks = (v: unknown) => (v as { looks?: Record<string, { icon: string; color: string }> }).looks;
    const va = await a.view((v) => !!looks(v)?.Fox && !!looks(v)?.Binh);
    expect(looks(va)).toEqual({ Fox: { icon: "🦊", color: "#f472b6" }, Binh: { icon: "", color: "#fbbf24" } });
    expect(JSON.stringify(va)).not.toContain("token-");
    // A "look" message ignores its payload and applies the account's current look.
    expect((await a.request({ type: "look", look: { icon: "🐲", color: "#22d3ee" } })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(looks(await b.view())?.Fox).toEqual({ icon: "🦊", color: "#f472b6" });
    // After the profile changes (PATCH /api/auth/me), the next "look" message shows the new look to everyone.
    const svc = await getAccountService();
    const me = (await svc.authenticate(S.Fox))!;
    expect((await svc.updateMe(me, { icon: "🐲", color: "#22d3ee" })).ok).toBe(true);
    expect((await a.request({ type: "look", look: { icon: "x", color: "red" } })).ok).toBe(true);
    const vb = await b.view((v) => looks(v)?.Fox?.icon === "🐲");
    expect(looks(vb)?.Fox).toEqual({ icon: "🐲", color: "#22d3ee" });
  });

  it("still applies a look change after a password change revoked the join token", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const svc = await getAccountService();
    const reg = await svc.register({ username: "Cuong", password: "matkhau123" }, "10.77.0.1");
    if (!reg.ok) throw new Error("register");
    const a = connect(hub);
    const code = ((await a.request({ type: "create" })) as { code: string }).code;
    expect((await a.request({ type: "join", code, token: "token-cccccccc", session: reg.session })).ok).toBe(true);
    const changed = await svc.updateMe((await svc.authenticate(reg.session))!, { password: "matkhau456", oldPassword: "matkhau123" });
    if (!changed.ok || !changed.session) throw new Error("password change");
    expect(await svc.authenticate(reg.session)).toBeNull();
    expect((await svc.updateMe((await svc.authenticate(changed.session))!, { icon: "🐼", color: "#60a5fa" })).ok).toBe(true);
    expect((await a.request({ type: "look" })).ok).toBe(true);
    const looks = (v: unknown) => (v as { looks?: Record<string, { icon: string; color: string }> }).looks;
    const v = await a.view((x) => looks(x)?.Cuong?.icon === "🐼");
    expect(looks(v)?.Cuong).toEqual({ icon: "🐼", color: "#60a5fa" });
  });

  it("refuses a look before joining", async () => {
    const a = connect(createRoomHub(createMemoryRoomStore()));
    expect((await a.request({ type: "look" })).ok).toBe(false);
  });
});

describe("RoomHub's copy of the room", () => {
  it("applies a valid command and pushes the new views without reading the store", async () => {
    const store = createMemoryRoomStore();
    const { a, b } = await joinedPair(createRoomHub(store), createRoomHub(store));
    await a.request({ type: "start" });
    const va = await a.view((v) => !!v.game);
    if (va.game!.status !== "playing") return; // tới trắng on the random deal
    await new Promise((r) => setTimeout(r, 100)); // let both instances settle on the started game
    const leader = va.game!.turn === va.meId ? a : b;
    const other = leader === a ? b : a;
    const lv = await leader.view((v) => !!v.game);
    const card = lv.game!.mustInclude ?? Math.min(...lv.hand);

    let loads = 0;
    const load = store.load.bind(store);
    store.load = (code: string) => {
      loads++;
      return load(code);
    };
    expect((await leader.request({ type: "play", cards: [card] })).ok).toBe(true);
    await leader.view((v) => v.game?.lastPlay?.combo.cards[0] === card);
    await other.view((v) => v.game?.lastPlay?.combo.cards[0] === card);
    // The leader's instance saves from its copy and shows its own save; only the other instance reads.
    expect(loads).toBeLessThanOrEqual(1);
  });
});
