import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESETS, maxPlayers } from "../src/meono/cards";
import type { MCard } from "../src/meono/cards";
import { forfeitPlayer, newMeoGame, nextGameTickAt, playCards, tickGame } from "../src/meono/game";
import {
  type MeoPlayer,
  type MeoRoom,
  isOnline,
  joinMeo,
  leaveMeo,
  meoCommand,
  meoHeartbeat,
  meoView,
  newMeoRoom,
  nextMeoTickAt,
  tickMeo,
} from "../src/meono/room";
import type { MeoCommand } from "../src/meono/protocol";

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

const T0 = 5_000_000;
const MAX_STEPS = 6000;
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 6);

function allCards(room: MeoRoom): MCard[] {
  const g = room.current!;
  const out: MCard[] = [...Object.values(g.hands).flat(), ...g.deck, ...g.discard];
  const c = g.choice;
  if (c) {
    if (c.kind === "defuse" || c.kind === "implode") out.push(c.kitten);
    if (c.kind === "alter") out.push(...c.cards);
    if (c.kind === "bury") out.push(c.card);
  }
  return out;
}

function runGame(seed: number, n: number) {
  const rand = rng(seed * 7919 + n);
  // All game randomness comes from `rand` (passed to the room functions); any Math.random left on the path would make a seed irreproducible.
  const spy = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Math.random reached from a seeded room-level run");
  });
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
  let idc = 0;
  const room = newMeoRoom("FUZZ1");
  let now = T0;
  const players: MeoPlayer[] = [];
  const online: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const r = joinMeo(room, `token-${seed}-${i}-xxxxxxxx`, `P${i}`, now, () => `id${++idc}`);
    if (!r.ok) throw new Error(r.error);
    players.push(r.player);
    online.push(true);
  }
  const check = (label: string) => {
    const g = room.current;
    if (!g) return;
    if (room.hostId === "") throw new Error("no host");
    const cards = allCards(room);
    const ids = new Set(cards.map((c) => c.id));
    if (ids.size !== cards.length) throw new Error(`${label}: duplicate card ids`);
    if (g.status === "playing" && cards.length !== initialCount) throw new Error(`${label}: card count ${cards.length} != ${initialCount} choice=${g.choice?.kind} pending=${g.pending?.kind} out=${g.out} turn=${g.turn}`);
    if (g.status === "playing") {
      if (!g.turn || g.out.includes(g.turn)) throw new Error(`${label}: turn is ${g.turn} (out=${g.out})`);
      if (g.pending && g.choice) throw new Error(`${label}: pending and choice at once`);
      if (g.turnsLeft < 1) throw new Error(`${label}: turnsLeft ${g.turnsLeft}`);
      const alive = g.players.filter((p) => !g.out.includes(p));
      if (alive.length < 2) throw new Error(`${label}: playing with ${alive.length} alive`);
    } else {
      if (g.finished.length !== g.players.length || new Set(g.finished).size !== g.players.length)
        throw new Error(`${label}: bad finished ${JSON.stringify(g.finished)} of ${g.players.length}`);
    }
    for (const out of g.out) if (g.hands[out]?.length) throw new Error(`${label}: out player holds cards`);
    // views never leak other hands / tokens
    if (steps % 6 !== 0) return;
    for (const p of players) {
      const v = meoView(room, p, now);
      const own = new Set((g.hands[p.id] ?? []).map((c) => c.id));
      const alterIds = new Set(v.alter?.map((c) => c.id) ?? []);
      const otherIds = new Set(
        Object.entries(g.hands)
          .filter(([id]) => id !== p.id)
          .flatMap(([, h]) => h.map((c) => c.id)),
      );
      for (const c of v.hand) if (c.id >= 0 && !own.has(c.id)) throw new Error(`${label}: foreign card in hand view`);
      for (const id of alterIds) if (otherIds.has(id)) throw new Error(`${label}: alter leaks`);
      const s = JSON.stringify(v);
      if (s.includes("token-")) throw new Error(`${label}: token leaked`);
      if (/"hands"|"deck":\[/.test(s)) throw new Error(`${label}: raw state in view`);
      if (v.current && v.current.deckCount !== g.deck.length) throw new Error("deckCount");
    }
    const sv = JSON.stringify(meoView(room, null, now));
    if (sv.includes("token-")) throw new Error("spectator token leak");
  };
  let initialCount = 0;
  let steps = 0;
  const hist: string[] = [];
  const fail = (e: unknown, extra: string) => {
    throw new Error(`seed=${seed} n=${n} step=${steps}: ${(e as Error).message ?? e}\n${extra}\nlast: ${hist.slice(-12).join(" | ")}`);
  };

  const randomCmd = (p: MeoPlayer): MeoCommand => {
    const g = room.current!;
    const hand = g.hands[p.id] ?? [];
    const anyCard = () => (hand.length && rand() < 0.9 ? pick(hand).id : Math.floor(rand() * 200) - 20);
    const others = () => pick(rand() < 0.1 ? ["nobody", p.id, ...g.players] : g.players.filter((x) => x !== p.id));
    const types: string[] = ["taco", "attack", "exploding", "defuse", "nope", "zzz", "imploding", "melon", "future"];
    const roll = rand();
    if (g.choice) {
      const c = g.choice;
      const mine = c.kind === "favor" ? c.from === p.id : c.player === p.id;
      if (mine || rand() < 0.1) {
        if (c.kind === "defuse" || c.kind === "implode" || c.kind === "bury")
          return { type: "insert", position: pick([0, 1, g.deck.length, g.deck.length + 3, -1, Math.floor(rand() * (g.deck.length + 1)), NaN as number]) };
        if (c.kind === "alter") {
          const ids = c.cards.map((x) => x.id);
          for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
          }
          return { type: "alter", order: rand() < 0.85 ? ids : ids.slice(1) };
        }
        if (c.kind === "dig") return { type: "dig", keep: rand() < 0.5 };
        return { type: "give", card: anyCard() };
      }
    }
    if (roll < 0.12) return { type: "nope", card: anyCard() };
    if (roll < 0.15) return { type: "see", card: anyCard() };
    if (roll < 0.2) return { type: "give", card: anyCard() };
    if (roll < 0.23) return { type: "alter", order: [1, 2, 3] };
    if (roll < 0.25) return { type: "dig", keep: true };
    if (roll < 0.28) return { type: "insert", position: 2 };
    if (roll < 0.3) return { type: "mplay", cards: "garbage" as unknown as number[] };
    if (roll < 0.33) return { type: "mplay", cards: [anyCard(), anyCard()], target: others(), named: pick(types) as never };
    if (roll < 0.35) return { type: "mplay", cards: [1.5, NaN, -3] as number[] };
    if (roll < 0.36) return { type: "mplay", cards: [] };
    if (roll < 0.37) return { type: "bogus" } as unknown as MeoCommand;
    if (roll < 0.4) return { type: "kick", playerId: pick(players).id };
    if (roll < 0.41) return { type: "settings", turnSeconds: pick([5, 30]), preset: pick(["classic", "nope", ...PRESETS.map((x) => x.id)]) };
    if (roll < 0.43) return { type: "start" };
    if (g.turn === p.id || rand() < 0.1) {
      const r2 = rand();
      if (r2 < 0.4) return { type: "draw" };
      const kind = rand();
      const byType = (t: string) => hand.filter((c) => c.type === t);
      const groups = new Map<string, MCard[]>();
      for (const c of hand) groups.set(c.type, [...(groups.get(c.type) ?? []), c]);
      const target = pick(g.players.filter((x) => x !== p.id));
      const named = pick([...hand.map((c) => c.type), "taco", "defuse"]) as never;
      if (kind < 0.55) return { type: "mplay", cards: [anyCard()], target, named };
      if (kind < 0.7) {
        const multi = [...groups.values()].filter((x) => x.length >= 2);
        if (multi.length) return { type: "mplay", cards: pick(multi).slice(0, 2).map((c) => c.id), target, named };
      }
      if (kind < 0.8) {
        const multi = [...groups.values()].filter((x) => x.length >= 3);
        if (multi.length) return { type: "mplay", cards: pick(multi).slice(0, 3).map((c) => c.id), target, named };
      }
      if (kind < 0.9) {
        const distinct = [...groups.values()].map((x) => x[0].id);
        if (distinct.length >= 5) return { type: "mplay", cards: distinct.slice(0, 5), target, named: (g.discard.length ? pick(g.discard).type : "taco") as never };
      }
      const cats = hand.filter((c) => ["taco", "melon", "potato", "beard", "rainbow", "feral"].includes(c.type));
      if (cats.length >= 2) return { type: "mplay", cards: cats.slice(0, 2 + Math.floor(rand() * 2)).map((c) => c.id), target, named };
      void byType;
      return { type: "draw" };
    }
    return { type: "nope", card: anyCard() };
  };

  try {
    for (let game = 0; game < 2; game++) {
      // Start a game.
      for (;;) {
        const preset = pick(PRESETS.filter((x) => n >= x.minPlayers && n <= x.maxPlayers));
        const host = room.seats.find((p) => p?.id === room.hostId)!;
        room.settings = { ...(room.settings ?? ({} as never)), preset: preset.id, turnSeconds: pick([15, 30]), nopeSeconds: pick([3.5, 7]), first: 2, second: 1 } as never;
        // everyone back online for the start
        for (let i = 0; i < n; i++) {
          online[i] = true;
          meoHeartbeat(room, players[i].token, now);
          players[i].lastSeen = now;
        }
        const res = meoCommand(room, host.token, { type: "start" }, now, rand);
        if (!res.ok) throw new Error(`start failed: ${res.error}`);
        break;
      }
      initialCount = allCards(room).length;
      const startPoints = players.map((p) => p.points);
      void startPoints;
      check("start");
      const gameNo = room.gameSeq ?? 0;
      while (room.current!.status === "playing") {
        if (++steps > MAX_STEPS) throw new Error(`game did not terminate: ${JSON.stringify({ turn: room.current!.turn, pending: room.current!.pending?.kind, choice: room.current!.choice?.kind, deck: room.current!.deck.length, out: room.current!.out })}`);
        const r = rand();
        if (r < 0.58) {
          // a player acts
          const g = room.current!;
          const actors = players.filter((_, i) => online[i]);
          if (!actors.length) continue;
          let p = pick(actors);
          if (rand() < 0.6) {
            const wanted = g.choice ? (g.choice.kind === "favor" ? g.choice.from : g.choice.player) : g.pending ? undefined : g.turn;
            const w = actors.find((a) => a.id === wanted);
            if (w) p = w;
          }
          const cmd = randomCmd(p);
          const norm = (_k: string, v: unknown) => (_k === "cursed" || _k === "curseOrder") && (Array.isArray(v) ? !v.length : v && !Object.keys(v as object).length) ? undefined : v;
          const before = JSON.stringify(room, norm);
          const res = meoCommand(room, p.token, cmd, now, rand);
          hist.push(`${p.name}:${JSON.stringify(cmd)}=>${res.ok ? "ok" : res.error}`);
          if (!res.ok && cmd.type !== "start") {
            const after = JSON.stringify(room, norm);
            if (before !== after) {
              let i = 0;
              while (before[i] === after[i]) i++;
              throw new Error(`rejected command mutated state: ${JSON.stringify(cmd)} (${res.error}) at ${before.slice(Math.max(0, i - 80), i + 60)} ==> ${after.slice(Math.max(0, i - 80), i + 60)}`);
            }
          }
          // an `ok` game end must have been scored
        } else if (r < 0.62) {
          const i = Math.floor(rand() * n);
          if (rand() < 0.5) {
            online[i] = !online[i];
            if (!online[i] && rand() < 0.3) leaveMeo(room, players[i].token, now, rand);
            if (online[i]) {
              const rj = joinMeo(room, players[i].token, players[i].name, now, () => `id${++idc}`);
              if (rj.ok) players[i] = rj.player;
            }
            hist.push(`toggle ${i} -> ${online[i]}`);
          }
        } else {
          now += pick([50, 400, 1500, 4000, 8000, 16000, 31000]);
          for (let i = 0; i < n; i++) if (online[i]) meoHeartbeat(room, players[i].token, now);
          const before = room.current!.turn;
          tickMeo(room, now, rand);
          hist.push(`tick +${now}`);
          // The host kicks anyone who dropped off (their seat forfeits mid-game).
          const hostP = players.find((x) => x.id === room.hostId);
          if (hostP && rand() < 0.3) {
            for (const q of players) {
              if (q !== hostP && !isOnline(q, now) && rand() < 0.5) {
                const kr = meoCommand(room, hostP.token, { type: "kick", playerId: q.id }, now, rand);
                hist.push(`kick ${q.name}=>${kr.ok ? "ok" : kr.error}`);
              }
            }
          }
          const g = room.current!;
          if (g.status === "playing") {
            const nt = nextGameTickAt(g);
            if (nt === null) throw new Error("playing but nextGameTickAt null");
            if (nt <= now) {
              const owner = g.choice ? (g.choice.kind === "favor" ? g.choice.from : g.choice.player) : g.turn;
              const p = players.find((x) => x.id === owner)!;
              if (!g.pending && isOnline(p, now) === false) {
                /* absent players are auto-played on the next tick; ok */
              } else throw new Error(`timer due (${nt} <= ${now}) but tick did not resolve it`);
            }
            void before;
            void nextMeoTickAt;
          }
        }
        check(`step${steps}`);
        if (steps % 29 === 0) {
          const copy = JSON.parse(JSON.stringify(room));
          expect(copy).toEqual(room);
        }
      }
      // game ended: scoring
      const rec = room.history![room.history!.length - 1];
      expect(room.gameSeq).toBe(gameNo + 1);
      const sum = rec.results.reduce((a, r) => a + r.delta, 0);
      if (sum !== 0) throw new Error(`score not zero-sum: ${JSON.stringify(rec)}`);
      if (rec.results.length !== room.current!.players.length) throw new Error("record size");
      // timers idle once ended
      if (room.current!.turnDeadline !== null) throw new Error("deadline after end");
      if (nextGameTickAt(room.current!) !== null) throw new Error("ended game still schedules");
      tickMeo(room, now + 1000, rand);
      expect(room.gameSeq).toBe(gameNo + 1);
      // drop kicked/left players so the next game can start with the remaining seated players
      now += 1000;
      if (room.seats.filter(Boolean).length < 2) break;
      n = room.seats.filter(Boolean).length;
      players.length = 0;
      online.length = 0;
      for (const s of room.seats) if (s) {
        players.push(s);
        online.push(true);
      }
      // Re-attach everyone (heartbeat) so nobody is stale.
      for (const p of players) {
        if (p.kicked) continue;
        joinMeo(room, p.token, p.name, now, () => `id${++idc}`);
      }
      if (players.some((p) => p.kicked)) break;
    }
  } catch (e) {
    fail(e, "");
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("fuzz Mèo Nổ", () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    it(`random play with ${n} players terminates and keeps invariants`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) runGame(seed, n);
    }, 60_000);
  }
});

describe("Mèo Nổ regressions found by fuzzing", () => {
  const names = (id: string) => id;

  it("playing the same card id twice is rejected instead of throwing", () => {
    const s = newMeoGame(["a", "b"], T0, [], () => 0.5);
    s.turn = "a";
    s.hands.a = [{ id: 900, type: "taco" }, { id: 901, type: "taco" }];
    const before = JSON.stringify(s);
    expect(playCards(s, "a", [900, 900], {}, T0, names).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(playCards(s, "a", [900, 901], { target: "b" }, T0, names).ok).toBe(true); // the genuine pair still works
  });

  it("kicking the player whose Dọn rác offer is open still passes the turn on", () => {
    const s = newMeoGame(["A", "B", "C"], T0, [], () => 0.3);
    s.turn = "A";
    s.choice = { kind: "offer", mode: "garbage", player: "A", queue: ["B", "C"], deadline: T0 + 10_000 };
    expect(forfeitPlayer(s, "A", T0, names).ok).toBe(true);
    expect(s.turn).not.toBe("A");
    expect(s.out).not.toContain(s.turn);
    expect(s.choice?.kind).toBe("offer"); // the others still give a card
    for (let t = 1; t <= 4; t++) tickGame(s, T0 + t * 100_000, names, () => false, () => 0.3);
    expect(s.status).toBe("playing");
    expect(s.out).not.toContain(s.turn);
  });

  it("every preset's player range can actually be dealt", () => {
    for (const p of PRESETS) {
      expect(p.maxPlayers, p.id).toBeLessThanOrEqual(maxPlayers(p.packs));
      for (const count of [p.minPlayers, p.maxPlayers]) {
        const ids = Array.from({ length: count }, (_, i) => `p${i}`);
        expect(() => newMeoGame(ids, T0, p.packs, () => 0.5), `${p.id} x${count}`).not.toThrow();
      }
    }
  });

  it("a kicked, cursed player leaves the curse list immediately", () => {
    const room = newMeoRoom("KCURS");
    let n = 0;
    const ps = [0, 1, 2].map((i) => {
      const r = joinMeo(room, `token-k-${i}-xxxxxxxx`, `P${i}`, T0, () => `k${++n}`);
      if (!r.ok) throw new Error(r.error);
      return r.player;
    });
    expect(meoCommand(room, ps[0].token, { type: "start" }, T0).ok).toBe(true);
    const g = room.current!;
    g.cursed = [ps[2].id];
    g.curseOrder = { [ps[2].id]: g.hands[ps[2].id].map((c) => c.id) };
    const later = T0 + 60_000;
    meoHeartbeat(room, ps[0].token, later);
    meoHeartbeat(room, ps[1].token, later);
    expect(meoCommand(room, ps[0].token, { type: "kick", playerId: ps[2].id }, later).ok).toBe(true);
    expect(room.current!.cursed ?? []).not.toContain(ps[2].id);
  });
});
