import { describe, expect, it } from "vitest";
import { createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";
import { PRESENCE_TIMEOUT_MS, SEAT_GRACE_MS } from "../src/game/room";
import {
  type GameAdapter,
  bangAdapter,
  canguaAdapter,
  meonoAdapter,
  noichuAdapter,
  oanquanAdapter,
  splendorAdapter,
  tienlenAdapter,
  typhuAdapter,
} from "../src/server/adapters";

// A player who loses the connection must come back as themselves, never as a new seat with the same name.
const ADAPTERS: [string, GameAdapter][] = [
  ["tienlen", tienlenAdapter as unknown as GameAdapter],
  ["meono", meonoAdapter as unknown as GameAdapter],
  ["typhu", typhuAdapter as unknown as GameAdapter],
  ["splendor", splendorAdapter as unknown as GameAdapter],
  ["bang", bangAdapter as unknown as GameAdapter],
  ["oanquan", oanquanAdapter as unknown as GameAdapter],
  ["cangua", canguaAdapter as unknown as GameAdapter],
  ["noichu", noichuAdapter as unknown as GameAdapter],
];

type Seat = { id: string; token: string; name: string; wins: number; points?: number; games?: number };
const T = 1_000_000;
const A = "token-a-xxxxxx";
const B = "token-b-xxxxxx";

function setup(adapter: GameAdapter) {
  let n = 0;
  const newId = () => `p${++n}`;
  const room = adapter.newRoom("ABCDE");
  const seats = () => (room as unknown as { seats: (Seat | null)[] }).seats.filter((s): s is Seat => !!s);
  const join = (token: string, name: string, now: number) => {
    const r = adapter.join(room, token, name, now, newId, token);
    if (!r.ok) throw new Error(r.error);
    // This fixture represents rooms persisted before account-owned seats.
    for (const seat of seats()) delete (seat as Seat & { uid?: string }).uid;
  };
  join(A, "Thach", T);
  join(B, "Lan", T);
  const a = seats().find((s) => s.token === A)!;
  a.wins = 2;
  a.points = 7;
  a.games = 3;
  return { room, seats, join, aId: a.id };
}

describe.each(ADAPTERS)("%s: reconnecting keeps the player", (_game, adapter) => {
  it("rejects a kicked account on another device without persisting its changed token", async () => {
    const store = createMemoryRoomStore();
    const hub = createRoomHub(store, adapter);
    const code = await hub.createRoom();
    let target = 1;
    await hub.mutate(code, (room, now) => {
      for (let i = 0; i < 4; i++) expect(adapter.join(room, "token-kick-" + i, "Player" + i, now, () => "p" + i, "account-" + i).ok).toBe(true);
      expect(adapter.command(room, "token-kick-0", { type: "start" }, now).ok).toBe(true);
      const state = room as unknown as { game: unknown; current?: { status: string }; seats: (Seat & { lastSeen: number; kicked?: boolean } | null)[] };
      const game = (typeof state.game === "object" ? state.game : state.current) as { status: string };
      if (_game === "bang") {
        const bang = game as unknown as { ps: Record<string, { role: string }> };
        // Keep a sheriff and another outlaw alive after the chosen outlaw is kicked.
        const roles = ["sheriff", "renegade", "outlaw", "outlaw"];
        roles.forEach((role, i) => { bang.ps["p" + i].role = role; });
        target = Number(Object.keys(bang.ps).find((id) => bang.ps[id].role === "outlaw")!.slice(1));
      } else game.status = "playing";
      state.seats.find((p) => p?.id === "p" + target)!.lastSeen = 0;
      expect(adapter.command(room, "token-kick-0", { type: "kick", playerId: "p" + target }, now).ok).toBe(true);
      expect(state.seats.find((p) => p?.id === "p" + target)?.kicked).toBe(true);
      if (_game === "bang") expect(game.status).not.toBe("ended");
      else expect(game.status).toBe("playing");
    });
    const before = await store.load(code);
    const result = await hub.mutate(code, (room, now) => adapter.join(room, "token-new-device", "Player" + target, now, () => "new", "account-" + target), (r) => !r.ok);
    expect(result).toEqual({ found: true, result: { ok: false, error: "Bạn đã bị chủ phòng mời ra khỏi ván này" } });
    const after = await store.load(code);
    expect(after).toEqual(before);
    expect((after!.state as unknown as { seats: (Seat | null)[] }).seats.find((p) => p?.id === "p" + target)?.token).toBe("token-kick-" + target);
  });

  it("an account takes its online seat with a new token, even in a full room", () => {
    const room = adapter.newRoom("ABCDE");
    let n = 0;
    const id = () => `p${++n}`;
    const join = adapter.join as (...args: unknown[]) => { ok: boolean };
    expect(join(room, A, "Thach", T, id, "account-a").ok).toBe(true);
    const seats = () => (room as unknown as { seats: (Seat & { uid?: string } | null)[] }).seats;
    const original = seats().find(Boolean)!;
    for (let i = 1; i < seats().length; i++) expect(join(room, `token-fill-${i}`, `Player${i}`, T, id, `account-${i}`).ok).toBe(true);
    expect(join(room, "token-new-device", "Thach", T + 1, id, "account-a").ok).toBe(true);
    expect(seats().find((p) => p?.id === original.id)).toMatchObject({ token: "token-new-device", uid: "account-a" });
    expect(seats().filter(Boolean)).toHaveLength(seats().length);
    const out = JSON.stringify([adapter.view(room, "token-new-device", "player", T + 1), adapter.summary(room, T + 1)]);
    expect(out).not.toContain('"uid"');
    expect(out).not.toContain("account-a");
  });

  it("takes the same online seat mid-game without changing the game or stats", () => {
    const room = adapter.newRoom("ABCDE");
    let n = 0;
    const id = () => `p${++n}`;
    for (let i = 0; i < 3; i++) expect(adapter.join(room, `token-seat-${i}`, `Player${i}`, T, id, `account-${i}`).ok).toBe(true);
    expect(adapter.command(room, "token-seat-0", { type: "start" }, T).ok).toBe(true);
    const state = room as unknown as { game: unknown; current?: { status: string }; seats: (Seat | null)[] };
    const game = (typeof state.game === "object" ? state.game : state.current) as { status: string };
    // Fix the phase explicitly because a Tiến Lên deal can otherwise win instantly.
    game.status = "playing";
    const before = JSON.stringify(game);
    const seat = state.seats.find((p) => p?.token === "token-seat-0")!;
    seat.wins = 2;
    seat.points = 7;
    expect(adapter.join(room, "token-new-device", "Renamed", T + 1, id, "account-0").ok).toBe(true);
    expect(state.seats.find((p) => p?.token === "token-new-device")).toMatchObject({ id: seat.id, wins: 2, points: 7 });
    expect(state.seats.filter(Boolean)).toHaveLength(3);
    expect(JSON.stringify(game)).toBe(before);
  });

  it("a different account cannot reclaim an owned offline seat by name", () => {
    const room = adapter.newRoom("ABCDE");
    let n = 0;
    const id = () => `p${++n}`;
    const join = adapter.join as (...args: unknown[]) => { ok: boolean };
    join(room, A, "Thach", T, id, "account-a");
    const seats = (room as unknown as { seats: (Seat | null)[] }).seats;
    const original = seats.find(Boolean)!;
    join(room, "token-other-xxx", "Thach", T + PRESENCE_TIMEOUT_MS + 1, id, "account-other");
    expect(seats.find((p) => p?.id === original.id)?.token).toBe(A);
  });

  it("claims a legacy offline seat by name and attaches the account", () => {
    const { room, aId } = setup(adapter);
    const join = adapter.join as (...args: unknown[]) => { ok: boolean };
    expect(join(room, "token-new-device", "Thach", T + PRESENCE_TIMEOUT_MS + 1, () => "new", "account-a").ok).toBe(true);
    expect((room as unknown as { seats: (Seat | null)[] }).seats.find((p) => p?.id === aId)).toMatchObject({ uid: "account-a" });
  });
  it("a seat dropped after the grace period comes back with the same id and stats", () => {
    const { room, seats, join, aId } = setup(adapter);
    const t = T + SEAT_GRACE_MS + 1;
    adapter.heartbeat(room, B, t);
    adapter.tick(room, t);
    expect(seats().map((s) => s.name)).toEqual(["Lan"]);

    join(A, "Thach", t + 1_000);
    const back = seats().find((s) => s.token === A)!;
    expect(back).toMatchObject({ id: aId, name: "Thach", wins: 2, points: 7, games: 3 });
    expect(seats()).toHaveLength(2);
  });

  it("a seat freed by leaving comes back with the same id and stats", () => {
    const { room, seats, join, aId } = setup(adapter);
    adapter.leave(room, A, T + 10);
    expect(seats()).toHaveLength(1);
    join(A, "Thach", T + 20);
    expect(seats().find((s) => s.token === A)).toMatchObject({ id: aId, wins: 2, points: 7 });
  });

  it("a new session under the same name takes back an offline seat instead of adding one", () => {
    const { room, seats, join, aId } = setup(adapter);
    const t = T + PRESENCE_TIMEOUT_MS + 1;
    adapter.heartbeat(room, B, t);
    join("token-a-new-tab", "  thach ", t);
    expect(seats()).toHaveLength(2);
    expect(seats().find((s) => s.id === aId)!.token).toBe("token-a-new-tab");
  });

  it("a dropped seat is also found again by name from a new session", () => {
    const { room, seats, join, aId } = setup(adapter);
    const t = T + SEAT_GRACE_MS + 1;
    adapter.heartbeat(room, B, t);
    adapter.tick(room, t);
    join("token-a-new-tab", "Thach", t + 1);
    expect(seats().find((s) => s.token === "token-a-new-tab")).toMatchObject({ id: aId, wins: 2 });
  });

  it("an online player's name is not taken over: a namesake gets their own seat", () => {
    const { seats, join, aId } = setup(adapter);
    join("token-other-xxx", "Thach", T + 1_000);
    expect(seats()).toHaveLength(3);
    expect(seats().find((s) => s.id === aId)!.token).toBe(A);
  });

  it("remembered seats never reach views or summaries", () => {
    const { room, join } = setup(adapter);
    adapter.leave(room, A, T + 10);
    join("token-c-xxxxxx", "Minh", T + 20);
    const out = JSON.stringify([adapter.view(room, B, "player", T + 30), adapter.summary(room, T + 30)]);
    expect(out).not.toContain(A);
    expect(JSON.parse(JSON.stringify(room))).toEqual(room);
  });
});
