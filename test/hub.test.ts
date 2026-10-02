import { describe, expect, it } from "vitest";
import type { ClientMessage, RoomView, ServerMessage } from "../src/game/protocol";
import { type HubSocket, type RoomHub, attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (arg?: any) => void;

/** In-process stand-in for a WebSocket, with a tiny client API for tests. */
class FakeSocket implements HubSocket {
  inbox: ServerMessage[] = [];
  private listeners: Record<string, Listener[]> = {};
  private nextId = 1;
  private waiters: (() => void)[] = [];

  send(data: string) {
    this.inbox.push(JSON.parse(data));
    this.waiters.splice(0).forEach((w) => w());
  }
  close() {
    this.emit("close");
  }
  on(event: string, listener: Listener) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  emit(event: string, arg?: unknown) {
    this.listeners[event]?.forEach((l) => l(arg));
  }

  /** Send a message and resolve with its ack. */
  request(msg: Record<string, unknown>) {
    const id = this.nextId++;
    this.emit("message", JSON.stringify({ ...msg, id } as ClientMessage));
    return this.waitFor((m) => m.type === "ack" && m.id === id) as Promise<Extract<ServerMessage, { type: "ack" }>>;
  }

  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.inbox.find(pred);
      if (hit) return hit;
      if (Date.now() > until) throw new Error("timed out waiting for message");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 20);
      });
    }
  }

  /** Latest state view that satisfies `pred`. */
  async view(pred: (v: RoomView) => boolean = () => true): Promise<RoomView> {
    const until = Date.now() + 2000;
    for (;;) {
      const views = this.inbox.filter((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state");
      const last = views[views.length - 1]?.view;
      if (last && pred(last)) return last;
      if (Date.now() > until) throw new Error("timed out waiting for view");
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

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
  expect((await a.request({ type: "join", code, name: "An", token: "token-aaaaaaaa" })).ok).toBe(true);
  const b = connect(hubB);
  expect((await b.request({ type: "join", code, name: "Bình", token: "token-bbbbbbbb" })).ok).toBe(true);
  return { a, b, code };
}

describe("RoomHub over WebSocket messages", () => {
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
    expect(await s.request({ type: "join", code: "ZZZZZ", name: "x", token: "token-cccccccc" })).toMatchObject({
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
    const sockets = [0, 1, 2, 3].map((i) => connect(hubs[i % 2]));
    const acks = await Promise.all(
      sockets.map((s, i) => s.request({ type: "join", code, name: `P${i}`, token: `token-${i}-concurrent` })),
    );
    expect(acks.every((r) => r.ok)).toBe(true);
    const v = await sockets[0].view((x) => x.seats.filter(Boolean).length === 4);
    expect(new Set(v.seats.map((s) => s!.id)).size).toBe(4);
  });
});

describe("player look (icon + colour)", () => {
  it("is relayed by name to everyone; bad looks are ignored and tokens never leak", async () => {
    const hub = createRoomHub(createMemoryRoomStore());
    const a = connect(hub);
    const code = ((await a.request({ type: "create" })) as { code: string }).code;
    await a.request({ type: "join", code, name: "An", token: "token-aaaaaaaa", look: { icon: "🦊", color: "#F472B6" } });
    const b = connect(hub);
    await b.request({ type: "join", code, name: "Bình", token: "token-bbbbbbbb", look: { icon: "x", color: "javascript:1" } });
    const looks = (v: unknown) => (v as { looks?: Record<string, { icon: string; color: string }> }).looks;
    const va = await a.view((v) => !!looks(v)?.An);
    expect(looks(va)).toEqual({ An: { icon: "🦊", color: "#f472b6" } });
    expect(JSON.stringify(va)).not.toContain("token-");
    // Changing it mid-game reaches the other player too.
    expect((await a.request({ type: "look", look: { icon: "🐲", color: "#22d3ee" } })).ok).toBe(true);
    const vb = await b.view((v) => looks(v)?.An?.icon === "🐲");
    expect(looks(vb)?.An).toEqual({ icon: "🐲", color: "#22d3ee" });
    expect((await a.request({ type: "look", look: { icon: "x", color: "red" } })).ok).toBe(false);
  });
});
