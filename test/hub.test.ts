import { beforeAll, describe, expect, it } from "vitest";
import { type RoomHub, attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";
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
    // Changing it mid-game reaches the other player too.
    expect((await a.request({ type: "look", look: { icon: "🐲", color: "#22d3ee" } })).ok).toBe(true);
    const vb = await b.view((v) => looks(v)?.Fox?.icon === "🐲");
    expect(looks(vb)?.Fox).toEqual({ icon: "🐲", color: "#22d3ee" });
    expect((await a.request({ type: "look", look: { icon: "x", color: "red" } })).ok).toBe(false);
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
