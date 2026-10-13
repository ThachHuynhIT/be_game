import { describe, expect, it } from "vitest";
import { cellsFor, isQuanCell, quanIndex, rowOf } from "../src/oanquan/board";
import { type OQState, forfeitPlayer, legalMoves, makeMove, newOQGame, scoreOf, tickGame } from "../src/oanquan/game";
import { joinOQ, newOQRoom, oqCommand, oqDeltas, oqView, tickOQ } from "../src/oanquan/room";

const names = (id: string) => id;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function check(s: OQState, why: string) {
  const n = s.players.length;
  const fail = (m: string) => {
    throw new Error(`${why}: ${m}\n${JSON.stringify({ ...s, log: [], lastMove: null })}`);
  };
  if (s.dan.length !== cellsFor(n)) fail("ring size");
  if (s.dan.some((x, c) => !Number.isInteger(x) || x < 0 || (isQuanCell(c) && false))) fail("dan");
  const piles = s.players.reduce((t, p) => t + s.captured[p].dan, 0);
  const quanLeft = s.quan.filter(Boolean).length;
  const quanCaptured = s.players.reduce((t, p) => t + s.captured[p].quan, 0);
  for (const p of s.players) {
    const c = s.captured[p];
    if (!Number.isInteger(c.dan) || c.dan < 0 || !Number.isInteger(c.quan) || c.quan < 0) fail(`captured ${p}`);
    const owed = Object.values(s.debts[p] ?? {}).reduce((t, x) => t + x, 0);
    if (owed !== s.borrowed[p]) fail(`borrowed ${p} ${s.borrowed[p]} != debts ${owed}`);
    if (Object.entries(s.debts[p]).some(([l, x]) => l === p || x <= 0 || !s.players.includes(l))) fail(`bad debts ${p}`);
  }
  if (quanLeft + quanCaptured !== n) fail(`quan ${quanLeft}+${quanCaptured}`);
  if (s.status === "playing") {
    const onBoard = s.dan.reduce((a, b) => a + b, 0);
    if (onBoard + piles !== 25 * n) fail(`stones ${onBoard}+${piles} != ${25 * n}`);
    if (!s.turn || !s.players.includes(s.turn) || s.out.includes(s.turn)) fail(`turn ${s.turn}`);
    if (s.players.filter((p) => !s.out.includes(p)).length < 2) fail("playing with <2 active");
    if (rowOf(s.players.indexOf(s.turn!)).every((c) => s.dan[c] === 0)) fail("current player has an empty row");
    if (s.deadline === null) fail("deadline");
    if (new Set(s.out).size !== s.out.length) fail("out dup");
  } else {
    if (s.turn !== null || s.deadline !== null) fail("ended leftovers");
    if (s.finished.length !== n || new Set(s.finished).size !== n) fail("finished");
    if (Object.keys(s.ranks).length !== n) fail("ranks");
    if (s.finished.some((id, i) => i > 0 && s.ranks[id] < s.ranks[s.finished[i - 1]])) fail("ranks not sorted");
    if (s.winner && s.ranks[s.winner] !== 0) fail("winner rank");
    const top = s.finished.filter((id) => s.ranks[id] === 0);
    if (s.endReason !== "stuck" && s.endReason !== "forfeit" && !!s.winner !== (top.length === 1)) fail("winner vs ties");
  }
  void quanIndex;
}

describe("fuzz oanquan: random commands, forfeits and ticks", () => {
  it("keeps invariants, refuses without mutating, survives JSON", () => {
    let ended = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const n = 2 + Math.floor(r() * 3);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      let now = 1_000_000;
      let s = newOQGame(ids, now, { quanValue: r() < 0.5 ? 5 : 10, quanNon: r() < 0.5, turnMs: r() < 0.5 ? 15_000 : undefined }, r);
      const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      const absentSet = new Set<string>();
      for (let i = 0; i < 1200 && s.status === "playing"; i++) {
        const tag = `seed ${seed} n ${n} i ${i}`;
        const cur = s.turn!;
        const before = JSON.stringify(s);
        const x = r();
        let res: { ok: boolean } | null = null;
        let what = "";
        try {
          if (x < 0.1) {
            what = "tick";
            if (r() < 0.3) {
              absentSet.clear();
              if (r() < 0.6) absentSet.add(pk(ids));
            }
            now += pk([500, 3000, 16_000, 31_000]);
            tickGame(s, now, names, (id) => absentSet.has(id), r);
          } else if (x < 0.9) {
            what = "move";
            const actor = r() < 0.85 ? cur : pk(ids);
            const m = legalMoves(s, actor);
            const legal = m.length && r() < 0.8 ? pk(m) : null;
            const cell = legal ? legal.cell : pk<unknown>([0, 6, 3, -1, 99, 1.5, NaN, "2", null, undefined, Math.floor(r() * cellsFor(n))]);
            const dir = legal ? legal.dir : pk<unknown>([1, -1, 0, 2, "1", null]);
            res = makeMove(s, actor, cell, dir, now, names);
            if (res.ok && s.status === "playing" && s.lastMove!.steps.some((st) => st.k === "sow" && (st.cell < 0 || st.cell >= cellsFor(n)))) throw new Error("sowed off the board");
          } else {
            what = "forfeit";
            res = forfeitPlayer(s, pk(ids), now, names);
          }
          if (res && !res.ok && JSON.stringify(s) !== before) throw new Error("refused command mutated state");
          if (r() < 0.1) {
            const copy = JSON.parse(JSON.stringify(s)) as OQState;
            expect(copy).toEqual(s);
            s = copy;
          }
          check(s, `after ${what}`);
          if (s.status === "ended") for (const id of ids) void scoreOf(s, id);
        } catch (e) {
          throw new Error(`${tag} ${what}: ${(e as Error).message}`);
        }
      }
      if (s.status === "ended") ended++;
    }
    expect(ended).toBeGreaterThan(100);
  }, 20_000);

  it("timeouts alone end every game (no stuck turn, every tick progresses)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 17);
      const n = 2 + (seed % 3);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const s = newOQGame(ids, 0, { quanValue: 10, quanNon: seed % 2 === 0 }, r);
      let now = 0;
      let ticks = 0;
      while (s.status === "playing" && ticks < 3000) {
        now = s.deadline! + 1;
        const snap = JSON.stringify(s);
        if (!tickGame(s, now, names, () => false, r) || JSON.stringify(s) === snap) throw new Error(`seed ${seed}: tick did not progress`);
        ticks++;
      }
      check(s, `autoplay seed ${seed}`);
      expect(s.status, `seed ${seed} after ${ticks} ticks`).toBe("ended");
    }
  }, 20_000);
});

describe("fuzz oanquan: room level", () => {
  it("random traffic never leaks tokens and scores consistently", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed * 53);
      const room = newOQRoom("OQ" + seed);
      let now = 1_000_000;
      let id = 0;
      const n = 2 + Math.floor(r() * 3);
      const tokens = Array.from({ length: n }, (_, i) => `secret-token-${seed}-${i}-xyz`);
      tokens.forEach((t, i) => joinOQ(room, t, `P${i}`, now, () => `id${id++}`));
      const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      expect(oqCommand(room, tokens[0], { type: "settings", quanNon: r() < 0.5, turnSeconds: 15 }, now).ok).toBe(true);
      expect(oqCommand(room, tokens[0], { type: "start" }, now, r).ok).toBe(true);
      for (let i = 0; i < 3000 && room.current!.status === "playing"; i++) {
        const g = room.current!;
        const cur = room.seats.findIndex((p) => p?.id === g.turn);
        const tok = r() < 0.8 && cur >= 0 ? tokens[cur] : pk(tokens);
        if (r() < 0.8) {
          const me = room.seats.find((p) => p?.token === tok)!.id;
          const m = legalMoves(g, me);
          if (m.length && r() < 0.8) oqCommand(room, tok, { type: "move", ...pk(m) }, now, r);
          else oqCommand(room, tok, { type: "move", cell: Math.floor(r() * 30), dir: pk([1, -1, 0]) as 1 }, now, r);
        } else {
          now += pk([2_000, 16_000]);
          for (const p of room.seats) if (p && r() < 0.8) p.lastSeen = now;
          tickOQ(room, now, r);
        }
        if (r() < 0.2) {
          const view = JSON.stringify([...room.seats.map((p) => oqView(room, p, now)), oqView(room, null, now)]);
          for (const t of tokens) expect(view.includes(t)).toBe(false);
        }
        check(g, `room seed ${seed}`);
      }
      if (room.current!.status === "ended") {
        const rec = room.history![room.history!.length - 1];
        expect(rec.results).toHaveLength(n);
        expect(rec.results.reduce((t, x) => t + x.delta, 0)).toBeLessThanOrEqual(0);
      }
    }
  }, 20_000);
});

describe("oanquan tie scoring", () => {
  const st = { quanValue: 10, quanNon: true, turnSeconds: 15, first: 2, second: 1 };
  it("tied places share points rounded down, never creating points", () => {
    // 4 players, last two tied: places −1 and −2 average −1.5 → both −2 (truncating gave −1 each, a sum of +1).
    expect(oqDeltas(["a", "b", "c", "d"], { a: 0, b: 1, c: 2, d: 2 }, st)).toEqual({ a: 2, b: 1, c: -2, d: -2 });
    expect(oqDeltas(["a", "b", "c"], { a: 0, b: 0, c: 2 }, st)).toEqual({ a: 1, b: 1, c: -3 });
    expect(oqDeltas(["a", "b"], { a: 0, b: 0 }, st)).toEqual({ a: 0, b: 0 });
    for (const n of [2, 3, 4])
      for (let mask = 0; mask < 1 << (n - 1); mask++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const ranks: Record<string, number> = {};
        ids.forEach((id, i) => (ranks[id] = i > 0 && mask & (1 << (i - 1)) ? ranks[ids[i - 1]] : i));
        const sum = Object.values(oqDeltas(ids, ranks, st)).reduce((t, x) => t + x, 0);
        expect(sum, JSON.stringify(ranks)).toBeLessThanOrEqual(0);
      }
  });
});
