import { describe, expect, it } from "vitest";
import { type OQState, forfeitPlayer, legalMoves, makeMove, newOQGame, scoreOf } from "../src/oanquan/game";
import { joinOQ, newOQRoom, oqCommand, oqSummary, oqView } from "../src/oanquan/room";

const names = (id: string) => id;
const T = 1_000_000;

/** An n-player game, ids a, b, c, d in seating order, "a" to move. Ring = 6n squares. */
function gameN(n: number, opts: Partial<{ quanValue: number; quanNon: boolean }> = {}): OQState {
  const ids = ["a", "b", "c", "d"].slice(0, n);
  const s = newOQGame(ids, T, { quanValue: 10, quanNon: true, ...opts }, () => 0.99);
  s.players = ids;
  s.turn = "a";
  return s;
}
const total = (s: OQState) => s.dan.reduce((t, x) => t + x, 0) + Object.values(s.captured).reduce((t, c) => t + c.dan, 0);
const blank = (n: number) => Array.from({ length: 6 * n }, () => 0);
function board(s: OQState, dan: number[], quan: boolean[] = s.quan) {
  s.dan = dan.slice();
  s.quan = quan.slice();
}
const sownCells = (s: OQState) => s.lastMove!.steps.filter((x) => x.k === "sow").map((x) => (x as { cell: number }).cell);

describe("3 and 4 players: board and sowing", () => {
  it("builds a ring of 6 squares per player with one quan each", () => {
    for (const n of [3, 4]) {
      const s = gameN(n);
      expect(s.dan).toHaveLength(6 * n);
      expect(s.quan).toEqual(Array(n).fill(true));
      expect(total(s)).toBe(25 * n);
      expect(s.dan.filter((x, c) => c % 6 === 0 && x !== 0)).toHaveLength(0);
    }
  });

  it("sows and relays across segment boundaries (3 players, both directions)", () => {
    const s = gameN(3);
    expect(makeMove(s, "a", 5, 1, T, names).ok).toBe(true);
    const sown = sownCells(s);
    // 5 → 6 (b's quan) … 10, relays from 11 over c's quan 12 … 16, relays from 17 over a's quan 0 … 4.
    expect(sown.slice(0, 5)).toEqual([6, 7, 8, 9, 10]);
    expect(sown).toContain(12);
    expect(sown).toContain(0);
    expect(total(s)).toBe(75);
    expect(s.turn).toBe("b");

    const t = gameN(3);
    expect(makeMove(t, "a", 1, -1, T, names).ok).toBe(true);
    expect(sownCells(t).slice(0, 5)).toEqual([0, 17, 16, 15, 14]);
    expect(total(t)).toBe(75);
  });

  it("only lets a player pick from their own segment", () => {
    const s = gameN(4);
    expect(makeMove(s, "a", 7, 1, T, names).ok).toBe(false);
    expect(makeMove(s, "a", 6, 1, T, names).ok).toBe(false); // ô quan
    expect(makeMove(s, "a", 25, 1, T, names).ok).toBe(false); // off the ring
    expect(legalMoves(s, "a")).toHaveLength(10);
    expect(makeMove(s, "a", 5, 1, T, names).ok).toBe(true);
    expect(s.turn).toBe("b");
    expect(makeMove(s, "b", 19, 1, T, names).ok).toBe(false); // d's square
    expect(makeMove(s, "b", 7, -1, T, names).ok).toBe(true);
    expect(s.turn).toBe("c");
  });

  it("cycles the turn a → b → c → d → a", () => {
    const s = gameN(4);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(s.turn!);
      const m = legalMoves(s, s.turn!)[0];
      makeMove(s, s.turn!, m.cell, m.dir, T, names);
    }
    expect(seen).toEqual(["a", "b", "c", "d", "a"]);
  });

  it("captures another player's ô quan with its dân", () => {
    const s = gameN(3);
    board(s, blank(3), [true, true, true]);
    s.dan[5] = 5;
    s.dan[12] = 6; // c's quan holds 6 dân; 11 is empty
    makeMove(s, "a", 5, 1, T, names);
    expect(s.quan).toEqual([true, true, false]);
    expect(s.dan[12]).toBe(0);
    expect(s.captured.a).toEqual({ dan: 6, quan: 1 });
    expect(s.lastMove!.steps.at(-1)).toEqual({ k: "capture", cell: 12, dan: 6, quan: true });
  });

  it("quan non protects another player's quan below 5 dân", () => {
    const s = gameN(3);
    board(s, blank(3), [true, true, true]);
    s.dan[5] = 5;
    s.dan[12] = 4;
    makeMove(s, "a", 5, 1, T, names);
    expect(s.quan[2]).toBe(true);
    expect(s.captured.a).toEqual({ dan: 0, quan: 0 });
  });

  it("chain-captures across the ring (4 players)", () => {
    const s = gameN(4);
    board(s, blank(4), [false, true, true, true]);
    s.dan[22] = 1; // d: sow 23, 0 is empty, 1 (full) captured, 2 empty, 3 (full) captured
    s.dan[1] = 2;
    s.dan[3] = 4;
    s.turn = "d";
    makeMove(s, "d", 22, 1, T, names);
    const caps = s.lastMove!.steps.filter((x) => x.k === "capture") as { dan: number }[];
    expect(caps.map((x) => x.dan)).toEqual([2, 4]);
  });
});

describe("3 and 4 players: rải quân, borrowing and elimination", () => {
  /** b makes a harmless move so that c begins their turn with an empty row. */
  function cToReseed() {
    const s = gameN(3);
    board(s, blank(3));
    s.dan[7] = 1;
    s.turn = "b";
    return s;
  }

  it("uses your own pile first", () => {
    const s = cToReseed();
    s.captured.c = { dan: 7, quan: 0 };
    makeMove(s, "b", 7, 1, T, names);
    expect(s.turn).toBe("c");
    expect(s.dan.slice(13, 18)).toEqual([1, 1, 1, 1, 1]);
    expect(s.captured.c.dan).toBe(2);
    expect(s.borrowed.c).toBe(0);
  });

  it("borrows from the next player in turn order (a after c), then the one after (b)", () => {
    const s = cToReseed();
    s.captured = { a: { dan: 1, quan: 0 }, b: { dan: 10, quan: 0 }, c: { dan: 2, quan: 0 } };
    makeMove(s, "b", 7, 1, T, names);
    expect(s.dan.slice(13, 18)).toEqual([1, 1, 1, 1, 1]);
    expect(s.captured).toEqual({ a: { dan: 0, quan: 0 }, b: { dan: 8, quan: 0 }, c: { dan: 0, quan: 0 } });
    expect(s.debts.c).toEqual({ a: 1, b: 2 });
    expect(s.borrowed.c).toBe(3);
    expect(s.lastReseed).toMatchObject({ player: "c", borrowed: 3, lenders: [{ id: "a", n: 1 }, { id: "b", n: 2 }] });
    expect(scoreOf(s, "c")).toBe(-3);
    expect(scoreOf(s, "a")).toBe(1);
    expect(scoreOf(s, "b")).toBe(8 + 2);
    expect(s.turn).toBe("c");
  });

  it("eliminates a player nobody can lend to; the game goes on without them", () => {
    const s = cToReseed();
    s.captured = { a: { dan: 1, quan: 0 }, b: { dan: 2, quan: 0 }, c: { dan: 1, quan: 0 } };
    s.dan[2] = 3; // a still has dân on their row
    makeMove(s, "b", 7, 1, T, names);
    expect(s.status).toBe("playing");
    expect(s.out).toEqual(["c"]);
    expect(s.turn).toBe("a");
    expect(s.dan.slice(13, 18)).toEqual([0, 0, 0, 0, 0]);
    // c is skipped from now on.
    makeMove(s, "a", 2, 1, T, names);
    expect(s.turn).toBe("b");
    makeMove(s, "b", legalMoves(s, "b")[0].cell, 1, T, names);
    expect(s.turn).toBe("a");
  });

  it("stones left on an eliminated player's cells can be captured", () => {
    const s = gameN(3);
    board(s, blank(3), [false, false, true]);
    s.out = ["c"];
    s.dan[4] = 1; // a sows 5; 6 is empty (quan gone); 7 is full → captured
    s.dan[7] = 3;
    s.dan[8] = 2; // keeps b's row non-empty
    s.dan[15] = 2; // c's leftovers
    makeMove(s, "a", 4, 1, T, names);
    expect(s.captured.a.dan).toBe(3);
    expect(s.turn).toBe("b");
  });

  it("ends when only one player is left (stuck): the survivor wins", () => {
    const s = cToReseed();
    s.captured = { a: { dan: 0, quan: 0 }, b: { dan: 1, quan: 0 }, c: { dan: 1, quan: 0 } };
    makeMove(s, "b", 7, 1, T, names);
    // c can't reseed (out); a can't either (b has 1 dân, c is out) → out; b alone wins.
    expect(s.status).toBe("ended");
    expect(s.endReason).toBe("stuck");
    expect(s.winner).toBe("b");
    expect(s.finished).toEqual(["b", "a", "c"]);
    expect(s.ranks).toEqual({ b: 0, a: 1, c: 2 });
  });

  it("forfeit: with three players the game continues; the turn passes on", () => {
    const s = gameN(3);
    expect(forfeitPlayer(s, "a", T, names).ok).toBe(true);
    expect(s.status).toBe("playing");
    expect(s.turn).toBe("b");
    expect(forfeitPlayer(s, "c", T, names).ok).toBe(true);
    expect(s.status).toBe("ended");
    expect(s.winner).toBe("b");
    expect(s.endReason).toBe("forfeit");
    expect(s.finished).toEqual(["b", "c", "a"]);
  });
});

describe("3 and 4 players: end of the game and ranking", () => {
  /** All quan gone; a's only stone is on square 3 and its sowing ends the game. */
  function endBoard(n: number) {
    const s = gameN(n, { quanValue: 10 });
    board(s, blank(n), Array(n).fill(false));
    s.dan[3] = 1;
    return s;
  }

  it("3 players: everyone collects their row; ties share a rank", () => {
    const s = endBoard(3);
    s.dan[8] = 2;
    s.dan[14] = 1;
    s.captured = { a: { dan: 10, quan: 1 }, b: { dan: 9, quan: 1 }, c: { dan: 4, quan: 0 } };
    makeMove(s, "a", 3, 1, T, names);
    expect(s.status).toBe("ended");
    expect(s.endReason).toBe("board");
    expect(s.dan.every((x) => x === 0)).toBe(true);
    // a 10 + 1 + 10 = 21 · b 9 + 2 + 10 = 21 · c 4 + 1 = 5
    expect([scoreOf(s, "a"), scoreOf(s, "b"), scoreOf(s, "c")]).toEqual([21, 21, 5]);
    expect(s.ranks).toEqual({ a: 0, b: 0, c: 2 });
    expect(s.winner).toBeNull();
    expect(s.finished[2]).toBe("c");
  });

  it("4 players: ranks by score; debts go to the right lender", () => {
    const s = endBoard(4);
    s.dan[9] = 4;
    s.dan[16] = 1;
    s.dan[20] = 3;
    s.captured = { a: { dan: 5, quan: 0 }, b: { dan: 2, quan: 1 }, c: { dan: 6, quan: 0 }, d: { dan: 0, quan: 1 } };
    s.borrowed = { a: 0, b: 0, c: 4, d: 0 };
    s.debts = { a: {}, b: {}, c: { d: 4 }, d: {} };
    makeMove(s, "a", 3, 1, T, names);
    // a 5+1=6 · b 2+4+10=16 · c 6+1−4=3 · d 3+10+4=17
    expect([scoreOf(s, "a"), scoreOf(s, "b"), scoreOf(s, "c"), scoreOf(s, "d")]).toEqual([6, 16, 3, 17]);
    expect(s.finished).toEqual(["d", "b", "a", "c"]);
    expect(s.ranks).toEqual({ d: 0, b: 1, a: 2, c: 3 });
    expect(s.winner).toBe("d");
  });

  it("an eliminated player's leftover row is not collected and they rank last", () => {
    const s = endBoard(3);
    s.out = ["c"];
    s.dan[15] = 7;
    s.captured = { a: { dan: 0, quan: 0 }, b: { dan: 0, quan: 0 }, c: { dan: 30, quan: 0 } };
    makeMove(s, "a", 3, 1, T, names);
    expect(s.status).toBe("ended");
    expect(s.dan[15]).toBe(7);
    expect(s.finished.at(-1)).toBe("c");
    expect(s.ranks.c).toBe(2);
    expect(s.winner).toBe("a");
  });

  it("random 3- and 4-player games always end and keep the dân", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let g = 0; g < 40; g++) {
      const n = 3 + (g % 2);
      const s = newOQGame(["a", "b", "c", "d"].slice(0, n), T, { quanValue: 10, quanNon: g % 3 !== 0 }, rnd);
      let guard = 0;
      while (s.status === "playing" && guard++ < 2000) {
        const m = legalMoves(s, s.turn!);
        const pick = m[Math.floor(rnd() * m.length)];
        expect(makeMove(s, s.turn!, pick.cell, pick.dir, T, names).ok).toBe(true);
        if (s.status === "playing") expect(total(s)).toBe(25 * n);
      }
      expect(s.status).toBe("ended");
      expect(s.finished).toHaveLength(n);
      expect(Object.keys(s.ranks)).toHaveLength(n);
    }
  });
});

describe("3 and 4 players: room", () => {
  function roomN(n: number) {
    let k = 0;
    const room = newOQRoom("OAQ03");
    for (const t of ["aaaa", "bbbb", "cccc", "dddd"].slice(0, n)) joinOQ(room, `token-${t}`, t, T, () => `p${++k}`, `token-${t}`);
    return room;
  }

  it("seats up to 4 players and refuses the 5th; needs at least 2", () => {
    const room = roomN(4);
    expect(room.seats).toHaveLength(4);
    expect(joinOQ(room, "token-eeee", "e", T, () => "p5", "token-eeee").ok).toBe(false);
    const solo = roomN(1);
    expect(oqCommand(solo, "token-aaaa", { type: "start" }, T).ok).toBe(false);
  });

  it("plays a 3-player game: view, turn order, ranking points", () => {
    const room = roomN(3);
    expect(oqCommand(room, "token-aaaa", { type: "settings", first: 3, second: 1 }, T).ok).toBe(true);
    expect(oqCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    const g = room.current!;
    expect(g.players).toHaveLength(3);
    const view = oqView(room, room.seats[0], T);
    expect(view.current!.dan).toHaveLength(18);
    expect(view.current!.quan).toEqual([true, true, true]);
    expect(view.current!.players.map((p) => p.side)).toEqual([0, 1, 2]);
    expect(oqSummary(room, T).players).toHaveLength(3);

    const tokenOf = (id: string) => room.seats.find((p) => p?.id === id)!.token;
    const first = g.turn!;
    const nextId = g.players[(g.players.indexOf(first) + 1) % 3];
    const m = legalMoves(g, first)[0];
    expect(oqCommand(room, tokenOf(nextId), { type: "move", cell: m.cell, dir: m.dir }, T).ok).toBe(false);
    expect(oqCommand(room, tokenOf(first), { type: "move", cell: m.cell, dir: m.dir }, T).ok).toBe(true);
    expect(g.turn).toBe(nextId);

    // Force the end: scores 30 > 20 > 10 in seating order.
    const [x, y, z] = g.players;
    g.dan = blank(3);
    g.quan = [false, false, false];
    const mover = g.turn!;
    const cell = g.players.indexOf(mover) * 6 + 1;
    g.dan[cell] = 1;
    g.captured = { [x]: { dan: 30, quan: 0 }, [y]: { dan: 20, quan: 0 }, [z]: { dan: 10, quan: 0 } };
    expect(oqCommand(room, tokenOf(mover), { type: "move", cell, dir: 1 }, T).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(room.history).toHaveLength(1);
    const res = room.history![0].results;
    expect(res.map((r) => r.rank)).toEqual([0, 1, 2]);
    expect(res.map((r) => r.delta)).toEqual([3, 1, -4]);
    expect(room.seats.reduce((t, p) => t + (p?.points ?? 0), 0)).toBe(0);
    expect(room.seats.filter((p) => p && p.wins === 1)).toHaveLength(1);
  });

  it("kicking an offline player in a 3-player game keeps the game running", () => {
    const room = roomN(3);
    oqCommand(room, "token-aaaa", { type: "start" }, T);
    const g = room.current!;
    const victim = room.seats.find((p) => p?.token === "token-cccc")!;
    for (const p of room.seats) if (p && p !== victim) p.lastSeen = T + 100_000;
    expect(oqCommand(room, "token-aaaa", { type: "kick", playerId: victim.id }, T + 100_000).ok).toBe(true);
    expect(g.status).toBe("playing");
    expect(g.out).toContain(victim.id);
    expect(g.turn).not.toBe(victim.id);
  });
});
