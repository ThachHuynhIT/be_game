import { describe, expect, it } from "vitest";
import { TURN_SECONDS } from "../src/game/protocol";
import {
  PRESENCE_TIMEOUT_MS,
  SEAT_GRACE_MS,
  heartbeat,
  joinRoom,
  leaveRoom,
  newRoom,
  nextTickAt,
  roomView,
  startGame,
  tick,
} from "../src/game/room";

let n = 0;
const id = () => `p${++n}`;
const T0 = 1_000_000;

function roomWith(count: number) {
  const room = newRoom("ABCDE");
  const players = Array.from({ length: count }, (_, i) => {
    const r = joinRoom(room, `token-${i}-xxxxxx`, `P${i}`, T0, id);
    if (!r.ok) throw new Error(r.error);
    return r.player;
  });
  return { room, players };
}

describe("room lifecycle", () => {
  it("seats up to 4, re-attaches by token and rejects a 5th", () => {
    const { room, players } = roomWith(4);
    expect(room.hostId).toBe(players[0].id);
    const again = joinRoom(room, "token-1-xxxxxx", "Renamed", T0 + 5, id);
    expect(again.ok && again.player.id).toBe(players[1].id);
    expect(room.seats[1]?.name).toBe("Renamed");
    expect(joinRoom(room, "token-9-xxxxxx", "X", T0, id)).toEqual({ ok: false, error: "Phòng đã đủ 4 người" });
    expect(joinRoom(room, "short", "X", T0, id).ok).toBe(false);
  });

  it("only the host can start, and each view shows only your own hand", () => {
    const { room, players } = roomWith(2);
    expect(startGame(room, players[1], T0).ok).toBe(false);
    expect(startGame(room, players[0], T0).ok).toBe(true);
    const v0 = roomView(room, players[0], T0);
    const v1 = roomView(room, players[1], T0);
    expect(v0.hand).toHaveLength(13);
    expect(v1.hand).toHaveLength(13);
    expect(v0.hand.some((c) => v1.hand.includes(c))).toBe(false);
    expect(JSON.stringify(v0)).not.toContain("token-");
    expect(v0.game?.turnDeadline).toBe(T0 + TURN_SECONDS * 1000);
  });

  it("tick auto-plays an expired turn", () => {
    const { room, players } = roomWith(2);
    startGame(room, players[0], T0);
    const turn = room.game!.turn!;
    if (room.game!.status !== "playing") return; // tới trắng on the random deal
    // Everyone keeps heartbeating; only the turn timer runs out.
    const later = T0 + TURN_SECONDS * 1000;
    players.forEach((p) => {
      p.lastSeen = later;
    });
    expect(tick(room, later - 1)).toBe(false);
    expect(tick(room, later)).toBe(true);
    expect(room.game!.turn).not.toBe(turn);
    expect(room.game!.lastPlay?.playerId).toBe(turn);
  });

  it("an offline player's turn is auto-played without waiting for the timer", () => {
    const { room, players } = roomWith(2);
    startGame(room, players[0], T0);
    if (room.game!.status !== "playing") return;
    const turn = room.game!.turn!;
    const other = players.find((p) => p.id !== turn)!;
    const t = T0 + PRESENCE_TIMEOUT_MS + 1;
    other.lastSeen = t;
    expect(tick(room, t)).toBe(true);
    expect(room.game!.lastPlay?.playerId).toBe(turn);
  });

  it("host passes to an online player when the host goes quiet", () => {
    const { room, players } = roomWith(2);
    const t = T0 + PRESENCE_TIMEOUT_MS + 1;
    heartbeat(room, players[1], t);
    tick(room, t);
    expect(room.hostId).toBe(players[1].id);
  });

  it("leaving mid-game keeps the seat (auto-played); leaving between games frees it", () => {
    const { room, players } = roomWith(3);
    startGame(room, players[0], T0);
    leaveRoom(room, players[2], T0 + 1);
    expect(room.seats.filter(Boolean)).toHaveLength(3);
    room.game!.status = "ended";
    tick(room, T0 + 2);
    expect(room.seats.filter(Boolean)).toHaveLength(2);
  });

  it("silent players are dropped after the grace period, between games only", () => {
    const { room, players } = roomWith(2);
    const t = T0 + SEAT_GRACE_MS + 1;
    heartbeat(room, players[0], t);
    expect(tick(room, t)).toBe(true);
    expect(room.seats.filter(Boolean).map((p) => p!.id)).toEqual([players[0].id]);
  });

  it("nextTickAt points at the earliest pending deadline", () => {
    const { room, players } = roomWith(2);
    expect(nextTickAt(room, T0)).toBe(T0 + PRESENCE_TIMEOUT_MS);
    startGame(room, players[0], T0);
    if (room.game!.status === "playing") {
      expect(nextTickAt(room, T0)).toBe(Math.min(T0 + PRESENCE_TIMEOUT_MS, T0 + TURN_SECONDS * 1000));
    }
  });
});
