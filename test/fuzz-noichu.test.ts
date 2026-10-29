import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, MAX_WORDS, syllablesOf } from "../src/noichu/board";
import { type NCState, forfeitPlayer, needOf, newNCGame, playWord, tickGame } from "../src/noichu/game";
import { joinNC, ncCommand, ncView, newNCRoom, tickNC } from "../src/noichu/room";
import { wordsStartingWith } from "../src/noichu/words";

const names = (id: string) => id;
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 150);

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

function check(s: NCState, why: string) {
  const fail = (m: string) => {
    throw new Error(`${why}: ${m}\n${JSON.stringify({ ...s, log: [] })}`);
  };
  const words = s.chain.map((w) => w.word);
  if (new Set(words).size !== words.length) fail("a word was used twice");
  if (s.chain[0].by !== null) fail("the opening word has an author");
  for (let i = 1; i < s.chain.length; i++) {
    if (syllablesOf(s.chain[i].word)[0] !== syllablesOf(s.chain[i - 1].word)[1]) fail(`chain broken at ${i}`);
    if (!s.players.includes(s.chain[i].by!) ) fail(`unknown author at ${i}`);
  }
  if (s.chain.length > MAX_WORDS) fail("chain over the limit");
  const total = s.players.reduce((t, p) => t + (s.counts[p] ?? 0), 0);
  if (total !== s.chain.length - 1) fail(`counts ${total} != words ${s.chain.length - 1}`);
  if (new Set(s.out).size !== s.out.length || s.out.some((id) => !s.players.includes(id))) fail("bad out list");
  if (s.log.length > 30) fail("log not capped");
  if (s.status === "playing") {
    if (!s.turn || !s.players.includes(s.turn) || s.out.includes(s.turn)) fail(`turn ${s.turn}`);
    if (s.players.filter((p) => !s.out.includes(p)).length < 2) fail("playing with fewer than 2 active");
    if (s.deadline === null) fail("no deadline");
    if (s.finished.length || s.winner) fail("result before the end");
  } else {
    if (s.turn !== null || s.deadline !== null) fail("ended leftovers");
    const n = s.players.length;
    if (s.finished.length !== n || new Set(s.finished).size !== n) fail("finished is not a permutation");
    if (Object.keys(s.ranks).length !== n) fail("ranks");
    if (s.finished.some((id, i) => i > 0 && s.ranks[id] < s.ranks[s.finished[i - 1]])) fail("ranks not sorted");
    if (s.winner && s.ranks[s.winner] !== 0) fail("winner rank");
    const top = s.finished.filter((id) => s.ranks[id] === 0);
    if (!!s.winner !== (top.length === 1)) fail("winner vs ties");
    if (s.endReason !== "limit" && top.length !== 1) fail("shared first place without the word limit");
  }
}

const GARBAGE: unknown[] = ["", " ", "một", "một hai ba", "a-b c", "x 1", null, undefined, 42, {}, [], "ǅ ǅ", "a ".repeat(50), "\u0000 \u0000", "học  sinh", "HỌC SINH"];

describe("fuzz noichu: random commands, forfeits and ticks", () => {
  it("keeps invariants, refuses without mutating, survives JSON", () => {
    let ended = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const n = 2 + Math.floor(r() * (MAX_PLAYERS - 1));
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      let now = 1_000_000;
      let s = newNCGame(ids, now, { turnMs: r() < 0.5 ? 10_000 : undefined, dictionary: r() < 0.7 ? "strict" : r() < 0.5 ? "loose" : "off" }, r);
      const pk = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
      for (let i = 0; i < 600 && s.status === "playing"; i++) {
        const tag = `seed ${seed} n ${n} i ${i}`;
        const cur = s.turn!;
        const before = JSON.stringify(s);
        const x = r();
        let res: { ok: boolean } | null = null;
        let what = "";
        try {
          if (x < 0.06) {
            what = "tick";
            now += pk([500, 3000, 10_000, 31_000]);
            tickGame(s, now, names);
          } else if (x < 0.9) {
            what = "word";
            const actor = r() < 0.9 ? cur : pk(ids);
            const need = needOf(s)!;
            const choices = wordsStartingWith(need);
            let text: unknown;
            if (r() < 0.6 && choices.length) text = pk(choices);
            else if (r() < 0.5) text = `${need} ${pk(["qqq", "xyz", "mèo"])}`;
            else text = pk(GARBAGE);
            now += Math.floor(r() * 2000);
            res = playWord(s, actor, text, now, names);
          } else if (x < 0.93) {
            what = "forfeit";
            res = forfeitPlayer(s, pk(ids), now, names);
          } else {
            what = "poke";
            res = playWord(s, pk(["nobody", cur]), pk(GARBAGE), now, names);
          }
          if (res && !res.ok && JSON.stringify(s) !== before) throw new Error("refused command mutated state");
          if (r() < 0.1) {
            const copy = JSON.parse(JSON.stringify(s)) as NCState;
            expect(copy).toEqual(s);
            s = copy;
          }
          check(s, `after ${what}`);
        } catch (e) {
          throw new Error(`${tag} ${what}: ${(e as Error).message}`);
        }
      }
      if (s.status === "ended") ended++;
    }
    expect(ended).toBeGreaterThan(SEEDS / 3);
  }, 30_000);

  it("timeouts alone end every game (no stuck turn, every tick progresses)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 17);
      const n = 2 + (seed % (MAX_PLAYERS - 1));
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const s = newNCGame(ids, 0, {}, r);
      let now = 0;
      let ticks = 0;
      while (s.status === "playing" && ticks < 100) {
        now = s.deadline!;
        const snap = JSON.stringify(s);
        if (!tickGame(s, now, names) || JSON.stringify(s) === snap) throw new Error(`seed ${seed}: tick did not progress`);
        ticks++;
      }
      check(s, `timeouts seed ${seed}`);
      expect(s.status, `seed ${seed} after ${ticks} ticks`).toBe("ended");
      expect(ticks).toBe(n - 1);
    }
  });

  it("a game of valid words always reaches the word limit or an end", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = rng(seed * 101);
      const s = newNCGame(["a", "b", "c"], 0, {}, r);
      let now = 0;
      for (let i = 0; i < MAX_WORDS + 5 && s.status === "playing"; i++) {
        const used = new Set(s.chain.map((w) => w.word));
        const options = wordsStartingWith(needOf(s)!).filter((w) => !used.has(w));
        now += 100;
        if (!options.length) {
          now = s.deadline!;
          tickGame(s, now, names);
        } else playWord(s, s.turn!, options[Math.floor(r() * options.length)], now, names);
        check(s, `valid words seed ${seed} i ${i}`);
      }
      expect(s.status, `seed ${seed}`).toBe("ended");
    }
  }, 30_000);
});

describe("fuzz noichu: room level", () => {
  it("random traffic never leaks tokens and scores consistently", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed * 53);
      const room = newNCRoom("NC" + seed);
      let now = 1_000_000;
      let id = 0;
      const tokens: string[] = [];
      for (let i = 0; i < 2 + Math.floor(r() * 5); i++) {
        const token = `token-${seed}-${i}-xxxx`;
        tokens.push(token);
        joinNC(room, token, `P${i}`, now, () => `p${++id}`, token);
      }
      const pk = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
      ncCommand(room, tokens[0], { type: "start" }, now, r);
      for (let i = 0; i < 300; i++) {
        now += pk([100, 1000, 5000, 21_000]);
        for (const t of tokens) {
          const p = room.seats.find((x) => x?.token === t);
          if (p && r() < 0.8) p.lastSeen = now;
        }
        const g = room.current;
        if (g?.status === "playing" && r() < 0.7) {
          const mover = room.seats.find((p) => p?.id === g.turn);
          const choices = wordsStartingWith(needOf(g)!);
          if (mover && choices.length) ncCommand(room, mover.token, { type: "word", text: pk(choices) }, now, r);
        } else if (r() < 0.2) ncCommand(room, tokens[0], { type: "start" }, now, r);
        tickNC(room, now);
        for (const p of room.seats) {
          if (!p) continue;
          const view = ncView(room, p, now);
          expect(JSON.stringify(view)).not.toContain("token-");
          expect(view.current === null || view.current.chain.length <= 40).toBe(true);
        }
      }
      const total = room.seats.reduce((t, p) => t + (p?.points ?? 0), 0) + (room.gone ?? []).reduce((t, g) => t + (g.points ?? 0), 0);
      expect(total, `seed ${seed}: points must sum to zero`).toBe(0);
      expect(room.history?.every((h) => h.results.reduce((t, x) => t + x.delta, 0) === 0)).toBe(true);
    }
  }, 30_000);
});
