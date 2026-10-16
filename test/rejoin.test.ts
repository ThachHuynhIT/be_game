import { describe, expect, it } from "vitest";
import { PRESENCE_TIMEOUT_MS, SEAT_GRACE_MS } from "../src/game/room";
import {
  type GameAdapter,
  bangAdapter,
  canguaAdapter,
  meonoAdapter,
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
    const r = adapter.join(room, token, name, now, newId);
    if (!r.ok) throw new Error(r.error);
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
