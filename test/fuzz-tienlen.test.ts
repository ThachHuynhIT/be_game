import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { rankOf, shuffle, newDeck, RANK_TWO } from "../src/game/cards";
import { mirroredRankPoints } from "../src/game/scoring";
import { canBeat, detectCombo } from "../src/game/combos";
import { type GameState, activePlayers, autoAction, forfeit, hasBeatingPlay, newGame, pass, play } from "../src/game/game";
import {
  type RoomPlayer,
  type RoomState,
  heartbeat,
  isOnline,
  joinRoom,
  kickPlayer,
  leaveRoom,
  newRoom,
  passTurn,
  playCards,
  roomView,
  startGame,
  tick,
  updateSettings,
} from "../src/game/room";

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

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 40);
const T0 = 9_000_000;

/** Candidate plays from a hand: same-rank groups, straights, đôi thông, random subsets. */
function candidates(hand: number[], rand: () => number): number[][] {
  const out: number[][] = [];
  const byRank = new Map<number, number[]>();
  for (const c of hand) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  for (const cards of byRank.values()) for (let k = 1; k <= cards.length; k++) out.push(cards.slice(0, k));
  for (let start = 0; start < RANK_TWO; start++) {
    for (let len = 3; start + len <= RANK_TWO; len++) {
      const run: number[] = [];
      for (let r = start; r < start + len; r++) {
        const cs = byRank.get(r);
        if (!cs) break;
        run.push(cs[Math.floor(rand() * cs.length)]);
      }
      if (run.length === len) out.push(run);
    }
    for (let len = 3; start + len <= RANK_TWO; len++) {
      const run: number[] = [];
      for (let r = start; r < start + len; r++) {
        const cs = byRank.get(r);
        if (!cs || cs.length < 2) break;
        run.push(cs[0], cs[1]);
      }
      if (run.length === len * 2) out.push(run);
    }
  }
  for (let i = 0; i < 3; i++) out.push(shuffle(hand, rand).slice(0, 1 + Math.floor(rand() * 5)));
  return out;
}

/** Every subset of `hand` that is a combo able to beat `prev` (brute force). */
function bruteHasBeat(hand: number[], prev: ReturnType<typeof detectCombo>): boolean {
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const cards: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) cards.push(hand[i]);
    const combo = detectCombo(cards);
    if (combo && canBeat(prev, combo)) return true;
  }
  return false;
}

const stats = { games: 0, chop: 0, burned: 0, forfeit: 0, anyChop: 0 };
afterEach(() => vi.restoreAllMocks());
afterAll(() => { if (process.env.FUZZ_STATS) console.log(stats); });

describe("fuzz Tiến Lên engine", () => {
  for (const n of [2, 3, 4]) {
    it(`pure game with ${n} players: legal play only, terminates, cards conserved`, () => {
      for (let seed = 1; seed <= SEEDS * 5; seed++) {
        const rand = rng(seed * 31 + n);
        const players = Array.from({ length: n }, (_, i) => `p${i}`);
        const s = newGame(players, { random: rand, autoPass: rand() < 0.5 });
        let played = 0;
        const total = () => Object.values(s.hands).reduce((a, h) => a + h.length, 0);
        const ctx = (m: string) => `seed=${seed} n=${n}: ${m}`;
        if (s.instantWin) {
          expect(s.status, ctx("instant")).toBe("ended");
          expect(new Set(s.finished).size).toBe(n);
          continue;
        }
        for (let step = 0; s.status === "playing"; step++) {
          if (step > 3000) throw new Error(ctx("did not terminate"));
          const active = activePlayers(s);
          if (!s.turn || !active.includes(s.turn)) throw new Error(ctx(`bad turn ${s.turn}`));
          const r = rand();
          const who = r < 0.7 ? s.turn : players[Math.floor(rand() * n)];
          const before = JSON.stringify(s);
          if (r > 0.995 && active.length > 1) {
            const f = forfeit(s, who);
            if (f.ok) played += 0;
          } else if (r > 0.92) {
            // garbage
            const junk = [
              [99],
              [-1],
              [1.5],
              [],
              [s.hands[who][0], s.hands[who][0]],
              ...(s.lastPlay ? [] : [[]]),
              s.hands[players[(players.indexOf(who) + 1) % n]].slice(0, 1),
            ];
            const res = play(s, who, junk[Math.floor(rand() * junk.length)] as number[]);
            if (!res.ok && JSON.stringify(s) !== before) throw new Error(ctx("rejected play mutated state"));
            if (res.ok) {
              // an out-of-turn or odd play was accepted: it must at least have been a legal combo (counted below)
            }
          } else if (r > 0.8) {
            const res = pass(s, who);
            if (!res.ok && JSON.stringify(s) !== before) throw new Error(ctx("rejected pass mutated state"));
          } else if (r > 0.75) {
            autoAction(s, s.turn);
          } else {
            const cands = candidates(s.hands[who], rand);
            const cards = cands[Math.floor(rand() * cands.length)];
            const handBefore = s.hands[who].length;
            const res = play(s, who, cards);
            if (!res.ok && JSON.stringify(s) !== before) throw new Error(ctx("rejected play mutated state"));
            if (res.ok && s.hands[who].length !== handBefore - cards.length) throw new Error(ctx("hand size after play"));
          }
          // conservation: every card in exactly one hand or in the played pile (from move log)
          const seen = new Set<number>();
          for (const h of Object.values(s.hands)) for (const c of h) {
            if (seen.has(c) || c < 0 || c > 51) throw new Error(ctx("duplicate/invalid card"));
            seen.add(c);
          }
          const plays = (s.moves ?? []).filter((m) => m.kind === "play").reduce((a, m) => a + (m.cards?.length ?? 0), 0);
          if (total() + plays !== 13 * n) throw new Error(ctx(`cards ${total()} + played ${plays} != ${13 * n}`));
          played = plays;
          if (s.status === "playing") {
            const act = activePlayers(s);
            if (act.length < 2) throw new Error(ctx("playing with <2 active"));
            if (!s.turn || !act.includes(s.turn)) throw new Error(ctx(`turn ${s.turn} not active`));
            if (s.lastPlay && s.passed.includes(s.turn)) throw new Error(ctx("turn player already passed"));
            // autoPass must never skip someone who can beat the table (sampled)
            if (s.lastPlay && s.lastPlay.playerId !== s.turn && s.hands[s.turn].length <= 9 && step % 3 === 0) {
              const h = s.hands[s.turn];
              if (hasBeatingPlay(h, s.lastPlay.combo) !== bruteHasBeat(h, s.lastPlay.combo)) throw new Error(ctx(`hasBeatingPlay mismatch for ${h} vs ${JSON.stringify(s.lastPlay.combo)}`));
            }
          }
        }
        void played;
        if (s.chops?.length) stats.chop++;
        if (s.burned?.length) stats.burned++;
        if (s.forfeited?.length) stats.forfeit++;
        if (s.moves?.some((m) => m.kind === "play" && m.chop && m.player !== s.turn)) stats.anyChop++;
        stats.games++;
        expect(new Set(s.finished).size, ctx("finished unique")).toBe(n);
        expect(s.finished.length, ctx("finished size")).toBe(n);
        expect(s.turn).toBeNull();
        expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      }
    }, 60_000);
  }

  it("hasBeatingPlay agrees with brute force on random hands", () => {
    const rand = rng(777);
    for (let i = 0; i < 1200; i++) {
      const deck = shuffle(newDeck(), rand);
      const size = 4 + Math.floor(rand() * 7);
      const hand = deck.slice(0, size);
      // Previous combo: any combo from another hand, biased to structured ones.
      const other = deck.slice(20, 33);
      const cands = candidates(other, rand).map((c) => detectCombo(c)).filter((c): c is NonNullable<typeof c> => !!c);
      const prev = cands[Math.floor(rand() * cands.length)];
      expect(hasBeatingPlay(hand, prev), `hand=${hand} prev=${JSON.stringify(prev)}`).toBe(bruteHasBeat(hand, prev));
    }
  });
});

describe("fuzz Tiến Lên rooms", () => {
  for (const n of [2, 3, 4]) {
    it(`room with ${n} players: timeouts, kicks, scoring, views`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) runRoom(seed, n);
    }, 60_000);
  }
});

function runRoom(seed: number, n0: number) {
  const rand = rng(seed * 104729 + n0);
  vi.spyOn(Math, "random").mockImplementation(rand);
  let n = n0;
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
  let idc = 0;
  const room: RoomState = newRoom("FUZZT");
  let now = T0;
  let players: RoomPlayer[] = [];
  let online: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const r = joinRoom(room, `token-${seed}-${i}-xxxxxxxx`, `P${i}`, now, () => `id${++idc}`, `token-${seed}-${i}-xxxxxxxx`);
    if (!r.ok) throw new Error(r.error);
    players.push(r.player);
    online.push(true);
  }
  let steps = 0;
  const hist: string[] = [];
  const ctx = (m: string) => `seed=${seed} n=${n0}/${n} step=${steps}: ${m}\nlast: ${hist.slice(-10).join(" | ")}`;
  const check = () => {
    const g = room.game;
    if (!g) return;
    const seen = new Set<number>();
    for (const h of Object.values(g.hands)) for (const c of h) {
      if (seen.has(c)) throw new Error(ctx("dup card"));
      seen.add(c);
    }
    if (g.status === "playing") {
      if (!g.turn) throw new Error(ctx("playing without turn"));
      if (room.turnDeadline === null) throw new Error(ctx("playing without deadline"));
      if (!activePlayers(g).includes(g.turn)) throw new Error(ctx("turn is not active"));
    } else {
      if (room.turnDeadline !== null) throw new Error(ctx("deadline after end"));
      if (g.finished.length !== g.players.length || new Set(g.finished).size !== g.players.length) throw new Error(ctx(`bad finished ${g.finished}`));
    }
    if (steps % 5 === 0) {
      for (const p of players) {
        const v = roomView(room, p, now);
        const s = JSON.stringify(v);
        if (s.includes("token-")) throw new Error(ctx("token leak"));
        const own = new Set(g.hands[p.id] ?? []);
        if (v.hand.length !== own.size || v.hand.some((c) => !own.has(c))) throw new Error(ctx("hand view wrong"));
        if (/"hands"/.test(s)) throw new Error(ctx("raw hands in view"));
        for (const seat of v.seats) if (seat && seat.cardCount !== (g.hands[seat.id]?.length ?? 0)) throw new Error(ctx("cardCount"));
      }
      const sv = roomView(room, null, now);
      if (sv.hand.length) throw new Error(ctx("spectator sees a hand"));
      if (JSON.stringify(sv).includes("token-")) throw new Error(ctx("spectator token leak"));
    }
    if (steps % 23 === 0) {
      const rt = JSON.parse(JSON.stringify(room));
      try {
        expect(rt).toEqual(room);
      } catch (e) {
        const a = JSON.stringify(rt), b = JSON.stringify(room);
        let i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        throw new Error(ctx(`roundtrip differs: ${b.slice(Math.max(0, i - 100), i + 60)}  VS  ${a.slice(Math.max(0, i - 100), i + 60)}`));
      }
    }
  };

  for (let game = 0; game < 3; game++) {
    for (let i = 0; i < n; i++) {
      online[i] = true;
      heartbeat(room, players[i], now);
      players[i].lastSeen = now;
    }
    const host = players.find((p) => p.id === room.hostId)!;
    if (rand() < 0.5) updateSettings(room, host, { autoPass: rand() < 0.5, first: pick([1, 2, 5]), second: pick([0, 1]) });
    const gameNo = room.gameSeq ?? 0;
    const sg = startGame(room, host, now);
    if (!sg.ok) throw new Error(ctx(`start: ${sg.error}`));
    const pointsBefore = players.map((p) => p.points ?? 0);
    void pointsBefore;
    check();
    while (room.game!.status === "playing") {
      if (++steps > 4000) throw new Error(ctx("game did not terminate"));
      const g = room.game!;
      const r = rand();
      if (r < 0.55) {
        const actors = players.filter((_, i) => online[i]);
        if (!actors.length) {
          now += 30_000;
          tick(room, now);
          continue;
        }
        let p = pick(actors);
        if (rand() < 0.7) p = actors.find((a) => a.id === g.turn) ?? p;
        const before = JSON.stringify(room);
        let res;
        if (rand() < 0.2) {
          res = passTurn(room, p, now);
          hist.push(`${p.name} pass=>${res.ok ? "ok" : res.error}`);
        } else {
          const rr = rand();
          const hand = g.hands[p.id];
          const cards =
            rr < 0.1
              ? ("junk" as unknown)
              : rr < 0.2
                ? [60, -2, 1.5, "x"]
                : rr < 0.3
                  ? [hand[0], hand[0]]
                  : pick(candidates(hand, rand));
          res = playCards(room, p, cards, now);
          hist.push(`${p.name} play ${JSON.stringify(cards)}=>${res.ok ? "ok" : res.error}`);
        }
        if (!res.ok && JSON.stringify(room) !== before) throw new Error(ctx("rejected command mutated room"));
      } else if (r < 0.6) {
        const i = Math.floor(rand() * n);
        online[i] = !online[i];
        if (!online[i] && rand() < 0.3) leaveRoom(room, players[i], now);
        else if (online[i]) {
          const rj = joinRoom(room, players[i].token, players[i].name, now, () => `id${++idc}`, players[i].token);
          if (rj.ok) players[i] = rj.player;
        }
        hist.push(`toggle ${i} ${online[i]}`);
      } else {
        now += pick([100, 2000, 9000, 20000, 31000, 70000]);
        for (let i = 0; i < n; i++) if (online[i]) heartbeat(room, players[i], now);
        tick(room, now);
        hist.push(`tick ${now}`);
        const hostP = players.find((x) => x.id === room.hostId);
        if (hostP && rand() < 0.25) {
          for (const q of players) {
            if (q !== hostP && !isOnline(q, now) && rand() < 0.5) {
              const kr = kickPlayer(room, hostP, q.id, now);
              hist.push(`kick ${q.name} ${kr.ok ? "ok" : kr.error}`);
            }
          }
        }
        const g2 = room.game!;
        if (g2.status === "playing" && room.turnDeadline !== null) {
          const turnP = players.find((x) => x.id === g2.turn)!;
          if (now >= room.turnDeadline && isOnline(turnP, now)) throw new Error(ctx("turn timer expired but tick did not act"));
        }
      }
      check();
    }
    // ended: points
    const rec = room.history![room.history!.length - 1];
    expect(room.gameSeq).toBe(gameNo + 1);
    const sum = rec.results.reduce((a, x) => a + x.delta, 0);
    if (sum !== 0) throw new Error(ctx(`record not zero-sum ${JSON.stringify(rec)}`));
    expect(rec.results.map((x) => x.id)).toEqual(room.game!.finished);
    tick(room, now + 1);
    expect(room.gameSeq).toBe(gameNo + 1);
    expect(room.lastWinner).toBe(room.game!.finished[0]);
    now += 2000;
    // Next game: seat whoever is still around.
    players = room.seats.filter((s): s is RoomPlayer => !!s && !s.kicked);
    if (players.length < 2) break;
    n = players.length;
    online = players.map(() => true);
    for (const p of players) joinRoom(room, p.token, p.name, now, () => `id${++idc}`, p.token);
    if (!players.some((p) => p.id === room.hostId)) break;
  }
}

describe("Tiến Lên regressions found by fuzzing", () => {
  it("rank points never contain -0 (Nhì = 0 must survive a JSON round-trip)", () => {
    for (let n = 2; n <= 6; n++) {
      for (const second of [0, 1]) {
        const table = mirroredRankPoints(n, { first: 2, second });
        expect(table.some((x) => Object.is(x, -0)), `n=${n} second=${second}`).toBe(false);
      }
    }
  });
});
