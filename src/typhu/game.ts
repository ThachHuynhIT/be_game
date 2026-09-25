import {
  AIR_RENT,
  BOARD,
  BOARD_SIZE,
  CHANCE,
  CHEST,
  type CardEffect,
  GO_SALARY,
  JAIL_FINE,
  JAIL_POS,
  MAX_HOUSES,
  MIN_PLAYERS,
  type Ownable,
  UTIL_MULT,
  groupPositions,
  isOwnable,
  mortgageValue,
  unmortgageCost,
} from "./board";

/**
 * Cờ Tỷ Phú (Monopoly-style) state machine. Pure and timer-free: `now` and
 * `random` are passed in; `tickGame()` handles turn timeouts, absent players,
 * expired trade offers and the optional time limit.
 * Simplifications vs. the box rules: no auctions (an unbought square stays with
 * the bank), unlimited houses, and building only on your own turn.
 */

/** Time for each step of a turn (roll, buy, end). */
export const STEP_MS = 30_000;
/** Time to raise money when you owe more than you have. */
export const DEBT_MS = 60_000;
export const TRADE_MS = 30_000;
/** Offline players get played for after this long. */
export const ABSENT_MS = 2_500;
export const LOG_LIMIT = 16;

export type Phase = "roll" | "buy" | "debt" | "end";

export interface TPPlayerState {
  pos: number;
  cash: number;
  /** 0 = free; otherwise the number of failed escape rolls so far + 1. */
  jail: number;
  jailCards: ("chance" | "chest")[];
  bankrupt: boolean;
}

export interface Deed {
  owner: string;
  /** 0–4 houses, 5 = khách sạn. */
  houses: number;
  mortgaged: boolean;
}

export interface Debt {
  amount: number;
  /** Creditor seat id, or null for the bank. */
  to: string | null;
  /** "Pay every player" — amount is split evenly between these ids. */
  split?: string[];
  reason: string;
  /** Third failed jail roll: move this many squares once the fine is paid. */
  thenMove?: number;
}

export interface TradeSide {
  props: number[];
  cash: number;
}

export interface Trade {
  from: string;
  to: string;
  give: TradeSide;
  get: TradeSide;
  deadline: number;
}

export interface LogEntry {
  id: number;
  at: number;
  text: string;
  tone?: "money" | "bad" | "jail" | "card" | "info" | "buy";
}

export interface TPState {
  /** Turn order (seat order). */
  players: string[];
  ps: Record<string, TPPlayerState>;
  /** Owned squares by board position. */
  deeds: Record<number, Deed>;
  turn: string | null;
  phase: Phase;
  phaseAt: number;
  deadline: number | null;
  dice: [number, number] | null;
  /** Doubles rolled in a row this turn. */
  doubles: number;
  rollAgain: boolean;
  debt: Debt | null;
  trade: Trade | null;
  /** Card order (indices into CHANCE / CHEST), next card first. */
  chance: number[];
  chest: number[];
  lastCard: { deck: "chance" | "chest"; text: string; player: string; at: number } | null;
  /** Bankruptcy order, first out first. */
  out: string[];
  status: "playing" | "ended";
  finished: string[];
  startedAt: number;
  /** Epoch ms when the time limit ends the game, or null. */
  endsAt: number | null;
  log: LogEntry[];
  logSeq: number;
  recorded?: boolean;
  /** Room settings for this game. */
  stepMs?: number;
  /** Landing exactly on Khởi hành pays double. */
  doubleGo?: boolean;
  /** Taxes and fines pile up on Nghỉ chân; landing there collects them (null = rule off). */
  pot?: number | null;
}

const stepMs = (s: TPState) => s.stepMs ?? STEP_MS;

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };
export type NameOf = (id: string) => string;
export type Random = () => number;

const money = (n: number) => `${n.toLocaleString("vi-VN")}tr`;

function shuffled(n: number, random: Random) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newTPGame(
  players: string[],
  now: number,
  opts: { startCash: number; timeLimitMin: number; stepMs?: number; doubleGo?: boolean; parkingPot?: boolean },
  random: Random = Math.random,
): TPState {
  if (players.length < MIN_PLAYERS) throw new Error("need at least 2 players");
  const s: TPState = {
    players: [...players],
    ps: Object.fromEntries(players.map((id) => [id, { pos: 0, cash: opts.startCash, jail: 0, jailCards: [], bankrupt: false }])),
    deeds: {},
    turn: players[Math.floor(random() * players.length)],
    phase: "roll",
    phaseAt: now,
    deadline: now + (opts.stepMs ?? STEP_MS),
    ...(opts.stepMs ? { stepMs: opts.stepMs } : {}),
    ...(opts.doubleGo ? { doubleGo: true } : {}),
    pot: opts.parkingPot ? 0 : null,
    dice: null,
    doubles: 0,
    rollAgain: false,
    debt: null,
    trade: null,
    chance: shuffled(CHANCE.length, random),
    chest: shuffled(CHEST.length, random),
    lastCard: null,
    out: [],
    status: "playing",
    finished: [],
    startedAt: now,
    endsAt: opts.timeLimitMin > 0 ? now + opts.timeLimitMin * 60_000 : null,
    log: [],
    logSeq: 0,
  };
  return s;
}

function log(s: TPState, now: number, text: string, tone?: LogEntry["tone"]) {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, tone }].slice(-LOG_LIMIT);
}

function setPhase(s: TPState, phase: Phase, now: number) {
  s.phase = phase;
  s.phaseAt = now;
  s.deadline = now + (phase === "debt" ? DEBT_MS : stepMs(s));
}

export const active = (s: TPState) => s.players.filter((id) => !s.ps[id].bankrupt);

const ownedBy = (s: TPState, id: string) =>
  Object.entries(s.deeds)
    .filter(([, d]) => d.owner === id)
    .map(([pos]) => Number(pos));

const sq = (pos: number) => BOARD[pos] as Ownable;

function ownsGroup(s: TPState, id: string, pos: number) {
  const b = BOARD[pos];
  if (b.kind !== "prop") return false;
  return groupPositions(b.group).every((p) => s.deeds[p]?.owner === id);
}

/** Rent owed by landing on `pos`. `diceTotal` is used by utilities. */
export function rentFor(s: TPState, pos: number, diceTotal: number, mult: "air2" | "util10" | null = null): number {
  const d = s.deeds[pos];
  const b = BOARD[pos];
  if (!d || d.mortgaged) return 0;
  if (b.kind === "prop") {
    if (d.houses > 0) return b.rent[d.houses];
    return ownsGroup(s, d.owner, pos) ? b.rent[0] * 2 : b.rent[0];
  }
  const count = ownedBy(s, d.owner).filter((p) => BOARD[p].kind === b.kind).length;
  if (b.kind === "air") return AIR_RENT[count - 1] * (mult === "air2" ? 2 : 1);
  if (b.kind === "util") return diceTotal * (mult === "util10" ? 10 : UTIL_MULT[count - 1]);
  return 0;
}

/** Assets at face value: cash + land price (half if mortgaged) + building cost. Ranks players when time runs out. */
export function netWorth(s: TPState, id: string) {
  let total = s.ps[id].cash;
  for (const pos of ownedBy(s, id)) {
    const d = s.deeds[pos];
    const b = sq(pos);
    total += d.mortgaged ? mortgageValue(b) : b.price;
    if (b.kind === "prop") total += d.houses * b.house;
  }
  return total;
}

/** Cash a player could raise right now by selling every building and mortgaging everything. */
export function liquidValue(s: TPState, id: string) {
  let total = s.ps[id].cash;
  for (const pos of ownedBy(s, id)) {
    const d = s.deeds[pos];
    const b = sq(pos);
    if (!d.mortgaged) total += mortgageValue(b);
    if (b.kind === "prop") total += (d.houses * b.house) / 2;
  }
  return total;
}

// ─── Movement & landing ──────────────────────────────────────────────

function moveTo(s: TPState, id: string, pos: number, now: number, names: NameOf, passGo = true) {
  const p = s.ps[id];
  if (passGo && (pos < p.pos || (pos === 0 && p.pos !== 0))) {
    const salary = s.doubleGo && pos === 0 ? GO_SALARY * 2 : GO_SALARY;
    p.cash += salary;
    log(s, now, `${names(id)} ${pos === 0 ? "dừng đúng" : "qua"} Khởi hành, nhận ${money(salary)}`, "money");
  }
  p.pos = pos;
}

function sendToJail(s: TPState, id: string, now: number, names: NameOf) {
  const p = s.ps[id];
  p.pos = JAIL_POS;
  p.jail = 1;
  s.rollAgain = false;
  s.doubles = 0;
  log(s, now, `🚔 ${names(id)} vào tù!`, "jail");
}

/** Resolve the square `id` stands on. May set the phase to buy / debt. */
function land(s: TPState, id: string, now: number, names: NameOf, random: Random, mult: "air2" | "util10" | null = null) {
  const p = s.ps[id];
  const b = BOARD[p.pos];
  if (isOwnable(b)) {
    const d = s.deeds[p.pos];
    if (!d) {
      setPhase(s, "buy", now);
      return;
    }
    if (d.owner === id) return;
    if (d.mortgaged) {
      log(s, now, `${b.name} đang thế chấp — ${names(id)} không phải trả tiền`, "info");
      return;
    }
    let dice = (s.dice?.[0] ?? 0) + (s.dice?.[1] ?? 0);
    if (mult === "util10") {
      const r: [number, number] = [roll1(random), roll1(random)];
      dice = r[0] + r[1];
      log(s, now, `${names(id)} tung ${r[0]} + ${r[1]} cho tiền điện nước`, "info");
    }
    const rent = rentFor(s, p.pos, dice, mult);
    charge(s, id, rent, d.owner, `tiền thuê ${b.name}`, now, names);
    return;
  }
  switch (b.kind) {
    case "tax":
      charge(s, id, b.amount, null, b.name.toLowerCase(), now, names);
      return;
    case "gotojail":
      sendToJail(s, id, now, names);
      return;
    case "chance":
    case "chest":
      drawDeckCard(s, id, b.kind, now, names, random);
      return;
    case "parking":
      if (s.pot) {
        p.cash += s.pot;
        log(s, now, `☕ ${names(id)} nghỉ chân và hốt quỹ ${money(s.pot)}!`, "money");
        s.pot = 0;
      }
      return;
    case "parking":
      if (s.pot) {
        p.cash += s.pot;
        log(s, now, `☕ ${names(id)} nghỉ chân và hốt quỹ ${money(s.pot)}!`, "money");
        s.pot = 0;
      }
      return;
    default:
      return;
  }
}

function drawDeckCard(s: TPState, id: string, deck: "chance" | "chest", now: number, names: NameOf, random: Random) {
  const order = s[deck];
  const idx = order.shift()!;
  const card = (deck === "chance" ? CHANCE : CHEST)[idx];
  s.lastCard = { deck, text: card.text, player: id, at: now };
  log(s, now, `${deck === "chance" ? "❓" : "🎁"} ${names(id)}: ${card.text}`, "card");
  if (card.effect.kind === "jailcard") {
    s.ps[id].jailCards.push(deck);
    // The card stays out of the deck while someone holds it.
    return;
  }
  order.push(idx);
  applyEffect(s, id, card.effect, now, names, random);
}

function applyEffect(s: TPState, id: string, e: CardEffect, now: number, names: NameOf, random: Random) {
  const p = s.ps[id];
  switch (e.kind) {
    case "money":
      if (e.amount >= 0) p.cash += e.amount;
      else charge(s, id, -e.amount, null, "thẻ bài", now, names);
      return;
    case "goto":
      moveTo(s, id, e.pos, now, names);
      land(s, id, now, names, random);
      return;
    case "back":
      p.pos = (p.pos - e.steps + BOARD_SIZE) % BOARD_SIZE;
      land(s, id, now, names, random);
      return;
    case "jail":
      sendToJail(s, id, now, names);
      return;
    case "repairs": {
      let total = 0;
      for (const pos of ownedBy(s, id)) {
        const h = s.deeds[pos].houses;
        total += h === MAX_HOUSES ? e.hotel : h * e.house;
      }
      if (total > 0) charge(s, id, total, null, "sửa nhà", now, names);
      else log(s, now, `${names(id)} chưa có nhà nào — không mất gì`, "info");
      return;
    }
    case "each": {
      const others = active(s).filter((x) => x !== id);
      if (e.amount < 0) {
        const total = -e.amount * others.length;
        if (total > 0) charge(s, id, total, null, "khao mọi người", now, names, others);
      } else {
        for (const o of others) collectFrom(s, o, id, e.amount, now, names);
      }
      return;
    }
    case "nearest": {
      let pos = p.pos;
      do pos = (pos + 1) % BOARD_SIZE;
      while (BOARD[pos].kind !== e.target);
      moveTo(s, id, pos, now, names);
      land(s, id, now, names, random, e.target === "air" ? "air2" : "util10");
      return;
    }
  }
}

/** `payer` owes `amount`. Pays now if they can, otherwise opens a debt (or forces it for non-current players). */
function charge(s: TPState, payer: string, amount: number, to: string | null, reason: string, now: number, names: NameOf, split?: string[]) {
  if (amount <= 0) return;
  const p = s.ps[payer];
  if (p.cash >= amount) {
    pay(s, payer, amount, to, split);
    log(s, now, `${names(payer)} trả ${money(amount)} ${reason}${to ? ` cho ${names(to)}` : ""}`, "bad");
    return;
  }
  s.debt = { amount, to, split, reason };
  setPhase(s, "debt", now);
  log(s, now, `${names(payer)} nợ ${money(amount)} ${reason} — cần bán nhà hoặc thế chấp`, "bad");
}

/** Money paid to the bank as a tax or fine — goes to the Nghỉ chân pot when that rule is on. */
function toBank(s: TPState, amount: number) {
  if (typeof s.pot === "number") s.pot += amount;
}

function pay(s: TPState, payer: string, amount: number, to: string | null, split?: string[]) {
  s.ps[payer].cash -= amount;
  if (!to && !split?.length) toBank(s, amount);
  if (to) s.ps[to].cash += amount;
  else if (split?.length) {
    const each = Math.floor(amount / split.length);
    for (const id of split) if (!s.ps[id].bankrupt) s.ps[id].cash += each;
  }
}

/** Someone who is not taking their turn owes the current player (birthday card). Auto-sells if needed. */
function collectFrom(s: TPState, payer: string, to: string, amount: number, now: number, names: NameOf) {
  if (s.ps[payer].cash < amount) autoLiquidate(s, payer, amount, now, names);
  if (s.ps[payer].cash >= amount) {
    pay(s, payer, amount, to);
    log(s, now, `${names(payer)} mừng ${names(to)} ${money(amount)}`, "money");
  } else {
    bankrupt(s, payer, to, now, names);
  }
}

/** Sell buildings, then mortgage, until `target` cash is reached (or nothing is left). */
function autoLiquidate(s: TPState, id: string, target: number, now: number, names: NameOf) {
  const p = s.ps[id];
  const mine = () => ownedBy(s, id);
  while (p.cash < target) {
    const built = mine()
      .filter((pos) => s.deeds[pos].houses > 0)
      .sort((a, b) => s.deeds[b].houses - s.deeds[a].houses);
    if (!built.length) break;
    const pos = built[0];
    s.deeds[pos].houses -= 1;
    p.cash += (sq(pos) as Extract<Ownable, { kind: "prop" }>).house / 2;
  }
  while (p.cash < target) {
    const free = mine().filter((pos) => !s.deeds[pos].mortgaged);
    if (!free.length) break;
    free.sort((a, b) => sq(a).price - sq(b).price);
    s.deeds[free[0]].mortgaged = true;
    p.cash += mortgageValue(sq(free[0]));
  }
  log(s, now, `${names(id)} được bán tài sản tự động để trả nợ`, "info");
}

function bankrupt(s: TPState, id: string, creditor: string | null, now: number, names: NameOf) {
  const p = s.ps[id];
  if (p.bankrupt) return;
  // Buildings go back to the bank at half price first.
  for (const pos of ownedBy(s, id)) {
    const d = s.deeds[pos];
    const b = sq(pos);
    if (d.houses && b.kind === "prop") p.cash += (d.houses * b.house) / 2;
    d.houses = 0;
  }
  const toPlayer = creditor && !s.ps[creditor].bankrupt ? creditor : null;
  for (const pos of ownedBy(s, id)) {
    if (toPlayer) s.deeds[pos].owner = toPlayer;
    else delete s.deeds[pos];
  }
  if (toPlayer) s.ps[toPlayer].cash += Math.max(0, p.cash);
  for (const deck of p.jailCards) s[deck].push(deck === "chance" ? CHANCE.findIndex((c) => c.effect.kind === "jailcard") : CHEST.findIndex((c) => c.effect.kind === "jailcard"));
  p.jailCards = [];
  p.cash = 0;
  p.jail = 0;
  p.bankrupt = true;
  s.out.push(id);
  if (s.trade && (s.trade.from === id || s.trade.to === id)) s.trade = null;
  log(s, now, `💸 ${names(id)} phá sản${toPlayer ? `, toàn bộ tài sản về tay ${names(toPlayer)}` : ""}!`, "bad");
  if (active(s).length <= 1) {
    endGame(s, now, names);
    return;
  }
  if (s.turn === id) {
    s.debt = null;
    nextTurn(s, now, names);
  }
}

function endGame(s: TPState, now: number, names: NameOf, byTime = false) {
  const alive = active(s).sort((a, b) => netWorth(s, b) - netWorth(s, a));
  s.finished = [...alive, ...[...s.out].reverse()];
  s.status = "ended";
  s.turn = null;
  s.deadline = null;
  s.debt = null;
  s.trade = null;
  log(s, now, byTime ? `⏰ Hết giờ! ${names(alive[0])} giàu nhất và thắng cuộc` : `🏆 ${names(alive[0])} là tỷ phú cuối cùng!`, "money");
}

function nextTurn(s: TPState, now: number, names: NameOf) {
  const order = s.players;
  let i = order.indexOf(s.turn ?? order[0]);
  for (let k = 0; k < order.length; k++) {
    i = (i + 1) % order.length;
    if (!s.ps[order[i]].bankrupt) break;
  }
  s.turn = order[i];
  s.doubles = 0;
  s.rollAgain = false;
  s.dice = null;
  s.debt = null;
  setPhase(s, "roll", now);
  void names;
}

/** After a move is fully resolved (no buy / debt pending). */
function afterResolve(s: TPState, now: number) {
  if (s.status !== "playing") return;
  if (s.phase === "buy" || s.phase === "debt") return;
  setPhase(s, s.rollAgain ? "roll" : "end", now);
}

const roll1 = (random: Random) => 1 + Math.floor(random() * 6);

// ─── Player commands ────────────────────────────────────────────────

function myTurn(s: TPState, id: string, phase?: Phase | Phase[]): Result | null {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.turn !== id) return fail("Chưa đến lượt bạn");
  if (phase) {
    const ok = Array.isArray(phase) ? phase.includes(s.phase) : s.phase === phase;
    if (!ok) return fail("Không thể làm vậy lúc này");
  }
  return null;
}

export function rollDice(s: TPState, id: string, now: number, names: NameOf, random: Random = Math.random): Result {
  const bad = myTurn(s, id, "roll");
  if (bad) return bad;
  const p = s.ps[id];
  const d: [number, number] = [roll1(random), roll1(random)];
  s.dice = d;
  const isDouble = d[0] === d[1];
  const total = d[0] + d[1];
  s.lastCard = null;
  log(s, now, `🎲 ${names(id)} tung ${d[0]} + ${d[1]}${isDouble ? " (đôi!)" : ""}`, "info");
  s.rollAgain = false;
  if (p.jail > 0) {
    if (isDouble) {
      p.jail = 0;
      log(s, now, `${names(id)} tung đôi và ra tù`, "jail");
    } else if (p.jail >= 3) {
      p.jail = 0;
      log(s, now, `${names(id)} hết 3 lượt trong tù, phải nộp phạt ${money(JAIL_FINE)}`, "jail");
      if (p.cash < JAIL_FINE) {
        s.debt = { amount: JAIL_FINE, to: null, reason: "tiền phạt ra tù", thenMove: total };
        setPhase(s, "debt", now);
        return OK;
      }
      p.cash -= JAIL_FINE;
      toBank(s, JAIL_FINE);
    } else {
      p.jail += 1;
      setPhase(s, "end", now);
      return OK;
    }
  } else if (isDouble) {
    s.doubles += 1;
    if (s.doubles >= 3) {
      log(s, now, `${names(id)} tung đôi 3 lần liền — quá tốc độ!`, "jail");
      sendToJail(s, id, now, names);
      setPhase(s, "end", now);
      return OK;
    }
    s.rollAgain = true;
  }
  step(s, id, total, now, names, random);
  return OK;
}

function step(s: TPState, id: string, total: number, now: number, names: NameOf, random: Random) {
  const p = s.ps[id];
  moveTo(s, id, (p.pos + total) % BOARD_SIZE, now, names);
  s.phase = "end"; // provisional; land() may switch to buy / debt
  land(s, id, now, names, random);
  if (s.turn === id && s.ps[id].jail > 0) s.rollAgain = false;
  if (s.phase === "end" || s.phase === "roll") afterResolve(s, now);
}

export function buySquare(s: TPState, id: string, now: number, names: NameOf): Result {
  const bad = myTurn(s, id, "buy");
  if (bad) return bad;
  const p = s.ps[id];
  const b = BOARD[p.pos];
  if (!isOwnable(b) || s.deeds[p.pos]) return fail("Ô này không mua được");
  if (p.cash < b.price) return fail(`Không đủ tiền (cần ${money(b.price)})`);
  p.cash -= b.price;
  s.deeds[p.pos] = { owner: id, houses: 0, mortgaged: false };
  log(s, now, `🏷️ ${names(id)} mua ${b.name} giá ${money(b.price)}`, "buy");
  s.phase = "end";
  afterResolve(s, now);
  return OK;
}

export function skipBuy(s: TPState, id: string, now: number, names: NameOf): Result {
  const bad = myTurn(s, id, "buy");
  if (bad) return bad;
  log(s, now, `${names(id)} không mua ${BOARD[s.ps[id].pos].name}`, "info");
  s.phase = "end";
  afterResolve(s, now);
  return OK;
}

export function endTurn(s: TPState, id: string, now: number, names: NameOf): Result {
  const bad = myTurn(s, id, "end");
  if (bad) return bad;
  nextTurn(s, now, names);
  return OK;
}

export function payJail(s: TPState, id: string, useCard: boolean, now: number, names: NameOf): Result {
  const bad = myTurn(s, id, "roll");
  if (bad) return bad;
  const p = s.ps[id];
  if (!p.jail) return fail("Bạn không ở trong tù");
  if (useCard) {
    const deck = p.jailCards.shift();
    if (!deck) return fail("Bạn không có thẻ ra tù");
    s[deck].push((deck === "chance" ? CHANCE : CHEST).findIndex((c) => c.effect.kind === "jailcard"));
    log(s, now, `🗝️ ${names(id)} dùng thẻ ra tù`, "jail");
  } else {
    if (p.cash < JAIL_FINE) return fail(`Cần ${money(JAIL_FINE)} để nộp phạt`);
    p.cash -= JAIL_FINE;
    toBank(s, JAIL_FINE);
    log(s, now, `${names(id)} nộp ${money(JAIL_FINE)} để ra tù`, "jail");
  }
  p.jail = 0;
  s.deadline = now + stepMs(s);
  return OK;
}

/** Pay the open debt once enough cash has been raised. */
export function payDebt(s: TPState, id: string, now: number, names: NameOf, random: Random = Math.random): Result {
  const bad = myTurn(s, id, "debt");
  if (bad) return bad;
  const debt = s.debt!;
  const p = s.ps[id];
  if (p.cash < debt.amount) return fail(`Còn thiếu ${money(debt.amount - p.cash)} — hãy bán nhà hoặc thế chấp`);
  pay(s, id, debt.amount, debt.to, debt.split);
  log(s, now, `${names(id)} trả xong ${money(debt.amount)} ${debt.reason}`, "bad");
  s.debt = null;
  if (debt.thenMove) {
    step(s, id, debt.thenMove, now, names, random);
    return OK;
  }
  s.phase = "end";
  afterResolve(s, now);
  return OK;
}

export function declareBankrupt(s: TPState, id: string, now: number, names: NameOf): Result {
  const bad = myTurn(s, id, "debt");
  if (bad) return bad;
  bankrupt(s, id, s.debt?.to ?? null, now, names);
  return OK;
}

/** Only the player whose turn it is may build / sell / mortgage (or a player sorting out a debt). */
function canManage(s: TPState, id: string, pos: number): Result | null {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.turn !== id) return fail("Chỉ quản lý tài sản trong lượt của mình");
  const d = s.deeds[pos];
  if (!d || d.owner !== id) return fail("Đây không phải đất của bạn");
  return null;
}

export function build(s: TPState, id: string, pos: number, now: number, names: NameOf): Result {
  const bad = canManage(s, id, pos);
  if (bad) return bad;
  if (s.phase === "debt") return fail("Đang nợ — không xây được");
  const b = BOARD[pos];
  if (b.kind !== "prop") return fail("Chỉ xây nhà trên đất thành phố");
  if (!ownsGroup(s, id, pos)) return fail("Cần sở hữu cả nhóm màu mới được xây");
  const group = groupPositions(b.group);
  if (group.some((g) => s.deeds[g].mortgaged)) return fail("Có đất trong nhóm đang thế chấp");
  const d = s.deeds[pos];
  if (d.houses >= MAX_HOUSES) return fail("Đã có khách sạn");
  if (d.houses > Math.min(...group.map((g) => s.deeds[g].houses))) return fail("Phải xây đều các ô trong nhóm");
  if (s.ps[id].cash < b.house) return fail(`Cần ${money(b.house)} để xây`);
  s.ps[id].cash -= b.house;
  d.houses += 1;
  log(s, now, `🏠 ${names(id)} xây ${d.houses === MAX_HOUSES ? "khách sạn" : `nhà thứ ${d.houses}`} ở ${b.name}`, "buy");
  return OK;
}

export function sellHouse(s: TPState, id: string, pos: number, now: number, names: NameOf): Result {
  const bad = canManage(s, id, pos);
  if (bad) return bad;
  const b = BOARD[pos];
  const d = s.deeds[pos];
  if (b.kind !== "prop" || d.houses === 0) return fail("Không có nhà để bán");
  const group = groupPositions(b.group);
  if (d.houses < Math.max(...group.map((g) => s.deeds[g].houses))) return fail("Phải bán đều các ô trong nhóm");
  d.houses -= 1;
  s.ps[id].cash += b.house / 2;
  log(s, now, `${names(id)} bán 1 nhà ở ${b.name}, thu ${money(b.house / 2)}`, "info");
  return OK;
}

export function mortgage(s: TPState, id: string, pos: number, now: number, names: NameOf): Result {
  const bad = canManage(s, id, pos);
  if (bad) return bad;
  const d = s.deeds[pos];
  const b = sq(pos);
  if (d.mortgaged) return fail("Đã thế chấp rồi");
  if (b.kind === "prop" && groupPositions(b.group).some((g) => (s.deeds[g]?.houses ?? 0) > 0)) {
    return fail("Bán hết nhà trong nhóm trước khi thế chấp");
  }
  d.mortgaged = true;
  s.ps[id].cash += mortgageValue(b);
  log(s, now, `${names(id)} thế chấp ${b.name}, nhận ${money(mortgageValue(b))}`, "info");
  return OK;
}

export function unmortgage(s: TPState, id: string, pos: number, now: number, names: NameOf): Result {
  const bad = canManage(s, id, pos);
  if (bad) return bad;
  if (s.phase === "debt") return fail("Đang nợ — không chuộc được");
  const d = s.deeds[pos];
  const b = sq(pos);
  if (!d.mortgaged) return fail("Đất này không thế chấp");
  const cost = unmortgageCost(b);
  if (s.ps[id].cash < cost) return fail(`Cần ${money(cost)} để chuộc`);
  s.ps[id].cash -= cost;
  d.mortgaged = false;
  log(s, now, `${names(id)} chuộc lại ${b.name} (${money(cost)})`, "info");
  return OK;
}

// ─── Trading ────────────────────────────────────────────────────────

function cleanSide(raw: unknown): TradeSide | null {
  const r = raw as Partial<TradeSide> | null;
  if (!r || typeof r !== "object") return null;
  const props = Array.isArray(r.props) ? [...new Set(r.props.filter((x): x is number => Number.isInteger(x)))] : [];
  const cash = Number.isFinite(r.cash) ? Math.max(0, Math.floor(r.cash as number)) : 0;
  if (props.length > 28) return null;
  return { props, cash };
}

function checkSide(s: TPState, owner: string, side: TradeSide): string | null {
  if (s.ps[owner].cash < side.cash) return "Không đủ tiền cho giao dịch";
  for (const pos of side.props) {
    const d = s.deeds[pos];
    if (!d || d.owner !== owner) return "Có ô không thuộc về người đổi";
    const b = BOARD[pos];
    if (b.kind === "prop" && groupPositions(b.group).some((g) => (s.deeds[g]?.houses ?? 0) > 0)) {
      return `Phải bán hết nhà nhóm ${b.name} trước khi đổi`;
    }
  }
  return null;
}

export function proposeTrade(s: TPState, from: string, raw: { to?: unknown; give?: unknown; get?: unknown }, now: number, names: NameOf): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.trade) return fail("Đang có một lời mời đổi khác");
  const to = typeof raw.to === "string" ? raw.to : "";
  if (!s.ps[from] || s.ps[from].bankrupt) return fail("Bạn không còn trong ván");
  if (!s.ps[to] || s.ps[to].bankrupt || to === from) return fail("Chọn người để đổi");
  const give = cleanSide(raw.give);
  const get = cleanSide(raw.get);
  if (!give || !get) return fail("Giao dịch không hợp lệ");
  if (!give.props.length && !get.props.length) return fail("Giao dịch cần ít nhất một ô đất");
  const err = checkSide(s, from, give) ?? checkSide(s, to, get);
  if (err) return fail(err);
  s.trade = { from, to, give, get, deadline: now + TRADE_MS };
  log(s, now, `🤝 ${names(from)} mời ${names(to)} đổi đất`, "info");
  return OK;
}

export function answerTrade(s: TPState, id: string, accept: boolean, now: number, names: NameOf): Result {
  const t = s.trade;
  if (!t) return fail("Không có lời mời nào");
  if (id === t.from && !accept) {
    s.trade = null;
    log(s, now, `${names(id)} rút lời mời đổi`, "info");
    return OK;
  }
  if (id !== t.to) return fail("Lời mời này không dành cho bạn");
  if (!accept) {
    s.trade = null;
    log(s, now, `${names(id)} từ chối đổi với ${names(t.from)}`, "info");
    return OK;
  }
  const err = checkSide(s, t.from, t.give) ?? checkSide(s, t.to, t.get);
  if (err) {
    s.trade = null;
    return fail(err);
  }
  for (const pos of t.give.props) s.deeds[pos].owner = t.to;
  for (const pos of t.get.props) s.deeds[pos].owner = t.from;
  s.ps[t.from].cash += t.get.cash - t.give.cash;
  s.ps[t.to].cash += t.give.cash - t.get.cash;
  s.trade = null;
  log(s, now, `✅ ${names(t.from)} và ${names(t.to)} đã đổi đất`, "buy");
  return OK;
}

/** Kicked / left for good: goes bankrupt to the bank. */
export function forfeitPlayer(s: TPState, id: string, now: number, names: NameOf): Result {
  if (s.status !== "playing" || !s.ps[id] || s.ps[id].bankrupt) return fail("Người chơi không còn trong ván");
  bankrupt(s, id, null, now, names);
  return OK;
}

// ─── Timers ─────────────────────────────────────────────────────────

/** Play one automatic step for the current player (timeout or offline). */
function autoStep(s: TPState, now: number, names: NameOf, random: Random) {
  const id = s.turn!;
  switch (s.phase) {
    case "roll":
      rollDice(s, id, now, names, random);
      return;
    case "buy":
      skipBuy(s, id, now, names);
      return;
    case "end":
      endTurn(s, id, now, names);
      return;
    case "debt": {
      autoLiquidate(s, id, s.debt!.amount, now, names);
      if (s.ps[id].cash >= s.debt!.amount) payDebt(s, id, now, names, random);
      else bankrupt(s, id, s.debt!.to, now, names);
      return;
    }
  }
}

export function tickGame(s: TPState, now: number, names: NameOf, absent: (id: string) => boolean, random: Random = Math.random): boolean {
  if (s.status !== "playing") return false;
  let changed = false;
  if (s.trade && (now >= s.trade.deadline || absent(s.trade.to))) {
    log(s, now, `Lời mời đổi của ${names(s.trade.from)} đã hết hạn`, "info");
    s.trade = null;
    changed = true;
  }
  if (s.endsAt && now >= s.endsAt) {
    endGame(s, now, names, true);
    return true;
  }
  // One step per tick: an offline player's turn plays out a step every ABSENT_MS, so others can follow it.
  if (s.turn && (now >= (s.deadline ?? Infinity) || (absent(s.turn) && now >= s.phaseAt + ABSENT_MS))) {
    autoStep(s, now, names, random);
    changed = true;
  }
  return changed;
}

export function nextGameTickAt(s: TPState, now: number): number | null {
  if (s.status !== "playing") return null;
  // The absent-player check only matters while it is still ahead; afterwards the room's presence timer covers it.
  const absentAt = s.phaseAt + ABSENT_MS > now ? s.phaseAt + ABSENT_MS : null;
  const times = [s.deadline, absentAt, s.trade?.deadline, s.endsAt].filter((x): x is number => typeof x === "number");
  return times.length ? Math.min(...times) : null;
}
