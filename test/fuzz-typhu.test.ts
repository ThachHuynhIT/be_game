import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANCE, CHEST, type MapSize, boardOf, groupPositions, isOwnable } from "../src/typhu/board";
import {
  type TPRules,
  type TPState,
  answerLoan,
  answerTrade,
  auctionMinNext,
  bid,
  build,
  buySquare,
  declareBankrupt,
  endTurn,
  forfeitPlayer,
  mortgage,
  newTPGame,
  payDebt,
  payJail,
  proposeLoan,
  proposeTrade,
  rollDice,
  sellHouse,
  sellLand,
  skipBuy,
  tickGame,
  unmortgage,
  LOG_LIMIT,
} from "../src/typhu/game";
import { joinTP, newTPRoom, tickTP, tpCommand, tpView } from "../src/typhu/room";
import type { TPCommand } from "../src/typhu/protocol";

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

function check(s: TPState, why: string) {
  const board = boardOf(s.map);
  const fail = (m: string) => {
    throw new Error(`${why}: ${m}\n${JSON.stringify({ ...s, log: s.log.slice(-6) })}`);
  };
  const holdersChance: number[] = [];
  let chanceHeld = 0;
  let chestHeld = 0;
  for (const id of s.players) {
    const p = s.ps[id];
    if (!Number.isInteger(p.cash) || p.cash < 0) fail(`cash ${id} ${p.cash}`);
    if (!Number.isInteger(p.pos) || p.pos < 0 || p.pos >= board.length) fail(`pos ${id} ${p.pos}`);
    if (p.bankrupt && (p.cash !== 0 || p.jail !== 0 || p.jailCards.length)) fail(`bankrupt leftovers ${id}`);
    if (s.out.includes(id) !== p.bankrupt) fail(`out list ${id}`);
    chanceHeld += p.jailCards.filter((c) => c === "chance").length;
    chestHeld += p.jailCards.filter((c) => c === "chest").length;
  }
  void holdersChance;
  if (s.chance.length + chanceHeld !== CHANCE.length || new Set(s.chance).size !== s.chance.length) fail(`chance deck ${s.chance.length}+${chanceHeld}`);
  if (s.chest.length + chestHeld !== CHEST.length || new Set(s.chest).size !== s.chest.length) fail(`chest deck ${s.chest.length}+${chestHeld}`);
  if (s.chance.some((i) => !(i >= 0 && i < CHANCE.length)) || s.chest.some((i) => !(i >= 0 && i < CHEST.length))) fail("deck index");
  for (const [k, d] of Object.entries(s.deeds)) {
    const pos = Number(k);
    const b = board[pos];
    if (!b || !isOwnable(b)) fail(`deed on non-ownable ${k}`);
    if (!s.ps[d.owner] || s.ps[d.owner].bankrupt) fail(`deed ${k} owner ${d.owner}`);
    if (!Number.isInteger(d.houses) || d.houses < 0 || d.houses > 5) fail(`houses ${k} ${d.houses}`);
    if (d.houses > 0 && b.kind !== "prop") fail(`houses on ${b.kind}`);
    if (d.mortgaged && d.houses > 0) fail(`mortgaged with houses ${k}`);
  }
  if (typeof s.pot === "number" && (!Number.isInteger(s.pot) || s.pot < 0)) fail(`pot ${s.pot}`);
  if (s.log.length > LOG_LIMIT) fail("log too long");
  if (s.dice && s.dice.some((x) => x < 1 || x > 6)) fail("dice");
  if (s.status === "playing") {
    if (!s.turn || !s.ps[s.turn] || s.ps[s.turn].bankrupt) fail(`turn ${s.turn}`);
    if (s.players.filter((x) => !s.ps[x].bankrupt).length < 2) fail("playing with <2 active");
    if ((s.phase === "debt") !== !!s.debt) fail(`debt/phase mismatch ${s.phase}`);
    if ((s.phase === "auction") !== !!s.auction) fail(`auction/phase mismatch ${s.phase}`);
    if (s.auction) {
      const a = s.auction;
      const b = board[a.pos];
      if (!b || !isOwnable(b) || s.deeds[a.pos]) fail(`auction on ${a.pos}`);
      if (s.turn && s.ps[s.turn].pos !== a.pos) fail("auction away from the turn player's square");
      if (a.deadline !== s.deadline) fail("auction deadline differs from the game's");
      const price = b && isOwnable(b) ? b.price : 0;
      if (a.start !== Math.ceil(price / 2) || !Number.isInteger(a.bid) || a.bid < a.start) fail(`auction price ${a.bid}`);
      if (a.bidder === null && a.bid !== a.start) fail("auction price without a bidder");
      if (a.bidder !== null && (!s.ps[a.bidder] || s.ps[a.bidder].bankrupt)) fail(`auction leader ${a.bidder} is gone`);
      if (auctionMinNext(a) <= a.bid && a.bidder !== null) fail("minNext");
      if (s.trade || s.loan) fail("offer during an auction");
    }
    if (s.debt) {
      if (!(s.debt.amount > 0) || !Number.isInteger(s.debt.amount)) fail("debt amount");
      if (s.debt.to !== null && (!s.ps[s.debt.to] || s.ps[s.debt.to].bankrupt)) fail(`debt creditor ${s.debt.to} is gone`);
    }
    if (s.deadline === null || !Number.isFinite(s.deadline)) fail("no deadline");
  } else {
    if (s.turn !== null || s.debt || s.trade || s.auction) fail("ended leftovers");
    if (s.finished.length !== s.players.length || new Set(s.finished).size !== s.players.length) fail("finished list");
  }
  for (const l of s.loans ?? []) {
    if (!s.ps[l.lender] || s.ps[l.lender].bankrupt || !s.ps[l.borrower] || s.ps[l.borrower].bankrupt) fail("loan with a bankrupt party");
    if (!(l.owed > l.amount) || l.left < 0 || l.left > 5) fail("loan numbers");
  }
  if (s.loan && s.status !== "playing") fail("loan after the end");
  if (s.trade) {
    const t = s.trade;
    if (!s.ps[t.from] || s.ps[t.from].bankrupt || !s.ps[t.to] || s.ps[t.to].bankrupt || t.from === t.to) fail("trade parties");
  }
}

const sum = (s: TPState) => s.players.reduce((a, id) => a + s.ps[id].cash, 0) + (s.pot ?? 0);

interface Cfg {
  n: number;
  map: MapSize;
  rules: Partial<TPRules>;
  doubleGo: boolean;
  pot: boolean;
  cash: number;
  limit: number;
  step: number;
}

function pickCfg(r: () => number, map: MapSize): Cfg {
  const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    n: 2 + Math.floor(r() * 5),
    map,
    rules: {
      buildRule: pk(["even", "chain"] as const),
      needGroup: r() < 0.5,
      bankruptTo: pk(["bank", "creditor"] as const),
      sellLand: r() < 0.5,
      jailRent: r() < 0.5,
      doubleRoll: r() < 0.7,
      risingCost: r() < 0.5,
      goSalary: pk([100, 200, 300, 400]),
      unmortgageFee: pk([0, 10, 20, 30]),
      landSalePct: pk([50, 70, 90]),
      auction: r() < 0.6,
    },
    doubleGo: r() < 0.5,
    pot: r() < 0.5,
    cash: pk([150, 400, 1000, 1500, 2500]),
    limit: pk([0, 0, 1, 2]),
    step: pk([0, 15_000, 45_000]),
  };
}

function runGame(seed: number, map: MapSize, maxOps: number): { ended: boolean } {
  const r = rng(seed);
  const cfg = pickCfg(r, map);
  const ids = Array.from({ length: cfg.n }, (_, i) => `p${i}`);
  let now = 1_000_000;
  let s = newTPGame(ids, now, { startCash: cfg.cash, timeLimitMin: cfg.limit, stepMs: cfg.step || undefined, doubleGo: cfg.doubleGo, parkingPot: cfg.pot, map: cfg.map, rules: cfg.rules }, r);
  const B = boardOf(s.map);
  const tag = (op: string, i: number) => `seed ${seed} map ${map} op#${i} ${op} cfg ${JSON.stringify(cfg)}`;
  const absentSet = new Set<string>();
  const absent = (id: string) => absentSet.has(id);
  const owned = (id: string) => Object.entries(s.deeds).filter(([, d]) => d.owner === id).map(([k]) => Number(k));
  const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const anyPos = (id: string) => {
    const mine = owned(id);
    if (mine.length && r() < 0.8) return pk(mine);
    return Math.floor(r() * (B.length + 6)) - 3;
  };
  const garbage = () => pk<unknown>([null, undefined, "x", -5, NaN, Infinity, 1e300, 2.5, [], {}, { props: "a", cash: "9" }, { props: [1, 1, 1.5, "a", null], cash: -3 }, { props: Array.from({ length: 40 }, (_, i) => i), cash: 0 }]);
  const side = (id: string) => ({ props: owned(id).filter(() => r() < 0.4), cash: Math.floor(r() * 400) * (r() < 0.9 ? 1 : 100) });

  for (let i = 0; i < maxOps && s.status === "playing"; i++) {
    const cur = s.turn!;
    const actor = r() < 0.75 ? cur : pk(ids);
    const roll = r();
    let op = "";
    let res: { ok: boolean } | boolean | null = null;
    const before = JSON.stringify(s);
    const cashBefore = sum(s);
    let isCmd = true;
    try {
      if (roll < 0.04) {
        op = "tick";
        isCmd = false;
        if (r() < 0.3) {
          if (absentSet.size < ids.length && r() < 0.5) absentSet.add(pk(ids));
          else absentSet.clear();
        }
        now += pk([100, 3000, 31_000, 61_000, 130_000]);
        tickGame(s, now, names, absent, r);
      } else if (roll < 0.40) {
        // natural move for the current player
        const a = cur;
        if (s.phase === "roll") {
          if (s.ps[a].jail && r() < 0.3) {
            op = "payjail";
            res = payJail(s, a, r() < 0.5, now, names);
          } else {
            op = "roll";
            res = rollDice(s, a, now, names, r);
          }
        } else if (s.phase === "buy") {
          if (r() < 0.6) {
            op = "buy";
            res = buySquare(s, a, now, names);
          } else {
            op = "skip";
            res = skipBuy(s, a, now, names);
          }
        } else if (s.phase === "end") {
          op = "end";
          res = endTurn(s, a, now, names);
        } else if (s.phase === "auction") {
          if (r() < 0.2) {
            // Let the clock run out.
            op = "auction-close";
            isCmd = false;
            now = Math.max(now, s.auction!.deadline) + 1;
            tickGame(s, now, names, absent, r);
          } else {
            op = "bid";
            const who = r() < 0.85 ? pk(ids) : (garbage() as string);
            const bigger = r() < 0.1;
            const amount = r() < 0.9 ? auctionMinNext(s.auction!) + 10 * Math.floor(r() * 6) + (bigger ? 1000 : 0) : garbage();
            const preBid = s.auction!.bid;
            const first = s.auction!.bidder === null;
            res = bid(s, who, amount, now, names);
            // The first bid may equal the start price; every later one must beat the leader.
            if (res.ok && ((first ? s.auction!.bid < preBid : s.auction!.bid <= preBid) || s.auction!.bidder !== who || s.auction!.deadline > now + 15_000)) throw new Error("bad bid result");
          }
        } else {
          const x = r();
          if (x < 0.4) {
            op = "paydebt";
            res = payDebt(s, a, now, names, r);
          } else if (x < 0.8) {
            op = "mortgage";
            res = mortgage(s, a, anyPos(a), now, names);
            if (res.ok && s.phase === "debt" && s.ps[a].cash >= s.debt!.amount && r() < 0.8) payDebt(s, a, now, names, r);
          } else {
            op = "bankrupt";
            res = declareBankrupt(s, a, now, names);
          }
        }
      } else {
        const x = Math.floor(r() * 17);
        switch (x) {
          case 0:
            op = "roll";
            res = rollDice(s, actor, now, names, r);
            break;
          case 1:
            op = "buy";
            res = buySquare(s, actor, now, names);
            break;
          case 2:
            op = "skip";
            res = skipBuy(s, actor, now, names);
            break;
          case 3:
            op = "end";
            res = endTurn(s, actor, now, names);
            break;
          case 4: {
            op = "build";
            const pos = anyPos(actor);
            const pre = B[pos]?.kind === "prop" ? groupPositions((B[pos] as Extract<(typeof B)[number], { kind: "prop" }>).group, B).filter((g) => s.deeds[g]?.owner === actor).map((g) => s.deeds[g].houses) : [];
            const preHere = s.deeds[pos]?.houses ?? 0;
            res = build(s, actor, pos, now, names);
            if (res.ok) {
              const d = s.deeds[pos];
              const b = B[pos] as Extract<(typeof B)[number], { kind: "prop" }>;
              const grp = groupPositions(b.group, B);
              const full = grp.every((g) => s.deeds[g]?.owner === actor);
              if (s.rules!.needGroup && !full) throw new Error("built without full group");
              if (!full && d.houses > 3) throw new Error("partial group above 3 houses");
              if (s.rules!.buildRule === "even") {
                if (preHere > Math.min(...pre)) throw new Error("uneven build " + pre);
              }
            }
            break;
          }
          case 5:
            op = "sell";
            res = sellHouse(s, actor, anyPos(actor), now, names);
            break;
          case 6:
            op = "sellland";
            res = sellLand(s, actor, anyPos(actor), now, names);
            break;
          case 7:
            op = "mortgage";
            res = mortgage(s, actor, anyPos(actor), now, names);
            break;
          case 8:
            op = "unmortgage";
            res = unmortgage(s, actor, anyPos(actor), now, names);
            break;
          case 9: {
            op = "trade";
            const to = r() < 0.9 ? pk(ids) : (garbage() as string);
            const raw = r() < 0.85 ? { to, give: side(actor), get: side(typeof to === "string" && s.ps[to] ? to : pk(ids)) } : { to, give: garbage(), get: garbage() };
            res = proposeTrade(s, actor, raw, now, names);
            if (res.ok) {
              const sum0 = sum(s);
              void sum0;
            }
            break;
          }
          case 10: {
            op = "tradeanswer";
            const t = s.trade;
            const who = t && r() < 0.8 ? (r() < 0.8 ? t.to : t.from) : actor;
            const total = sum(s);
            res = answerTrade(s, who, r() < 0.7, now, names);
            if (sum(s) !== total) throw new Error("trade changed total cash");
            break;
          }
          case 14:
            op = "loan";
            res = proposeLoan(s, actor, { to: r() < 0.9 ? pk(ids) : garbage(), amount: r() < 0.9 ? Math.floor(r() * 400) : garbage(), rate: r() < 0.8 ? pk([10, 20]) : garbage() }, now, names);
            break;
          case 15: {
            op = "loananswer";
            const o = s.loan;
            const who = o && r() < 0.8 ? (r() < 0.8 ? o.to : o.from) : actor;
            const total = sum(s);
            res = answerLoan(s, who, r() < 0.7, now, names);
            if (sum(s) !== total) throw new Error("loan changed total cash");
            break;
          }
          case 16: {
            op = "bid";
            res = bid(s, actor, r() < 0.9 && s.auction ? auctionMinNext(s.auction) + 10 * Math.floor(r() * 4) : garbage(), now, names);
            break;
          }
          case 11:
            op = "paydebt";
            res = payDebt(s, actor, now, names, r);
            if (res.ok && sum(s) > cashBefore) throw new Error("paydebt created money");
            break;
          case 12:
            op = "payjail";
            res = payJail(s, actor, r() < 0.5, now, names);
            break;
          default:
            op = r() < 0.8 ? "bankrupt" : "forfeit";
            res = op === "bankrupt" ? declareBankrupt(s, actor, now, names) : forfeitPlayer(s, actor, now, names);
        }
      }
      if (isCmd && res && typeof res === "object" && !res.ok && JSON.stringify(s) !== before) throw new Error("refused command mutated state");
      if (r() < 0.05) {
        const copy = JSON.parse(JSON.stringify(s)) as TPState;
        expect(copy).toEqual(s);
        s = copy;
      }
      check(s, `after ${op}`);
    } catch (e) {
      throw new Error(`${tag(op, i)}: ${(e as Error).message}`);
    }
  }
  return { ended: s.status === "ended" };
}

function autoPlay(seed: number, map: MapSize, maxTicks: number) {
  // Nobody acts: every step must come from tickGame; each tick past the deadline must progress.
  const r = rng(seed);
  const cfg = pickCfg(r, map);
  const ids = Array.from({ length: cfg.n }, (_, i) => `p${i}`);
  let now = 5_000_000;
  const s = newTPGame(ids, now, { startCash: cfg.cash, timeLimitMin: cfg.limit, stepMs: cfg.step || undefined, doubleGo: cfg.doubleGo, parkingPot: cfg.pot, map: cfg.map, rules: cfg.rules }, r);
  let ticks = 0;
  for (; ticks < maxTicks && s.status === "playing"; ticks++) {
    now = Math.max(now + 1, s.deadline ?? now, s.trade?.deadline ?? 0) + 1;
    if (s.endsAt) now = Math.min(now, Math.max(s.endsAt, now - 0));
    const snap = JSON.stringify(s);
    const changed = tickGame(s, now, names, () => false, r);
    if (!changed || JSON.stringify(s) === snap) throw new Error(`seed ${seed} map ${map}: tick at ${now} did not progress (phase ${s.phase}, deadline ${s.deadline})`);
    check(s, `seed ${seed} map ${map} autoplay tick ${ticks}`);
  }
  return { ended: s.status === "ended", ticks, limit: cfg.limit };
}

const MAPS: MapSize[] = ["std", "large", "huge"];
/** Deeper runs: FUZZ_SEEDS=200 npx vitest run test/fuzz-typhu.test.ts */
const SEEDS = Number(process.env.FUZZ_SEEDS) > 0 ? Number(process.env.FUZZ_SEEDS) : 120;

describe("fuzz typhu: random commands from random players", () => {
  for (const map of MAPS) {
    it(`map ${map}`, () => {
      let ended = 0;
      for (let seed = 1; seed <= SEEDS; seed++) if (runGame(seed * 7 + MAPS.indexOf(map), map, 700).ended) ended++;
      expect(ended).toBeGreaterThan(0);
    }, 20_000);
  }
});

describe("fuzz typhu: pure timeouts auto-play", () => {
  for (const map of MAPS) {
    it(`map ${map}: every tick progresses and timed games end`, () => {
      for (let seed = 1; seed <= Math.ceil(SEEDS / 4); seed++) {
        const res = autoPlay(seed * 13 + MAPS.indexOf(map), map, 2500);
        if (res.limit > 0) expect(res.ended, `seed ${seed} limit ${res.limit} ticks ${res.ticks}`).toBe(true);
      }
    }, 20_000);
  }
});

describe("fuzz typhu: room level (join, settings, pick, start, commands, tick) never leaks tokens", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs", () => {
    // Every random step must come from the seeded `r` passed to the room functions, so a seed is reproducible.
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random reached from a seeded room-level run");
    });
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed * 101);
      const room = newTPRoom("FZ" + seed);
      let now = 1_000_000;
      let id = 0;
      const tokens: string[] = [];
      const n = 2 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const tok = `token-secret-${seed}-${i}-abcdef`;
        tokens.push(tok);
        expect(joinTP(room, tok, `P${i}`, now, () => `id${id++}`, tok, r).ok).toBe(true);
      }
      const pk = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      const maps = ["std", "large", "huge"];
      const host = tokens[0];
      tpCommand(room, host, { type: "settings", map: pk(maps) as MapSize, timeLimit: pk([20, 30]), stepSeconds: 15, startCash: pk([1000, 1500]), buildRule: pk(["even", "chain"]) as "even", needGroup: r() < 0.5, auction: r() < 0.7, bankruptTo: pk(["bank", "creditor"]) as "bank", parkingPot: r() < 0.5, doubleGo: r() < 0.5 }, now, r);
      for (const t of tokens) tpCommand(room, t, { type: "pick", emoji: pk(["🛵", "🐃", "🚲", "🚤", "🐉", "🎩", "🚗", "🐘"]), color: pk(["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"]) }, now, r);
      const emojis = room.seats.filter(Boolean).map((p) => tpView(room, p!, now).seats.find((x) => x?.id === p!.id)!.piece);
      expect(new Set(emojis.map((e) => e.emoji)).size).toBe(emojis.length);
      expect(new Set(emojis.map((e) => e.color)).size).toBe(emojis.length);
      expect(tpCommand(room, host, { type: "start" }, now, r).ok).toBe(true);
      const cmds = ["roll", "buy", "skip", "end", "payjail", "jailcard", "paydebt", "bankrupt"] as ("roll" | "buy" | "skip" | "end" | "payjail" | "jailcard" | "paydebt" | "bankrupt")[];
      for (let i = 0; i < 1500; i++) {
        const g = room.current!;
        const tok = r() < 0.7 && g.turn ? tokens[room.seats.findIndex((p) => p?.id === g.turn)] ?? pk(tokens) : pk(tokens);
        const x = r();
        let msg: TPCommand;
        const me = room.seats.find((p) => p?.token === tok)?.id ?? "";
        const mine = Object.entries(g.deeds).filter(([, d]) => d.owner === me).map(([k]) => Number(k));
        if (x < 0.5) msg = { type: cmds[Math.floor(r() * 4)] };
        else if (x < 0.6) msg = { type: pk(["build", "sell", "sellland", "mortgage", "unmortgage"] as const), pos: mine.length && r() < 0.8 ? pk(mine) : Math.floor(r() * 60) - 5 };
        else if (x < 0.7) msg = { type: pk(cmds) };
        else if (x < 0.8) msg = { type: "trade", to: pk(room.seats.filter(Boolean).map((p) => p!.id)), give: { props: mine.filter(() => r() < 0.5), cash: Math.floor(r() * 200) }, get: { props: Object.keys(g.deeds).map(Number).filter(() => r() < 0.2), cash: 0 } };
        else if (x < 0.85) msg = { type: "bid", amount: (g.auction ? g.auction.bid : 0) + 10 * (1 + Math.floor(r() * 5)) };
        else if (x < 0.9) msg = { type: "tradeanswer", accept: r() < 0.7 };
        else msg = { type: "garbage" } as unknown as TPCommand;
        try {
          tpCommand(room, tok, msg, now, r);
          if (r() < 0.3) {
            now += pk([1000, 20_000, 31_000, 70_000]);
            for (const p of room.seats) if (p && r() < 0.9) p.lastSeen = now;
            tickTP(room, now, r);
          }
          const view = JSON.stringify(room.seats.map((p) => tpView(room, p, now)).concat(tpView(room, null, now)));
          for (const t of tokens) if (view.includes(t)) throw new Error("token leaked in view");
          if (room.current) check(room.current, "room");
          if (room.current?.status === "ended") break;
        } catch (e) {
          throw new Error(`room seed ${seed} i ${i} msg ${JSON.stringify(msg)}: ${(e as Error).message}`);
        }
      }
    }
  }, 20_000);
});

describe("regression: debt creditor leaves mid-debt", () => {
  it("a forfeited creditor does not receive the debtor's payment", () => {
    const s = newTPGame(["a", "b", "c"], 1, { startCash: 1000, timeLimitMin: 0 }, () => 0);
    s.turn = "a";
    s.ps.a.cash = 10;
    s.phase = "debt";
    s.debt = { amount: 100, to: "b", reason: "test" };
    expect(forfeitPlayer(s, "b", 2, names).ok).toBe(true);
    s.ps.a.cash = 500;
    expect(payDebt(s, "a", 3, names).ok).toBe(true);
    check(s, "after");
    expect(s.ps.b.cash).toBe(0);
  });
});
