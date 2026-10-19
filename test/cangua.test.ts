import { describe, expect, it } from "vitest";
import { FINAL, GATE, HOME_CELLS, STABLE, TRACK, TRACK_LEN, cellOf, trackIndex } from "../src/cangua/board";
import {
  ABSENT_MS,
  type CNRules,
  type CNState,
  DEFAULT_RULES,
  forfeitPlayer,
  legalMoves,
  moveHorse,
  newCNGame,
  rollDie,
  tickGame,
} from "../src/cangua/game";
import { cnCommand, cnSummary, cnView, joinCN, leaveCN, newCNRoom, tickCN } from "../src/cangua/room";

const names = (id: string) => id;
const never = () => false;
const T = 1_000_000;

/** A random() that makes the die show these values in order. */
const dice = (...values: number[]) => {
  let i = 0;
  return () => (values[i++ % values.length] - 1) / 6 + 0.01;
};

function game(players = ["a", "b"], rules: Partial<CNRules> = {}): CNState {
  const s = newCNGame(players, T, { rules: { ...DEFAULT_RULES, ...rules } }, () => 0);
  // Fixed order: the first player is red (0); with 2 players the second is yellow (2).
  s.players = players.slice();
  const colors = players.length === 2 ? [0, 2] : [0, 1, 2, 3];
  players.forEach((p, i) => (s.colors[p] = colors[i]));
  s.turn = players[0];
  return s;
}

const roll = (s: CNState, id: string, v: number) => rollDie(s, id, T, names, dice(v));

describe("board", () => {
  it("has 56 distinct adjacent track squares and 6-step home columns next to the gates", () => {
    expect(TRACK).toHaveLength(TRACK_LEN);
    expect(new Set(TRACK.map(([r, c]) => r * 15 + c)).size).toBe(TRACK_LEN);
    for (let i = 0; i < TRACK_LEN; i++) {
      const [r1, c1] = TRACK[i];
      const [r2, c2] = TRACK[(i + 1) % TRACK_LEN];
      expect(Math.abs(r1 - r2) + Math.abs(c1 - c2)).toBe(1);
    }
    for (let color = 0; color < 4; color++) {
      const [gr, gc] = TRACK[trackIndex(color, GATE)];
      const [hr, hc] = HOME_CELLS[color][0];
      expect(Math.abs(gr - hr) + Math.abs(gc - hc)).toBe(1);
      expect(cellOf(color, FINAL, 0)).toEqual(HOME_CELLS[color][5]);
    }
  });
});

describe("leaving the stable", () => {
  it("needs a 6 (or a 1 with the setting), and a 6 rolls again", () => {
    const s = game();
    roll(s, "a", 3);
    expect(s.turn).toBe("b"); // no legal move → passes
    roll(s, "b", 1);
    expect(s.turn).toBe("a");
    roll(s, "a", 6);
    expect(s.phase).toBe("move");
    expect(s.legal).toEqual([0, 1, 2, 3]);
    expect(moveHorse(s, "a", 0, T, names).ok).toBe(true);
    expect(s.horses.a[0]).toBe(0);
    expect(s.turn).toBe("a"); // extra roll after a 6
    expect(s.phase).toBe("roll");
  });

  it("exits on a 1 when allowed", () => {
    const s = game(["a", "b"], { exitOn1: true });
    roll(s, "a", 1);
    expect(s.legal).toEqual([0, 1, 2, 3]);
    moveHorse(s, "a", 2, T, names);
    expect(s.horses.a[2]).toBe(0);
    expect(s.turn).toBe("b"); // 1 gives no extra roll
  });

  it("cannot exit onto your own horse; kicks an opponent on the start square", () => {
    const s = game();
    s.horses.a = [0, STABLE, STABLE, STABLE];
    expect(legalMoves(s, "a", 6)).toEqual([0]);
    // b's horse sits on a's start square (track 0 = b progress 28).
    s.horses.a = [STABLE, STABLE, STABLE, STABLE];
    s.horses.b = [28, STABLE, STABLE, STABLE];
    roll(s, "a", 6);
    moveHorse(s, "a", 0, T, names);
    expect(s.horses.b[0]).toBe(STABLE);
    expect(s.last?.kicked).toEqual({ player: "b", horse: 0, from: 28 });
  });
});

describe("movement and blocking", () => {
  it("moves exactly the die along the track", () => {
    const s = game();
    s.horses.a = [10, STABLE, STABLE, STABLE];
    roll(s, "a", 4);
    expect(s.legal).toEqual([0]);
    moveHorse(s, "a", 0, T, names);
    expect(s.horses.a[0]).toBe(14);
    expect(s.turn).toBe("b");
  });

  it("cannot jump over any horse when noJump is on, may when off", () => {
    const s = game();
    s.horses.a = [10, 12, STABLE, STABLE];
    expect(legalMoves(s, "a", 4)).toEqual([1]); // 10 → 14 passes 12
    s.horses.a = [10, STABLE, STABLE, STABLE];
    s.horses.b = [12 + 56 - 28, STABLE, STABLE, STABLE]; // b on track 12
    expect(legalMoves(s, "a", 4)).toEqual([]);
    expect(legalMoves(s, "a", 2)).toEqual([0]); // landing on it is fine (kick)
    const free = game(["a", "b"], { noJump: false });
    free.horses.a = [10, 12, STABLE, STABLE];
    expect(legalMoves(free, "a", 4)).toEqual([0, 1]);
  });

  it("cannot land on your own horse", () => {
    const s = game(["a", "b"], { noJump: false });
    s.horses.a = [10, 14, STABLE, STABLE];
    expect(legalMoves(s, "a", 4)).toEqual([1]);
  });

  it("kicks an opponent back to its stable", () => {
    const s = game();
    s.horses.a = [10, STABLE, STABLE, STABLE];
    s.horses.b = [41, STABLE, STABLE, STABLE]; // track (28 + 41) % 56 = 13
    roll(s, "a", 3);
    moveHorse(s, "a", 0, T, names);
    expect(s.horses.a[0]).toBe(13);
    expect(s.horses.b[0]).toBe(STABLE);
    expect(s.log.at(-1)?.text).toMatch(/đá/);
  });

  it("wraps around the track for other colours", () => {
    const s = game();
    s.turn = "b";
    s.horses.b = [26, STABLE, STABLE, STABLE];
    roll(s, "b", 5);
    moveHorse(s, "b", 0, T, names);
    expect(trackIndex(2, s.horses.b[0])).toBe(3);
  });
});

describe("extra rolls", () => {
  it("three 6s in a row lose the turn when the setting is on", () => {
    const s = game();
    s.horses.a = [20, STABLE, STABLE, STABLE];
    roll(s, "a", 6);
    moveHorse(s, "a", 0, T, names);
    roll(s, "a", 6);
    moveHorse(s, "a", 0, T, names);
    expect(s.horses.a[0]).toBe(32);
    roll(s, "a", 6);
    expect(s.turn).toBe("b");
    expect(s.horses.a[0]).toBe(32);
  });

  it("keeps rolling 6s when the setting is off", () => {
    const s = game(["a", "b"], { threeSixes: false });
    s.horses.a = [0, STABLE, STABLE, STABLE];
    for (let i = 0; i < 3; i++) {
      roll(s, "a", 6);
      moveHorse(s, "a", 0, T, names);
    }
    expect(s.horses.a[0]).toBe(18);
    expect(s.turn).toBe("a");
  });

  it("a 6 with no legal move still rolls again", () => {
    const s = game();
    // Steps 1-3 can't climb with a 6; the horse on the start square is blocked by b on track 3.
    s.horses.a = [GATE + 1, GATE + 2, GATE + 3, 0];
    s.horses.b = [31, STABLE, STABLE, STABLE];
    expect(legalMoves(s, "a", 6)).toEqual([]);
    roll(s, "a", 6);
    expect(s.turn).toBe("a");
    expect(s.phase).toBe("roll");
    expect(s.sixes).toBe(1);
  });
});

describe("home column", () => {
  it("ladder rule: enter step 1 by exact count, then step n → n+1 needs n+1", () => {
    const s = game();
    s.horses.a = [GATE - 2, STABLE, STABLE, STABLE];
    expect(legalMoves(s, "a", 2)).toEqual([0]); // 53 → gate
    expect(legalMoves(s, "a", 4)).toEqual([]); // overshoots step 1
    expect(legalMoves(s, "a", 3)).toEqual([0]); // → step 1
    s.horses.a = [GATE + 1, STABLE, STABLE, STABLE]; // step 1
    expect(legalMoves(s, "a", 1)).toEqual([]);
    expect(legalMoves(s, "a", 3)).toEqual([]);
    expect(legalMoves(s, "a", 2)).toEqual([0]);
    roll(s, "a", 2);
    moveHorse(s, "a", 0, T, names);
    expect(s.horses.a[0]).toBe(GATE + 2);
    s.horses.a = [FINAL, STABLE, STABLE, STABLE];
    expect([1, 2, 3, 4, 5, 6].flatMap((d) => legalMoves(s, "a", d)).includes(0)).toBe(false);
  });

  it("ladder rule: a step must be free", () => {
    const s = game();
    s.horses.a = [GATE + 1, GATE + 2, STABLE, STABLE];
    expect(legalMoves(s, "a", 2)).toEqual([]);
    expect(legalMoves(s, "a", 3)).toEqual([1]);
  });

  it("plain rule: exact count anywhere into the column", () => {
    const s = game(["a", "b"], { ladder: false });
    s.horses.a = [GATE - 1, STABLE, STABLE, STABLE];
    expect(legalMoves(s, "a", 5)).toEqual([0]); // → step 4
    expect(legalMoves(s, "a", 6)).toContain(0); // → step 5
    s.horses.a = [GATE + 3, STABLE, STABLE, STABLE];
    expect(legalMoves(s, "a", 3)).toEqual([0]);
    expect(legalMoves(s, "a", 4)).toEqual([]);
  });
});

describe("winning and ranking", () => {
  it("first player with all horses home wins; the rest ranked by progress", () => {
    const s = game(["a", "b", "c"]);
    s.horses.a = [FINAL, FINAL - 1, FINAL - 2, GATE + 2];
    s.horses.b = [10, 20, STABLE, STABLE];
    s.horses.c = [40, 2, STABLE, STABLE];
    roll(s, "a", 3);
    moveHorse(s, "a", 3, T, names);
    expect(s.status).toBe("ended");
    expect(s.finished).toEqual(["a", "c", "b"]);
  });

  it("all 4 horses in the column is not enough: they must fill steps 3–6", () => {
    const s = game(["a", "b"]);
    s.horses.a = [FINAL, FINAL - 1, FINAL - 2, GATE];
    roll(s, "a", 1);
    moveHorse(s, "a", 3, T, names); // → step 1
    expect(s.status).toBe("playing");
    expect(s.done).toEqual([]);
  });

  it("rankAll keeps playing until one player is left", () => {
    const s = game(["a", "b", "c"], { rankAll: true });
    s.horses.a = [FINAL, FINAL - 1, FINAL - 2, GATE + 2]; // step 2 → 3 fills steps 3–6
    roll(s, "a", 3);
    moveHorse(s, "a", 3, T, names);
    expect(s.status).toBe("playing");
    expect(s.done).toEqual(["a"]);
    expect(s.turn).toBe("b");
    roll(s, "b", 2);
    expect(s.turn).toBe("c");
    roll(s, "c", 2);
    expect(s.turn).toBe("b"); // a is skipped
    s.horses.b = [FINAL, FINAL - 1, FINAL - 2, GATE + 2];
    roll(s, "b", 3);
    moveHorse(s, "b", 3, T, names);
    expect(s.status).toBe("ended");
    expect(s.finished).toEqual(["a", "b", "c"]);
  });

  it("a forfeited player ranks last and the game ends with one left", () => {
    const s = game(["a", "b"]);
    forfeitPlayer(s, "a", T, names);
    expect(s.status).toBe("ended");
    expect(s.finished).toEqual(["b", "a"]);
  });
});

describe("timers", () => {
  it("auto-rolls and auto-moves on timeout, preferring a kick", () => {
    const s = game();
    s.horses.a = [10, 30, STABLE, STABLE];
    s.horses.b = [41, STABLE, STABLE, STABLE]; // track 13
    expect(tickGame(s, s.deadline! + 1, names, never, dice(3))).toBe(true);
    expect(s.horses.a).toEqual([13, 30, STABLE, STABLE]);
    expect(s.horses.b[0]).toBe(STABLE);
    expect(s.turn).toBe("b");
  });

  it("prefers entering home, then the furthest horse", () => {
    const s = game();
    s.horses.a = [GATE - 1, 30, 5, STABLE];
    tickGame(s, s.deadline! + 1, names, never, dice(2));
    expect(s.horses.a[0]).toBe(GATE + 1);
    const t = game();
    t.horses.a = [5, 30, STABLE, STABLE];
    tickGame(t, t.deadline! + 1, names, never, dice(2));
    expect(t.horses.a).toEqual([5, 32, STABLE, STABLE]);
  });

  it("moves for a player who already rolled, and plays fast for an absent one", () => {
    const s = game();
    s.horses.a = [5, STABLE, STABLE, STABLE];
    roll(s, "a", 2);
    expect(s.phase).toBe("move");
    expect(tickGame(s, T + 1, names, never, dice(1))).toBe(false);
    tickGame(s, s.deadline! + 1, names, never, dice(1));
    expect(s.horses.a[0]).toBe(7);
    expect(s.turn).toBe("b");
    expect(tickGame(s, s.phaseAt + ABSENT_MS + 1, names, (id) => id === "b", dice(3))).toBe(true);
    expect(s.turn).toBe("a");
  });
});

describe("room flow", () => {
  function room() {
    let n = 0;
    const r = newCNRoom("HORSE");
    joinCN(r, "token-aaaa", "An", T, () => `p${++n}`);
    joinCN(r, "token-bbbb", "Bình", T, () => `p${++n}`);
    return r;
  }

  it("host changes settings, starts, players roll and move, a win is scored", () => {
    const r = room();
    expect(cnCommand(r, "token-bbbb", { type: "settings", turnSeconds: 20 }, T).ok).toBe(false);
    expect(cnCommand(r, "token-aaaa", { type: "settings", turnSeconds: 12 }, T).ok).toBe(false);
    expect(
      cnCommand(r, "token-aaaa", { type: "settings", turnSeconds: 20, exitOn1: true, noJump: false, first: 3, second: 1 }, T).ok,
    ).toBe(true);
    expect(cnCommand(r, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    const g = r.current!;
    expect(g.deadline).toBe(T + 20_000);
    expect(g.rules.exitOn1).toBe(true);
    expect(g.rules.noJump).toBe(false);
    const tok = (id: string) => r.seats.find((p) => p?.id === id)!.token;
    const other = g.players.find((p) => p !== g.turn)!;
    expect(cnCommand(r, tok(other), { type: "roll" }, T).ok).toBe(false);
    const me = g.turn!;
    g.horses[me] = [FINAL, FINAL - 1, FINAL - 2, GATE + 2];
    expect(cnCommand(r, tok(me), { type: "roll" }, T, dice(3)).ok).toBe(true);
    expect(cnCommand(r, tok(me), { type: "move", horse: 7 }, T).ok).toBe(false);
    expect(cnCommand(r, tok(me), { type: "move", horse: 3 }, T).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(r.history?.[0].results.map((x) => [x.id, x.delta])).toEqual([
      [me, 3],
      [other, -3],
    ]);
    const view = cnView(r, r.seats[0], T);
    expect(view.game).toBe("cangua");
    expect(view.current?.players.map((p) => p.horses.length)).toEqual([4, 4]);
    expect(cnSummary(r, T)).toMatchObject({ code: "HORSE", status: "waiting", games: 1 });
  });

  it("auto-play plays an online player's turn after the short pace, and only their own flag counts", () => {
    const r = room();
    cnCommand(r, "token-aaaa", { type: "start" }, T);
    const g = r.current!;
    const turnTok = r.seats.find((p) => p?.id === g.turn)!.token;
    const otherTok = r.seats.find((p) => p?.id !== g.turn)!.token;
    const first = g.turn!;
    // Not on: nothing happens before the deadline.
    expect(tickCN(r, T + 10_000, dice(2))).toBe(false);
    expect(cnCommand(r, turnTok, { type: "auto", on: true }, T + 1, dice(2)).ok).toBe(true);
    expect(cnView(r, r.seats.find((p) => p?.id === first)!, T).auto).toBe(true);
    expect(cnView(r, r.seats.find((p) => p?.id !== first)!, T).auto).toBeUndefined();
    // Too early: the pace is ABSENT_MS after the phase began.
    expect(tickCN(r, g.phaseAt + 100, dice(2))).toBe(false);
    expect(tickCN(r, g.phaseAt + ABSENT_MS + 1, dice(2))).toBe(true);
    expect(g.roll?.player).toBe(first);
    // The other player has not switched it on, so their turn is not played for them.
    cnCommand(r, otherTok, { type: "auto", on: false }, T + 2, dice(2));
    // Switching off stops it.
    cnCommand(r, turnTok, { type: "auto", on: false }, T + 3, dice(2));
    expect(cnView(r, r.seats.find((p) => p?.id === first)!, T).auto).toBeUndefined();
  });

  it("an offline player is auto-played and can be kicked", () => {
    const r = room();
    cnCommand(r, "token-aaaa", { type: "start" }, T);
    leaveCN(r, "token-bbbb", T);
    const g = r.current!;
    const later = T + 30_000;
    expect(tickCN(r, later, dice(2))).toBe(true);
    expect(cnCommand(r, "token-aaaa", { type: "kick", playerId: "p2" }, later).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(g.finished).toEqual(["p1", "p2"]);
  });
});
