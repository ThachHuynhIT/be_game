import { describe, expect, it } from "vitest";
import { FINAL, GATE, HORSES, STABLE, trackIndex } from "../src/cangua/board";
import { type CNRules, type CNState, forfeitPlayer, legalMoves, moveHorse, newCNGame, rollDie, targetOf, tickGame } from "../src/cangua/game";
import { cnCommand, cnView, joinCN, newCNRoom, tickCN } from "../src/cangua/room";

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

function check(s: CNState, why: string) {
  const fail = (m: string) => {
    throw new Error(`${why}: ${m}\n${JSON.stringify({ ...s, log: [] })}`);
  };
  const seen = new Map<number, string>();
  for (const id of [...s.players, ...(s.forfeited ?? [])]) {
    const hs = s.horses[id];
    if (!hs || hs.length !== HORSES) fail(`horses of ${id}`);
    const homes = new Set<number>();
    hs.forEach((p, h) => {
      if (!Number.isInteger(p) || p < STABLE || p > FINAL) fail(`pos ${id}/${h} ${p}`);
      if (p > GATE) {
        if (homes.has(p)) fail(`two horses of ${id} on home step ${p}`);
        homes.add(p);
      } else if (p >= 0 && s.players.includes(id)) {
        const sq = trackIndex(s.colors[id], p);
        if (seen.has(sq)) fail(`track square ${sq} shared by ${seen.get(sq)} and ${id}`);
        seen.set(sq, id);
      }
    });
    if ((s.forfeited ?? []).includes(id) && hs.some((p) => p !== STABLE)) fail("forfeited horse on board");
  }
  if (new Set([...s.players, ...(s.forfeited ?? [])]).size !== s.players.length + (s.forfeited ?? []).length) fail("player listed twice");
  for (const d of s.done) if (!s.horses[d].every((p) => p >= GATE + 3)) fail(`${d} done but not home`);
  if (s.log.length > 20) fail("log");
  if (s.status === "playing") {
    if (!s.turn || !s.players.includes(s.turn) || s.done.includes(s.turn)) fail(`bad turn ${s.turn}`);
    if (s.players.filter((p) => !s.done.includes(p)).length < 2) fail("playing with <2 racers");
    if (s.deadline === null) fail("no deadline");
    if (s.phase === "move") {
      if (!s.die || s.die < 1 || s.die > 6 || !s.legal.length) fail("move phase without die/legal");
      const exp = legalMoves(s, s.turn!, s.die!);
      if (JSON.stringify(exp) !== JSON.stringify(s.legal)) fail(`stale legal ${s.legal} vs ${exp}`);
    } else if (s.die !== null || s.legal.length) fail("roll phase with die");
    if (s.sixes > 2 && s.rules.threeSixes) fail("sixes");
  } else {
    if (s.turn !== null || s.deadline !== null) fail("ended leftovers");
    const all = [...s.players, ...(s.forfeited ?? [])];
    if (s.finished.length !== all.length || new Set(s.finished).size !== all.length || !all.every((p) => s.finished.includes(p))) fail(`finished ${s.finished} vs ${all}`);
  }
}

const rulesFrom = (m: number): CNRules => ({ exitOn1: !!(m & 1), noJump: !!(m & 2), ladder: !!(m & 4), threeSixes: !!(m & 8), rankAll: !!(m & 16) });

describe("fuzz cangua: random commands, every rule combination", () => {
  it("keeps invariants, refuses without mutating, survives JSON", () => {
    for (let seed = 1; seed <= 160; seed++) {
      const r = rng(seed);
      const n = 2 + Math.floor(r() * 3);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const rules = rulesFrom(seed % 32);
      let now = 1_000_000;
      let s = newCNGame(ids, now, { rules, turnMs: r() < 0.5 ? 10_000 : undefined }, r);
      const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      const absentSet = new Set<string>();
      for (let i = 0; i < 1500 && s.status === "playing"; i++) {
        const tag = `seed ${seed} rules ${JSON.stringify(rules)} i ${i}`;
        const cur = s.turn!;
        const actor = r() < 0.8 ? cur : pk(ids);
        const before = JSON.stringify(s);
        const x = r();
        let res: { ok: boolean } | null = null;
        let what = "";
        try {
          if (x < 0.08) {
            what = "tick";
            if (r() < 0.3) {
              absentSet.clear();
              if (r() < 0.6) absentSet.add(pk(ids));
            }
            now += pk([500, 3000, 11_000, 20_000]);
            tickGame(s, now, names, (id) => absentSet.has(id), r);
          } else if (x < 0.5) {
            what = "roll";
            res = rollDie(s, actor, now, names, r);
          } else if (x < 0.93) {
            what = "move";
            const horse = r() < 0.7 && s.legal.length ? pk(s.legal) : pk<unknown>([0, 1, 2, 3, 4, -1, 1.5, NaN, "1", null, undefined, {}]);
            const pre = s.phase === "move" ? { ...s, horses: JSON.parse(JSON.stringify(s.horses)) as CNState["horses"] } : null;
            res = moveHorse(s, actor, horse, now, names);
            if (res.ok && pre && typeof horse === "number") {
              const from = pre.horses[actor][horse];
              const to = s.horses[actor][horse];
              const d = pre.die!;
              const t = targetOf(pre, actor, horse, d);
              if (!t || t.to !== to) throw new Error(`target mismatch ${from}->${to} die ${d}`);
              if (from === STABLE ? to !== 0 : from <= GATE && to !== from + d && to !== GATE + 1) throw new Error(`horse moved ${from}->${to} with die ${d}`);
            }
          } else {
            what = "forfeit";
            if (r() < 0.5) res = forfeitPlayer(s, pk(ids), now, names);
          }
          if (res && !res.ok && JSON.stringify(s) !== before) throw new Error("refused command mutated state");
          if (r() < 0.1) {
            const copy = JSON.parse(JSON.stringify(s)) as CNState;
            expect(copy).toEqual(s);
            s = copy;
          }
          check(s, `after ${what}`);
        } catch (e) {
          throw new Error(`${tag} ${what}: ${(e as Error).message}`);
        }
      }
    }
  }, 20_000);
});

describe("fuzz cangua: timeouts alone finish the game", () => {
  it("every rule combination ends within a bound and every tick progresses", () => {
    for (let m = 0; m < 32; m++) {
      for (let seed = 1; seed <= 4; seed++) {
        const r = rng(m * 100 + seed);
        const n = 2 + ((m + seed) % 3);
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        let now = 0;
        const s = newCNGame(ids, now, { rules: rulesFrom(m) }, r);
        let ticks = 0;
        while (s.status === "playing" && ticks < 40_000) {
          now = s.deadline! + 1;
          const snap = JSON.stringify(s);
          if (!tickGame(s, now, names, () => false, r) || JSON.stringify(s) === snap) throw new Error(`rules ${m} seed ${seed}: tick did not progress`);
          ticks++;
        }
        check(s, `autoplay rules ${m}`);
        expect(s.status, `rules ${m} seed ${seed} still playing after ${ticks} ticks`).toBe("ended");
      }
    }
  }, 30_000);

  it("absent players are played fast and the game ends", () => {
    const r = rng(9);
    const s = newCNGame(["a", "b", "c"], 0, { rules: { exitOn1: false, noJump: true, ladder: true, threeSixes: true, rankAll: true } }, r);
    let now = 0;
    for (let i = 0; i < 40_000 && s.status === "playing"; i++) {
      now = s.phaseAt + 2_500;
      tickGame(s, now, names, () => true, r);
    }
    expect(s.status).toBe("ended");
  });
});

describe("fuzz cangua: room level", () => {
  it("random room traffic never leaks tokens and keeps invariants", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = rng(seed * 31);
      const room = newCNRoom("CN" + seed);
      let now = 1_000_000;
      let id = 0;
      const n = 2 + Math.floor(r() * 3);
      const tokens = Array.from({ length: n }, (_, i) => `secret-token-${seed}-${i}-xyz`);
      tokens.forEach((t, i) => joinCN(room, t, `P${i}`, now, () => `id${id++}`, t));
      const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      cnCommand(room, tokens[0], { type: "settings", ladder: r() < 0.5, noJump: r() < 0.5, rankAll: r() < 0.5, exitOn1: r() < 0.5, turnSeconds: 10 }, now);
      expect(cnCommand(room, tokens[0], { type: "start" }, now).ok).toBe(true);
      for (let i = 0; i < 4000 && room.current!.status === "playing"; i++) {
        const g = room.current!;
        const cur = room.seats.findIndex((p) => p?.id === g.turn);
        const tok = r() < 0.8 && cur >= 0 ? tokens[cur] : pk(tokens);
        const x = r();
        if (x < 0.4) cnCommand(room, tok, { type: "roll" }, now, r);
        else if (x < 0.8) cnCommand(room, tok, { type: "move", horse: pk([0, 1, 2, 3]) }, now, r);
        else {
          now += pk([2_000, 11_000]);
          for (const p of room.seats) if (p && r() < 0.8) p.lastSeen = now;
          tickCN(room, now, r);
        }
        const view = JSON.stringify([...room.seats.map((p) => cnView(room, p, now)), cnView(room, null, now)]);
        for (const t of tokens) expect(view.includes(t)).toBe(false);
        check(g, `room seed ${seed}`);
      }
    }
  }, 20_000);
});
