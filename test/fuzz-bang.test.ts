import { afterAll, describe, expect, it } from "vitest";
import { EXPANSIONS, deckFor } from "../src/bang/cards";
import type { BangState } from "../src/bang/game";
import { type BangRoom, bangCommand, bangView, joinBang, newBangRoom, leaveBang, nextBangTickAt, tickBang } from "../src/bang/room";
import { abilityList, playCard, respond } from "../src/bang/actions";
import { newBangGame, pickCharacter, run, startTurn } from "../src/bang/game";
import { CARDS } from "../src/bang/cards";

const realRandom = Math.random;
afterAll(() => {
  Math.random = realRandom;
});
const T0 = 9_000_000;
const SEEDS = Number(process.env.FZ_SEEDS ?? 24);

function seeded(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

function conserved(s: BangState) {
  const seen: number[] = [...s.deck, ...s.discard];
  for (const id of s.order) seen.push(...s.ps[id].hand, ...s.ps[id].play.map((c) => c.id));
  for (const q of s.queue) {
    if (q.kind === "store" || q.kind === "keep") seen.push(...q.cards);
    if (q.kind === "pokerEnd") seen.push(...q.pool);
  }
  const expected = deckFor(s.packs);
  expect(seen.length, "card count").toBe(expected.length);
  expect(new Set(seen).size, "card uniqueness").toBe(expected.length);
}

function command(room: BangRoom, id: string, rnd: () => number): Record<string, unknown> {
  const s = room.current!;
  const p = s.ps[id];
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const ids = s.order;
  const tgt = (): unknown => (rnd() < 0.95 ? pick(ids) : pick(["zz", 3, null, ""]));
  const anyCard = (): unknown => (rnd() < 0.8 && p.hand.length ? pick(p.hand) : rnd() < 0.5 ? Math.floor(rnd() * 130) : pick([-1, 1.5, "x", null]));
  if (rnd() < 0.08) {
    return pick<Record<string, unknown>>([
      { type: "play" },
      { type: "play", card: anyCard(), target: tgt(), pick: { zone: "play", card: 3 } },
      { type: "respond", cards: "x" },
      { type: "respond", cards: [anyCard(), anyCard()], take: rnd() < 0.5 },
      { type: "end", discard: [anyCard(), anyCard()] },
      { type: "end", discard: p.hand },
      { type: "ability", name: pick(["chuck", "doc", "x", "", "josh"]), cards: [anyCard()], target: tgt() },
      { type: "buy", slot: pick([0, 1, 2, 9, -1]), target: tgt(), mode: pick(["beer", "bang", "x"]) },
      { type: "draw", mode: pick(["normal", "x", "target"]), target: tgt(), targets: [tgt()], card: anyCard(), color: "red" },
      { type: "pick", char: "x" },
      { type: "use", card: anyCard(), target: tgt() },
      { type: "kick", playerId: tgt() },
      { type: "start" },
      { type: "settings", packs: ["dodge"] },
      { type: "nonsense" },
    ]);
  }
  if (s.status === "picking") return { type: "pick", char: s.picks[id] ? pick(s.picks[id]) : "x" };
  const head = s.queue[0];
  if (head && "to" in head && head.to === id && "deadline" in head) {
    switch (head.kind) {
      case "draw":
        return { type: "draw", mode: pick(head.options), target: tgt(), targets: [tgt()], card: s.ps[pick(ids)]?.play[0]?.id, color: pick(["red", "black"]), swap: rnd() < 0.5, blood: tgt() };
      case "store":
        return { type: "respond", card: pick(head.cards) };
      case "pick":
        return { type: "respond", card: rnd() < 0.5 ? undefined : (s.ps[head.from]?.play[0]?.id ?? 0), choice: pick(["hand", "play"]) };
      case "keep":
        return { type: "respond", cards: head.cards.slice(0, head.keep) };
      case "discard":
        return { type: "respond", cards: p.hand.slice(0, head.count) };
      case "copy":
        return { type: "respond", choice: pick(head.options) };
      default:
        return rnd() < 0.6 ? { type: "respond", cards: p.hand.slice(0, 1 + Math.floor(rnd() * 2)) } : { type: "respond", take: true };
    }
  }
  if (s.turn?.player === id && s.turn.step === "play" && !s.queue.length) {
    const others = ids.filter((o) => o !== id);
    const r = rnd();
    if (r < 0.55 && p.hand.length) {
      const target = pick(others);
      const t = s.ps[target];
      return {
        type: "play",
        card: pick(p.hand),
        target,
        target2: pick(others),
        pick: rnd() < 0.5 || !t.play.length ? { zone: "hand" } : { zone: "play", card: t.play[0].id },
        extra: rnd() < 0.2 ? [pick(p.hand)] : undefined,
        as: rnd() < 0.1 ? "bang" : undefined,
        mode: pick([undefined, "take", "beer", "bang"]),
      };
    }
    if (r < 0.65 && p.play.length) return { type: "use", card: pick(p.play).id, target: pick(others), pick: { zone: "hand" } };
    if (r < 0.75) {
      const ab = abilityList(s, id);
      if (ab.length) return { type: "ability", name: pick(ab), target: pick(others), cards: p.hand.slice(0, 2), card: p.hand[0], pick: { zone: "hand" } };
    }
    if (r < 0.82 && s.shop.length) return { type: "buy", slot: Math.floor(rnd() * s.shop.length), target: pick(others), mode: pick([undefined, "beer", "bang", "panic"]), pick: { zone: "hand" } };
    const over = p.hand.length - Math.max(0, p.life);
    return { type: "end", discard: over > 0 ? p.hand.slice(0, over) : [] };
  }
  return { type: "end", discard: [] };
}

function checkViews(room: BangRoom, now: number) {
  const g = room.current!;
  for (const seat of [...room.seats, null]) {
    const v = bangView(room, seat, now);
    const meId = seat?.id ?? null;
    const view = v.current!;
    for (const pv of view.players) {
      const real = g.ps[pv.id];
      const self = pv.id === meId;
      if (!self && g.status !== "ended" && g.event !== "sacagaway") expect(pv.hand, `hand of ${pv.id} leaked`).toBeNull();
      if (self) expect(pv.hand).toEqual(real.hand);
      if (g.status !== "ended" && !self && !real.dead && real.role !== "sheriff") expect(pv.role, `role of ${pv.id} leaked`).toBeNull();
      if (g.status === "picking" && !self && g.picks[pv.id]) expect(pv.char).toBeNull();
    }
    if (g.status === "picking") expect(view.picking).toEqual(meId && g.picks[meId] ? g.picks[meId] : []);
    if (view.prompt?.kind === "keep" && view.prompt.to !== meId) expect(view.prompt.cards).toBeUndefined();
    const s = JSON.stringify(v);
    expect(s).not.toContain(`"deck":`);
    expect(s).not.toContain(`"picks":`);
    expect(s).not.toContain("token-");
  }
}

describe("fuzz bang", () => {
  it("random rooms 3..8 players, every pack, garbage, disconnects, kicks", { timeout: 600_000 }, () => {
    let ended = 0;
    let kicks = 0;
    let total = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      total++;
      const rnd = seeded(seed * 104729);
      Math.random = seeded(seed * 7 + 3);
      const n = 3 + (seed % 6);
      const room = newBangRoom(`BF${seed}`);
      const toks = Array.from({ length: n }, (_, i) => `token-${seed}-${i}-xxxx`);
      let c = 0;
      toks.forEach((t, i) => joinBang(room, t, `P${i}`, T0, () => `p${c++}`));
      const packs = EXPANSIONS.filter(() => rnd() < 0.6);
      expect(bangCommand(room, toks[0], { type: "settings", packs, turnSeconds: 45, respondSeconds: 10 }, T0).ok).toBe(true);
      expect(bangCommand(room, toks[0], { type: "start" }, T0).ok).toBe(true);
      const idToTok = new Map(room.seats.filter((p) => p).map((p) => [p!.id, p!.token]));
      const silent = new Set<string>();
      let now = T0;
      let step = 0;
      for (; step < 2500 && room.current!.status !== "ended"; step++) {
        const g = room.current!;
        if (step === 15 + (seed % 7) && seed % 3 === 0) silent.add(g.order[1 + (seed % (n - 1))]);
        if (step === 30 && seed % 4 === 1) {
          const who = g.order[g.order.length - 1];
          leaveBang(room, idToTok.get(who)!, now);
          silent.add(who);
        }
        for (const p of room.seats) if (p && !silent.has(p.id) && !p.kicked) p.lastSeen = now;
        if (silent.size && rnd() < 0.05) {
          const host = room.seats.find((p) => p?.id === room.hostId);
          if (host && !silent.has(host.id)) {
            const t = [...silent][0];
            const before = JSON.stringify(room);
            const r = bangCommand(room, host.token, { type: "kick", playerId: t }, now);
            if (r.ok) {
              kicks++;
              silent.delete(t);
            } else expect(JSON.stringify(room)).toBe(before);
          }
        }
        if ((room.current!.status as string) === "ended") break;
        const s = room.current!;
        const waiting = s.status === "picking" ? Object.keys(s.picks) : s.queue[0] && "to" in s.queue[0] && "deadline" in s.queue[0] ? [s.queue[0].to] : s.turn ? [s.turn.player] : [];
        const who = rnd() < 0.85 && waiting.length ? waiting[Math.floor(rnd() * waiting.length)] : s.order[Math.floor(rnd() * s.order.length)];
        if (silent.has(who) || room.seats.find((p) => p?.id === who)?.kicked) {
          now += 3000;
        } else {
          const msg = command(room, who, rnd);
          const before = JSON.stringify(room);
          const res = bangCommand(room, idToTok.get(who)!, msg as never, now);
          if (!res.ok) expect(JSON.stringify(room), JSON.stringify(msg)).toBe(before);
          now += Math.floor(rnd() * 1500);
        }
        if (rnd() < 0.1) now += 12_000;
        const nt = nextBangTickAt(room, now);
        if (nt !== null && rnd() < 0.6) now = Math.max(now, nt);
        tickBang(room, now);
        if ((room.current!.status as string) === "ended") break;
        if (step % 3 === 0) {
          conserved(room.current!);
          expect(JSON.parse(JSON.stringify(room))).toEqual(room);
          for (const id of room.current!.order) {
            const pl = room.current!.ps[id];
            expect(pl.life).toBeLessThanOrEqual(pl.max);
            if (pl.dead && !pl.ghost && !pl.townGhost) {
              expect(pl.hand, `dead ${id} keeps cards`).toEqual([]);
              expect(pl.play, `dead ${id} keeps cards`).toEqual([]);
            }
          }
          checkViews(room, now);
          expect(room.current!.deadline, "playing game without a deadline").not.toBeNull();
          expect(room.current!.queue.filter((q) => "to" in q && room.current!.ps[q.to].dead && !room.current!.ps[q.to].ghost && !room.current!.ps[q.to].townGhost && q.kind !== "pokerEnd" && q.kind !== "hurt"), "prompt for a dead player").toEqual([]);
        }
      }
      const g = room.current!;
      conserved(g);
      if (g.status === "ended") {
        ended++;
        expect(g.winners.every((w) => g.order.includes(w))).toBe(true);
        expect(g.finished.slice().sort()).toEqual(g.order.slice().sort());
        const rec = room.history![room.history!.length - 1];
        expect(rec.results.reduce((a, r) => a + r.delta, 0)).toBe(0);
        expect(g.queue).toEqual([]);
        checkViews(room, now);
      } else {
        expect(nextBangTickAt(room, now)).not.toBeNull();
      }
    }
    expect(ended, `ended ${ended}/${total}, kicks ${kicks}`).toBeGreaterThan(total * 0.9);
    expect(kicks).toBeGreaterThan(0);
  });
});

describe("bang regressions found by fuzzing", () => {
  it("a player kicked during character choice starts dead with no life and no cards", () => {
    const room = newBangRoom("PR");
    const T = 1_000_000;
    const toks = ["tok-aaaaaaaa", "tok-bbbbbbbb", "tok-cccccccc", "tok-dddddddd"];
    let n = 0;
    for (const t of toks) joinBang(room, t, `P${n}`, T, () => `p${n++}`);
    expect(bangCommand(room, toks[0], { type: "start" }, T).ok).toBe(true);
    const g = room.current!;
    const later = T + 10 * 60_000;
    for (const s of room.seats) if (s) s.lastSeen = later;
    const victim = g.order.find((id) => id !== "p0" && g.ps[id].role === "outlaw") ?? g.order.find((id) => id !== "p0" && g.ps[id].role !== "sheriff")!;
    room.seats.find((s) => s?.id === victim)!.lastSeen = T;
    expect(bangCommand(room, toks[0], { type: "kick", playerId: victim }, later).ok).toBe(true);
    for (const id of Object.keys(g.picks)) bangCommand(room, room.seats.find((s) => s?.id === id)!.token, { type: "pick", char: g.picks[id][0] }, later);
    expect(g.status).toBe("playing");
    expect(g.ps[victim].dead).toBe(true);
    expect(g.ps[victim].life).toBe(0);
    expect(g.ps[victim].hand).toEqual([]);
    conserved(g);
  });

  it("a ghost who loses the Hồn Ma card goes back to the grave without keeping cards", () => {
    const names = (id: string) => id;
    const T = 1_000_000;
    const rnd = () => 0.3;
    const s = newBangGame(["a", "b", "c", "d"], T, { packs: ["valley"] }, rnd);
    for (const id of s.order) pickCharacter(s, id, s.picks[id][0], T, names, rnd);
    for (const id of s.order) s.ps[id].char = "sid"; // no powers that interfere
    s.ps.a.role = "sheriff";
    s.ps.b.role = "outlaw";
    s.ps.c.role = "outlaw";
    s.ps.d.role = "renegade";
    const take = (id: string, key: string) => {
      const c = s.deck.find((x) => CARDS[x].key === key)!;
      s.deck.splice(s.deck.indexOf(c), 1);
      return c;
    };
    // b is dead as a ghost with 2 cards in hand and a Hồn Ma in front.
    s.ps.b.dead = true;
    s.ps.b.life = 0;
    s.ps.b.ghost = true;
    s.ps.b.hand = [take("b", "bang"), take("b", "missed")];
    const ghost = take("b", "ghost");
    s.ps.b.play = [{ id: ghost }];
    startTurn(s, "a", T, false);
    s.turn!.step = "play";
    s.queue = [];
    s.deadline = T + 60_000;
    const panic = take("a", "panic");
    s.ps.a.hand = [panic];
    expect(playCard(s, "a", { card: panic, target: "b", pick: { zone: "play", card: ghost } }, T, names, rnd).ok).toBe(true);
    run(s, T, names, rnd);
    const dead = s.ps.b;
    expect(dead.ghost).toBeFalsy();
    expect(dead.hand).toEqual([]);
    expect(dead.play).toEqual([]);
    const seen = [...s.deck, ...s.discard, ...s.order.flatMap((id) => [...s.ps[id].hand, ...s.ps[id].play.map((c) => c.id)])];
    expect(new Set(seen).size).toBe(seen.length);
    void respond;
  });

  it("Cò Quay Nga: a Barrel success for one player does not make the next prompts need 0 Trượt!", () => {
    const names = (i: string) => i;
    const T = 1_000_000;
    const rnd = () => 0.3;
    const s = newBangGame(["a", "b", "c", "d"], T, { packs: ["fistful"] }, rnd);
    for (const id of s.order) pickCharacter(s, id, s.picks[id][0], T, names, rnd);
    for (const id of s.order) {
      s.ps[id].char = "sid";
      s.ps[id].hand = [];
      s.ps[id].play = [];
      s.ps[id].life = 4;
      s.ps[id].max = 4;
    }
    s.ps.a.role = "sheriff";
    s.ps.b.role = "outlaw";
    s.ps.c.role = "outlaw";
    s.ps.d.role = "renegade";
    const barrel = s.deck.find((c) => CARDS[c].key === "barrel")!;
    s.deck.splice(s.deck.indexOf(barrel), 1);
    s.ps.a.play.push({ id: barrel });
    const heart = s.deck.find((c) => CARDS[c].suit === "H")!;
    s.deck.splice(s.deck.indexOf(heart), 1);
    s.deck.unshift(heart);
    s.events = ["roulette"];
    s.event = null;
    s.queue = [];
    startTurn(s, "a", T, false);
    run(s, T, names, rnd);
    // a's Barrel saves a; b has no Trượt! and loses 2 life; the game is waiting for a's move, not looping.
    expect(s.ps.b.life).toBe(2);
    expect(s.queue).toEqual([]);
    expect(s.deadline).not.toBeNull();
    expect(s.turn).toMatchObject({ player: "a", step: "play" });
  });
});
