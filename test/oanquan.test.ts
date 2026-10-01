import { describe, expect, it } from "vitest";
import {
  ABSENT_MS,
  type OQState,
  legalMoves,
  makeMove,
  newOQGame,
  scoreOf,
  tickGame,
} from "../src/oanquan/game";
import { joinOQ, newOQRoom, oqCommand, oqSummary, oqView, tickOQ } from "../src/oanquan/room";

const names = (id: string) => id;
const never = () => false;
const T = 1_000_000;

/** A fresh game with "a" on side 0 (squares 1–5) to move. */
function game(opts: Partial<{ quanValue: number; quanNon: boolean }> = {}): OQState {
  const s = newOQGame(["a", "b"], T, { quanValue: 10, quanNon: true, ...opts }, () => 0);
  s.players = ["a", "b"];
  s.turn = "a";
  return s;
}

/** Put a custom board on the table. `dan` is the 12 squares. */
function board(s: OQState, dan: number[], quan: [boolean, boolean] = [true, true]) {
  s.dan = dan.slice();
  s.quan = quan.slice();
}

const total = (s: OQState) =>
  s.dan.reduce((a, b) => a + b, 0) + s.players.reduce((t, p) => t + s.captured[p].dan, 0);

describe("setup", () => {
  it("5 dân in every ô dân, a quan on each ô quan", () => {
    const s = newOQGame(["a", "b"], T, { quanValue: 10, quanNon: true });
    expect(s.dan).toEqual([0, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5]);
    expect(s.quan).toEqual([true, true]);
    expect(s.players).toHaveLength(2);
    expect(s.players).toContain(s.turn);
    expect(s.deadline).toBe(T + 30_000);
  });

  it("only your own non-empty ô dân, in either direction", () => {
    const s = game();
    expect(legalMoves(s, "a")).toHaveLength(10);
    expect(makeMove(s, "a", 7, 1, T, names).ok).toBe(false); // b's square
    expect(makeMove(s, "a", 0, 1, T, names).ok).toBe(false); // ô quan
    expect(makeMove(s, "a", 1, 2 as never, T, names).ok).toBe(false);
    expect(makeMove(s, "b", 7, 1, T, names)).toEqual({ ok: false, error: "Chưa đến lượt bạn" });
    s.dan[3] = 0;
    expect(makeMove(s, "a", 3, 1, T, names).ok).toBe(false);
  });
});

describe("sowing", () => {
  it("sows one by one, keeps sowing from the next ô dân and captures after an empty square", () => {
    const s = game();
    // 1 → 2 3 4 5 [6]; next 7 has 5 → sow 8 9 10 11 0; next 1 is empty, 2 has 6 → ăn 6; next 3 not empty → stop.
    expect(makeMove(s, "a", 1, 1, T, names).ok).toBe(true);
    expect(s.dan).toEqual([1, 0, 0, 6, 6, 6, 1, 0, 6, 6, 6, 6]);
    expect(s.captured.a).toEqual({ dan: 6, quan: 0 });
    expect(s.turn).toBe("b");
    expect(total(s)).toBe(50);
    const m = s.lastMove!;
    expect(m.before.dan).toEqual([0, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5]);
    expect(m.steps[0]).toEqual({ k: "pick", cell: 1, n: 5 });
    expect(m.steps.filter((x) => x.k === "sow").map((x) => x.cell)).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 0]);
    expect(m.steps.at(-1)).toEqual({ k: "capture", cell: 2, dan: 6, quan: false });
  });

  it("sows to the left with dir −1, wrapping around the board", () => {
    const s = game();
    board(s, [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1]);
    // 1 ← : 0 (quan), 11 → last at 11; next 10 has 3 → pick, sow 9 8 7; next 6 is a quan with its piece → stop.
    expect(makeMove(s, "a", 1, -1, T, names).ok).toBe(true);
    expect(s.dan).toEqual([1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2]);
    expect(s.captured.a.dan).toBe(0);
  });

  it("stops when the next square is a non-empty ô quan", () => {
    const s = game();
    board(s, [0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1]);
    expect(makeMove(s, "a", 4, 1, T, names).ok).toBe(true);
    expect(s.dan[5]).toBe(1);
    expect(s.captured.a.dan).toBe(0);
    expect(s.quan).toEqual([true, true]);
  });

  it("stops on two empty squares in a row", () => {
    const s = game();
    board(s, [0, 1, 0, 0, 0, 3, 0, 1, 1, 1, 1, 1]);
    expect(makeMove(s, "a", 1, 1, T, names).ok).toBe(true);
    expect(s.dan).toEqual([0, 0, 1, 0, 0, 3, 0, 1, 1, 1, 1, 1]);
    expect(s.captured.a.dan).toBe(0);
  });
});

describe("capturing", () => {
  it("ăn liên tiếp: keeps capturing while empty, full, empty, full… including an ô quan", () => {
    const s = game();
    // 1 → 2; 3 empty, 4 (3) captured; 5 empty, 6 = quan (gone) with 2 dân captured; 7 empty, 8 empty → stop.
    board(s, [0, 1, 0, 0, 3, 0, 2, 0, 0, 1, 1, 1], [true, false]);
    expect(makeMove(s, "a", 1, 1, T, names).ok).toBe(true);
    expect(s.captured.a).toEqual({ dan: 5, quan: 0 });
    expect(s.dan).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
    expect(s.lastMove!.steps.filter((x) => x.k === "capture").map((x) => x.cell)).toEqual([4, 6]);
  });

  it("captures the quan piece together with its dân", () => {
    const s = game();
    // 3 → 4; 5 empty; 6 = quan with 7 dân (≥ 5, not quan non) → ăn quan + 7 dân; next 7 not empty → stop.
    board(s, [0, 0, 0, 1, 0, 0, 7, 1, 1, 1, 1, 1]);
    expect(makeMove(s, "a", 3, 1, T, names).ok).toBe(true);
    expect(s.captured.a).toEqual({ dan: 7, quan: 1 });
    expect(s.quan).toEqual([true, false]);
    expect(s.dan[6]).toBe(0);
    expect(scoreOf(s, "a")).toBe(17);
  });

  it("quan non: an ô quan with its quan and < 5 dân can't be captured", () => {
    const s = game();
    board(s, [0, 0, 0, 1, 0, 0, 3, 1, 1, 1, 1, 1]);
    expect(makeMove(s, "a", 3, 1, T, names).ok).toBe(true);
    expect(s.captured.a).toEqual({ dan: 0, quan: 0 });
    expect(s.quan).toEqual([true, true]);
    expect(s.dan[6]).toBe(3);

    const t = game({ quanNon: false });
    board(t, [0, 0, 0, 1, 0, 0, 3, 1, 1, 1, 1, 1]);
    expect(makeMove(t, "a", 3, 1, T, names).ok).toBe(true);
    expect(t.captured.a).toEqual({ dan: 3, quan: 1 });
  });

  it("an ô quan holding only its quan is not empty (no capture past it)", () => {
    const s = game({ quanNon: false });
    board(s, [0, 0, 0, 0, 1, 0, 0, 2, 1, 1, 1, 1]);
    // 4 → 5; next 6 is the quan (0 dân, piece) → stop, nothing captured.
    expect(makeMove(s, "a", 4, 1, T, names).ok).toBe(true);
    expect(s.captured.a.dan).toBe(0);
    expect(s.quan).toEqual([true, true]);
  });
});

describe("rải quân: reseeding an empty row", () => {
  function emptyRowForB(s: OQState) {
    // a moves 5 → 6 (quan) ... set so that after a's move b's row is empty.
    board(s, [0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0]);
  }

  it("takes 5 dân from your pile to put one in each ô dân", () => {
    const s = game();
    emptyRowForB(s);
    s.captured.b = { dan: 7, quan: 0 };
    expect(makeMove(s, "a", 4, 1, T, names).ok).toBe(true);
    expect(s.turn).toBe("b");
    expect(s.dan.slice(7)).toEqual([1, 1, 1, 1, 1]);
    expect(s.captured.b.dan).toBe(2);
    expect(s.borrowed.b).toBe(0);
    expect(s.lastReseed).toMatchObject({ player: "b", borrowed: 0 });
  });

  it("borrows from the opponent when short; the debt moves at the end", () => {
    const s = game();
    emptyRowForB(s);
    s.captured.a = { dan: 10, quan: 0 };
    s.captured.b = { dan: 3, quan: 0 };
    makeMove(s, "a", 4, 1, T, names);
    expect(s.dan.slice(7)).toEqual([1, 1, 1, 1, 1]);
    expect(s.captured.b.dan).toBe(0);
    expect(s.captured.a.dan).toBe(8);
    expect(s.borrowed.b).toBe(2);
    expect(scoreOf(s, "b")).toBe(-2);
    expect(scoreOf(s, "a")).toBe(10);
  });

  it("loses when there is nothing to reseed with", () => {
    const s = game();
    emptyRowForB(s);
    s.captured.a = { dan: 2, quan: 0 };
    s.captured.b = { dan: 1, quan: 0 };
    makeMove(s, "a", 4, 1, T, names);
    expect(s.status).toBe("ended");
    expect(s.endReason).toBe("stuck");
    expect(s.winner).toBe("a");
    expect(s.finished).toEqual(["a", "b"]);
  });
});

describe("end of the game", () => {
  it("ends when both ô quan are cleared; each side collects its row", () => {
    const s = game({ quanValue: 5 });
    // a: 3 → 4; 5 empty; 6 (quan gone, 2 dân) captured; 7 has 1 → stop. Square 0 is already empty.
    board(s, [0, 0, 4, 1, 0, 0, 2, 1, 2, 0, 0, 3], [false, false]);
    s.captured.a = { dan: 10, quan: 1 };
    s.captured.b = { dan: 12, quan: 1 };
    expect(makeMove(s, "a", 3, 1, T, names).ok).toBe(true);
    expect(s.status).toBe("ended");
    expect(s.endReason).toBe("board");
    // a: 12 captured + 4 + 1 left on 2, 4 = 17 dân + 5 → 22. b: 12 + 6 left on its row = 18 + 5 → 23.
    expect(scoreOf(s, "a")).toBe(22);
    expect(scoreOf(s, "b")).toBe(23);
    expect(s.winner).toBe("b");
    expect(s.finished).toEqual(["b", "a"]);
    expect(s.dan.every((n) => n === 0)).toBe(true);
    expect(s.turn).toBeNull();
  });

  it("can end in a draw", () => {
    // a: 15 + 1 left on square 4 + 10 = 26; b: 16 + 10 = 26.
    const t = game();
    board(t, [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], [false, false]);
    t.captured.a = { dan: 15, quan: 1 };
    t.captured.b = { dan: 16, quan: 1 };
    makeMove(t, "a", 3, 1, T, names);
    expect(scoreOf(t, "a")).toBe(26);
    expect(scoreOf(t, "b")).toBe(26);
    expect(t.winner).toBeNull();
  });
});

describe("timers", () => {
  it("plays a random legal move when the turn times out", () => {
    const s = game();
    expect(tickGame(s, T + 1000, names, never)).toBe(false);
    expect(tickGame(s, T + 30_000, names, never, () => 0)).toBe(true);
    expect(s.turn).toBe("b");
    expect(s.lastMove?.auto).toBe(true);
    expect(s.lastMove?.cell).toBe(1);
    expect(total(s)).toBe(50);
  });

  it("plays for an offline player after a short grace", () => {
    const s = game();
    expect(tickGame(s, T + ABSENT_MS + 1, names, (id) => id === "a")).toBe(true);
    expect(s.turn).toBe("b");
  });

  it("random games always finish and never lose a stone", () => {
    for (let seed = 1; seed <= 60; seed++) {
      let x = seed;
      const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
      const s = newOQGame(["a", "b"], T, { quanValue: 10, quanNon: seed % 2 === 0 }, rnd);
      let now = T;
      for (let i = 0; i < 1000 && s.status === "playing"; i++) {
        now = s.deadline!;
        tickGame(s, now, names, never, rnd);
        const onBoard = s.dan.reduce((a, b) => a + b, 0);
        const piles = s.captured.a.dan + s.captured.b.dan;
        expect(onBoard + piles).toBe(50);
        expect(s.dan.every((n) => n >= 0)).toBe(true);
      }
      expect(s.status).toBe("ended");
    }
  });
});

describe("room", () => {
  function room2() {
    let n = 0;
    const room = newOQRoom("OAQ01");
    joinOQ(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinOQ(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    return room;
  }

  it("2 seats, host settings, start, moves and scoring", () => {
    const room = room2();
    expect(joinOQ(room, "token-cccc", "Chi", T, () => "p3").ok).toBe(false);
    expect(oqCommand(room, "token-bbbb", { type: "settings", quanValue: 5 }, T).ok).toBe(false); // not host
    expect(oqCommand(room, "token-aaaa", { type: "settings", quanValue: 7 }, T).ok).toBe(false);
    expect(oqCommand(room, "token-aaaa", { type: "settings", turnSeconds: 99 }, T).ok).toBe(false);
    expect(
      oqCommand(room, "token-aaaa", { type: "settings", quanValue: 5, quanNon: false, turnSeconds: 15, first: 3, second: 1 }, T).ok,
    ).toBe(true);
    expect(oqCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    const g = room.current!;
    expect(g.quanValue).toBe(5);
    expect(g.quanNon).toBe(false);
    expect(g.deadline).toBe(T + 15_000);
    expect(oqCommand(room, "token-aaaa", { type: "settings", quanValue: 10 }, T).ok).toBe(false); // mid-game

    const tokenOf = (id: string) => room.seats.find((p) => p?.id === id)!.token;
    const mover = g.turn!;
    const other = g.players.find((p) => p !== mover)!;
    const myCell = g.players.indexOf(mover) === 0 ? 1 : 7;
    expect(oqCommand(room, tokenOf(other), { type: "move", cell: myCell, dir: 1 }, T).ok).toBe(false);
    expect(oqCommand(room, tokenOf(mover), { type: "move", cell: myCell, dir: 1 }, T).ok).toBe(true);
    const view = oqView(room, room.seats[0], T);
    expect(view.game).toBe("oanquan");
    expect(view.current!.lastMove!.steps.length).toBeGreaterThan(5);
    expect(view.current!.players.map((p) => p.side)).toEqual([0, 1]);
    expect(oqSummary(room, T).status).toBe("playing");

    // Force an end: the next mover clears the last ô quan.
    const next = g.turn!;
    const side = g.players.indexOf(next);
    const d = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    d[side === 0 ? 3 : 9] = 1;
    g.dan = d;
    g.quan = [false, false];
    g.captured[next] = { dan: 30, quan: 2 };
    g.captured[g.players[1 - side]] = { dan: 19, quan: 0 };
    expect(oqCommand(room, tokenOf(next), { type: "move", cell: side === 0 ? 3 : 9, dir: 1 }, T).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(room.history?.[0].results.map((r) => [r.id, r.delta])).toEqual([
      [next, 3],
      [g.players[1 - side], -3],
    ]);
    const winner = room.seats.find((p) => p?.id === next)!;
    expect(winner.wins).toBe(1);
    expect(winner.points).toBe(3);
  });

  it("a draw scores nothing", () => {
    const room = room2();
    oqCommand(room, "token-aaaa", { type: "start" }, T);
    const g = room.current!;
    const next = g.turn!;
    const side = g.players.indexOf(next);
    const d = Array(12).fill(0);
    d[side === 0 ? 3 : 9] = 1;
    g.dan = d;
    g.quan = [false, false];
    g.captured[next] = { dan: 14, quan: 1 };
    g.captured[g.players[1 - side]] = { dan: 15, quan: 1 };
    const token = room.seats.find((p) => p?.id === next)!.token;
    oqCommand(room, token, { type: "move", cell: side === 0 ? 3 : 9, dir: 1 }, T);
    expect(g.winner).toBeNull();
    expect(room.history?.[0].results.map((r) => r.delta)).toEqual([0, 0]);
    expect(room.seats.every((p) => p!.wins === 0)).toBe(true);
  });

  it("the room tick auto-plays on timeout; kicking an offline player ends the game", () => {
    const room = room2();
    oqCommand(room, "token-aaaa", { type: "start" }, T);
    const g = room.current!;
    const first = g.turn;
    // Keep both players online.
    for (const p of room.seats) p!.lastSeen = T + 30_000;
    expect(tickOQ(room, T + 30_000)).toBe(true);
    expect(g.turn).not.toBe(first);
    // b (p2) goes offline; host a kicks them.
    const b = room.seats.find((p) => p?.token === "token-bbbb")!;
    b.lastSeen = 0;
    room.seats.find((p) => p?.token === "token-aaaa")!.lastSeen = T + 100_000;
    expect(oqCommand(room, "token-aaaa", { type: "kick", playerId: b.id }, T + 100_000).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(g.endReason).toBe("forfeit");
    expect(g.winner).toBe(room.seats.find((p) => p?.token === "token-aaaa")!.id);
    expect(room.history).toHaveLength(1);
  });
});
