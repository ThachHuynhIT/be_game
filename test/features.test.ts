import { describe, expect, it } from "vitest";
import { parseCards as c } from "../src/game/cards";
import { forfeit, newGame, pass, play } from "../src/game/game";
import {
  PRESENCE_TIMEOUT_MS,
  REACTION_TTL_MS,
  joinRoom,
  kickPlayer,
  newRoom,
  react,
  roomSummary,
  roomView,
  startGame,
  tick,
  watchRoom,
} from "../src/game/room";
import { createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";

let n = 0;
const id = () => `p${++n}`;
const T0 = 5_000_000;

function roomWith(count: number) {
  const room = newRoom("QWERT");
  const players = Array.from({ length: count }, (_, i) => {
    const r = joinRoom(room, `token-${i}-features`, `P${i}`, T0, id);
    if (!r.ok) throw new Error(r.error);
    return r.player;
  });
  return { room, players };
}

describe("forfeit (game)", () => {
  it("skips a forfeited player and ranks them last", () => {
    const g = newGame(["A", "B", "C"], { hands: { A: c("3s 9h"), B: c("4s 5s"), C: c("6s 7s") } });
    play(g, "A", c("3s"));
    expect(g.turn).toBe("B");
    expect(forfeit(g, "B").ok).toBe(true);
    expect(g.turn).toBe("C");
    play(g, "C", c("6s"));
    pass(g, "A");
    // Everyone else passed / is out → C leads again and plays out.
    expect(g.turn).toBe("C");
    play(g, "C", c("7s"));
    expect(g.status).toBe("ended");
    expect(g.finished).toEqual(["C", "A", "B"]);
  });

  it("forfeiting the round leader hands the lead on", () => {
    const g = newGame(["A", "B", "C"], { hands: { A: c("3s 9h"), B: c("4s 5s"), C: c("6s 7s") } });
    play(g, "A", c("3s"));
    pass(g, "B");
    pass(g, "C");
    expect(g.turn).toBe("A"); // A leads the new round
    forfeit(g, "A");
    expect(g.turn).toBe("B");
  });

  it("records what a chop chopped", () => {
    const g = newGame(["A", "B"], { hands: { A: c("3s 2h 9d"), B: c("4s 4h 5s 5h 6c 6d Kd") } });
    play(g, "A", c("3s"));
    pass(g, "B");
    play(g, "A", c("2h"));
    play(g, "B", c("4s 4h 5s 5h 6c 6d"));
    expect(g.lastPlay?.chop).toBe(true);
    expect(g.lastPlay?.chopped?.cards).toEqual(c("2h"));
  });
});

describe("kick / spectators / emoji / scoring (room)", () => {
  it("host can kick only offline players; mid-game they forfeit and score last", () => {
    const { room, players } = roomWith(3);
    startGame(room, players[0], T0);
    if (room.game!.status !== "playing") return; // tới trắng on the random deal
    expect(kickPlayer(room, players[1], players[2].id, T0).ok).toBe(false); // not host
    expect(kickPlayer(room, players[0], players[2].id, T0)).toMatchObject({ ok: false }); // still online
    const later = T0 + PRESENCE_TIMEOUT_MS + 1;
    players[0].lastSeen = players[1].lastSeen = later;
    expect(kickPlayer(room, players[0], players[2].id, later).ok).toBe(true);
    expect(room.game!.forfeited).toEqual([players[2].id]);
    expect(joinRoom(room, "token-2-features", "back", later, id)).toMatchObject({ ok: false });
  });

  it("kicking between games frees the seat", () => {
    const { room, players } = roomWith(2);
    const later = T0 + PRESENCE_TIMEOUT_MS + 1;
    players[0].lastSeen = later;
    expect(kickPlayer(room, players[0], players[1].id, later).ok).toBe(true);
    expect(room.seats.filter(Boolean)).toHaveLength(1);
  });

  it("finished games update points, history and zero-sum totals", () => {
    const { room, players } = roomWith(2);
    startGame(room, players[0], T0);
    // Force the game to an end by making the non-turn player time out repeatedly.
    for (let t = T0; room.game!.status === "playing" && t < T0 + 3_600_000; t += 31_000) {
      players.forEach((p) => (p.lastSeen = t));
      tick(room, t);
    }
    expect(room.game!.status).toBe("ended");
    expect(room.history).toHaveLength(1);
    const rec = room.history![0];
    expect(rec.id).toBe("QWERT-1");
    expect(rec.results.reduce((s, r) => s + r.delta, 0)).toBe(0);
    expect((players[0].points ?? 0) + (players[1].points ?? 0)).toBe(0);
    expect(roomView(room, players[0], T0).history).toHaveLength(1);
  });

  it("spectators see no hands and can send emoji; players too", () => {
    const { room, players } = roomWith(2);
    expect(watchRoom(room, "watcher-token-1", "Xem", T0).ok).toBe(true);
    startGame(room, players[0], T0);
    const v = roomView(room, null, T0);
    expect(v.role).toBe("spectator");
    expect(v.hand).toEqual([]);
    expect(v.spectators).toEqual(["Xem"]);
    expect(react(room, "watcher-token-1", "🔥", T0).ok).toBe(true);
    expect(react(room, "token-0-features", "👍", T0).ok).toBe(true);
    expect(react(room, "watcher-token-1", "not-an-emoji", T0).ok).toBe(false);
    expect(react(room, "stranger-token-9", "👍", T0).ok).toBe(false);
    expect(roomView(room, players[1], T0).reactions.map((r) => r.emoji)).toEqual(["🔥", "👍"]);
    // Reactions and silent spectators expire.
    players.forEach((p) => (p.lastSeen = T0 + PRESENCE_TIMEOUT_MS));
    tick(room, T0 + Math.max(REACTION_TTL_MS, PRESENCE_TIMEOUT_MS) + 1);
    expect(room.reactions).toEqual([]);
    expect(room.spectators).toEqual([]);
  });

  it("room summary hides hands and tokens", () => {
    const { room, players } = roomWith(2);
    startGame(room, players[0], T0);
    const s = roomSummary(room, T0);
    expect(s.players.map((p) => p.name)).toEqual(["P0", "P1"]);
    expect(JSON.stringify(s)).not.toContain("token-");
  });
});

describe("leaderboard + room index (store via hub)", () => {
  it("records each finished game once, keyed by name", async () => {
    const store = createMemoryRoomStore();
    const hub = createRoomHub(store);
    const code = await hub.createRoom();
    await hub.mutate(code, (room, now) => {
      joinRoom(room, "tok-lb-aaaaaaa", "An", now, id);
      joinRoom(room, "tok-lb-bbbbbbb", "Bình", now, id);
    });
    // Drive the game to its end through tick() with everyone "online" but idle.
    for (let i = 0; i < 400; i++) {
      const done = await hub.mutate(code, (room, now) => {
        const t = now + i * 31_000;
        room.seats.forEach((p) => p && (p.lastSeen = t));
        if (!room.game) startGame(room, room.seats.find((p) => p && p.id === room.hostId)!, t);
        else tick(room, t);
        return room.game?.status === "ended";
      });
      if (done.found && done.result) break;
    }
    const board = await store.leaderboard(10);
    expect(board.map((r) => r.name).sort()).toEqual(["An", "Bình"]);
    expect(board.reduce((s, r) => s + r.points, 0)).toBe(0);
    expect(board.every((r) => r.games === 1)).toBe(true);

    const rooms = await store.recentRooms(10);
    expect(rooms.map((r) => r.code)).toContain(code);
  });
});
