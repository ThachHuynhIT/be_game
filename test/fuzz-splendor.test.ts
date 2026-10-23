import { describe, expect, it } from "vitest";
import { CARDS, CARD_BY_ID, GEMS, type Token } from "../src/splendor/cards";
import { type SPRoom, joinSP, newSPRoom, nextSPTickAt, spCommand, spView, tickSP } from "../src/splendor/room";
import { splendorAdapter } from "../src/server/adapters";

const T0 = 5_000_000;
const TOKENS: Token[] = [...GEMS, "gold"];

function seeded(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function conservation(room: SPRoom, n: number) {
  const g = room.current!;
  const all = [...g.players, ...(g.forfeited ?? [])];
  const per = n === 2 ? 4 : n === 3 ? 5 : 7;
  for (const t of TOKENS) {
    const total = g.bank[t] + all.reduce((a, id) => a + g.tokens[id][t], 0);
    expect(total, `token ${t}`).toBe(t === "gold" ? 5 : per);
    expect(g.bank[t]).toBeGreaterThanOrEqual(0);
    for (const id of all) expect(g.tokens[id][t]).toBeGreaterThanOrEqual(0);
  }
  const seen: number[] = [...g.board.flat().filter((c): c is number => c !== null), ...g.decks.flat()];
  for (const id of all) seen.push(...g.owned[id], ...g.reserved[id]);
  expect(seen.length).toBe(CARDS.length);
  expect(new Set(seen).size).toBe(CARDS.length);
  const nobles = [...g.nobleRow, ...all.flatMap((id) => g.nobles[id])];
  expect(new Set(nobles).size).toBe(nobles.length);
  expect(nobles.length).toBe(n + 1);
  for (const id of g.players) expect(g.reserved[id].length).toBeLessThanOrEqual(3);
}

function randomCommand(room: SPRoom, token: string, id: string, rnd: () => number) {
  const view = spView(room, room.seats.find((p) => p?.id === id)!, T0)!;
  const g = view.current!;
  const me = g.players.find((p) => p.id === id)!;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const faceUp = g.board.flat().filter((c): c is number => c !== null);
  if (rnd() < 0.7) {
    // mostly legal-ish play, guided by the view
    if (g.phase === "discard") {
      const t: Record<string, number> = {};
      let need = g.discardNeed;
      for (const k of TOKENS) { const n = Math.min(need, me.tokens[k], Math.floor(rnd() * 3)); if (n) { t[k] = n; need -= n; } }
      for (const k of TOKENS) { const n = Math.min(need, me.tokens[k] - (t[k] ?? 0)); if (n > 0) { t[k] = (t[k] ?? 0) + n; need -= n; } }
      return { type: "discard", tokens: t };
    }
    const buyable = [...faceUp, ...me.reserved.filter((c): c is number => c !== null)].filter((c) => {
      const card = CARD_BY_ID[c];
      let gold = 0;
      for (const k of GEMS) gold += Math.max(0, Math.max(0, (card.cost[k] ?? 0) - me.bonuses[k]) - me.tokens[k]);
      return gold <= me.tokens.gold;
    });
    const q = rnd();
    if (buyable.length && q < 0.7) return { type: "buy", card: pick(buyable) };
    if (q < 0.8 && me.reserved.length < 3) return { type: "reserve", card: pick(faceUp) };
    const avail = GEMS.filter((k) => g.bank[k] > 0);
    const shuffled = avail.slice().sort(() => rnd() - 0.5);
    if (rnd() < 0.3) { const two = avail.find((k) => g.bank[k] >= 4); if (two) return { type: "take", gems: [two, two] }; }
    return { type: "take", gems: shuffled.slice(0, 3) };
  }
  const r = rnd();
  const gem = () => pick([...GEMS, "gold", "junk", 3, null] as unknown[]);
  if (r < 0.3) {
    const k = pick([1, 2, 2, 3, 3, 3, 4, 0]);
    return { type: "take", gems: Array.from({ length: k }, () => (rnd() < 0.9 ? pick([...GEMS]) : gem())) };
  }
  if (r < 0.45) return { type: "reserve", card: rnd() < 0.8 ? pick([...faceUp, 9999, -1, 1.5]) : undefined, tier: rnd() < 0.5 ? pick([1, 2, 3, 4, 0, "1"]) : undefined };
  if (r < 0.7) return { type: "buy", card: pick([...faceUp, ...me.reserved.filter((c) => c !== null), ...faceUp, 12345, "x", null]) };
  if (r < 0.85) {
    const t: Record<string, unknown> = {};
    for (const k of TOKENS) if (rnd() < 0.5) t[k] = pick([0, 1, 2, 3, -1, 1.5, "1", 99]);
    return { type: "discard", tokens: rnd() < 0.9 ? t : pick([null, 5, "x"]) };
  }
  if (r < 0.9) return { type: "pass" };
  if (r < 0.93) return { type: "take" };
  if (r < 0.95) return { type: "buy" };
  return { type: "kick", playerId: pick(g.players.map((p) => p.id).concat(["zz"])) };
}

describe("fuzz splendor", () => {
  it("random play with garbage and timeouts keeps every invariant", { timeout: 20_000 }, () => {
    let ended = 0;
    let discards = 0;
    let kicks = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = seeded(seed * 7919);
      const n = 2 + (seed % 3);
      const room = newSPRoom(`FZ${seed}`);
      const toks = Array.from({ length: n }, (_, i) => `token-${seed}-${i}-xxxx`);
      let c = 0;
      toks.forEach((t, i) => joinSP(room, t, `P${i}`, T0, () => `p${c++}`, t));
      expect(spCommand(room, toks[0], { type: "settings", target: 15, turnSeconds: 30 }, T0).ok).toBe(true);
      expect(spCommand(room, toks[0], { type: "start" }, T0).ok).toBe(true);
      // spectator
      splendorAdapter.watch(room, "spec-token-1", "Spec", T0);
      const idToTok = new Map(room.seats.filter((p) => p).map((p) => [p!.id, p!.token]));
      let now = T0;
      let steps = 0;
      for (; steps < 3000 && room.current!.status === "playing"; steps++) {
        let g = room.current!;
        let turn = g.turn!;
        // keep players online except sometimes one goes silent
        for (const p of room.seats) if (p && !(seed % 5 === 0 && p.id === g.players[1] && steps > 20)) { p.lastSeen = now; }
        if (seed % 5 === 0 && rnd() < 0.03) {
          const host = room.seats.find((p) => p?.id === room.hostId)!;
          const r = spCommand(room, host.token, { type: "kick", playerId: g.players[1] }, now);
          if (r.ok) kicks++;
          if (room.current!.status !== "playing") break;
          g = room.current!;
          turn = g.turn!;
        }
        const before = JSON.stringify(room);
        const who = rnd() < 0.85 ? turn : g.players[Math.floor(rnd() * g.players.length)];
        const cmd = randomCommand(room, idToTok.get(who)!, who, rnd);
        const res = spCommand(room, idToTok.get(who)!, cmd as never, now);
        if (!res.ok) expect(JSON.stringify(room), JSON.stringify(cmd)).toBe(before);
        if (g.phase === "discard") discards++;
        now += Math.floor(rnd() * 4000);
        if (rnd() < 0.15) now += 20_000;
        const nt = nextSPTickAt(room, now);
        if (nt !== null && rnd() < 0.7) now = Math.max(now, nt);
        tickSP(room, now);
        if (room.current!.status !== "playing") break;
        if (steps % 4 !== 0) continue;
        conservation(room, n);
        expect(json(room)).toEqual(room);
        // views
        for (const p of room.seats) {
          if (!p) continue;
          const v = spView(room, p, now);
          const s = JSON.stringify(v);
          expect(s).not.toContain('"decks"');
          for (const q of v.current!.players) {
            if (q.id === p.id) continue;
            const real = room.current!.reserved[q.id];
            q.reserved.forEach((rc, i) => {
              if (rc !== null) expect(real[i] === rc && !(room.current!.blind ?? []).includes(rc)).toBe(true);
            });
          }
        }
        const sv = spView(room, null, now);
        for (const q of sv.current!.players) for (const rc of q.reserved) if (rc !== null) expect(room.current!.blind ?? []).not.toContain(rc);
      }
      const g = room.current!;
      if (g.status === "ended") {
        ended++;
        conservation(room, n);
        expect(g.finished.length).toBe(n);
        expect(new Set(g.finished).size).toBe(n);
        expect(g.finished.slice(0, g.players.length).sort()).toEqual(g.players.slice().sort());
        expect(room.history!.length).toBe(1);
        const sum = room.history![0].results.reduce((a, r) => a + r.delta, 0);
        expect(sum).toBe(0);
        // winner has the max points among everyone
        const pts = (id: string) => spView(room, null, now).current!.players.find((p) => p.id === id)!.prestige;
        expect(pts(g.finished[0])).toBe(Math.max(...g.players.map(pts)));
        if (!g.forfeited?.length) expect(g.players.some((id) => pts(id) >= 15)).toBe(true);
        expect(nextSPTickAt(room, now)).not.toBeNull; // presence timers only
      }
    }
    expect(ended).toBeGreaterThan(90);
    expect(discards).toBeGreaterThan(0);
    expect(kicks).toBeGreaterThan(0);
  });
});
