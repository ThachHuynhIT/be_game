import {
  CARD_TYPES,
  CHARACTERS,
  type CardKey,
  type CharKey,
  EVENTS,
  EVENT_DECK_SIZE,
  type EventKey,
  GEAR,
  GEAR_DECK,
  type GearKey,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Pack,
  ROLES_FOR,
  ROLE_INFO,
  type Role,
  SHOP_SLOTS,
  SUIT_SYMBOL,
  type Suit,
  THREE_PLAYER_TARGET,
  cardDef,
  deckFor,
  rankLabel,
  typeOf,
} from "./cards";
import type { DrawMode, PickSpec } from "./protocol";
import { applyEffect, autoAnswer } from "./actions";

/**
 * Đấu Súng (Bang!-style) state machine: the core — turns, the prompt queue, damage, deaths,
 * victory, draw! checks and distances. Card plays, powers and auto-play live in actions.ts.
 *
 * Pure and timer-free: `now` and `random` are passed in; `tickGame()` answers for players
 * who time out or go offline. Everything in the state is plain JSON (it lives in Redis),
 * so pending effects are data in `queue`, processed front first by `run()`.
 */

export const PICK_MS = 30_000;
export const TURN_MS = 60_000;
export const RESPOND_MS = 15_000;
export const ABSENT_MS = 2_500;
export const LOG_LIMIT = 30;
/** Bottom of the queue is safe from runaway loops (e.g. two players bouncing Phản Đòn). */
const MAX_STEPS = 500;

export type Result = { ok: true } | { ok: false; error: string };
export const fail = (error: string): Result => ({ ok: false, error });
export const OK: Result = { ok: true };
export type NameOf = (id: string) => string;
export type Random = () => number;

export interface InPlay {
  id: number;
  cubes?: number;
  fresh?: boolean;
}

export interface BPlayer {
  id: string;
  role: Role;
  char: CharKey;
  /** The other character dealt at the start (Danh Tính Mới). */
  alt: CharKey | null;
  life: number;
  max: number;
  hand: number[];
  play: InPlay[];
  /** Gold Rush equipment; `from` = who put a Truy Nã on you. */
  gear: { key: GearKey; from?: string }[];
  gold: number;
  cubes: number;
  dead: boolean;
  /** Hồn Ma card on them: takes turns, cannot lose life. */
  ghost?: boolean;
  /** Thị Trấn Ma: back for this one turn. */
  townGhost?: boolean;
  /** Abilities borrowed until their next turn (Vê Bắt Chước, Xám Nhiều Mặt). */
  borrowed?: CharKey[];
  diedAt?: number;
}

export type Answer = "missed" | "bang" | "evade";

/** Everything that can wait in the queue. Interactive entries have `to` and a deadline. */
export type QEntry =
  | {
      kind: "react";
      to: string;
      from: string | null;
      answer: Answer;
      cause: string;
      need: number;
      dmg: number;
      /** The attack was a BANG!-type shot (Treo Thưởng, Súng Hoa Cải, Mê-ri Máu…). */
      shot?: boolean;
      /** Barrel / Giò Đỏ May already rolled for this prompt. */
      rolled?: boolean;
      started?: boolean;
      unmissable?: boolean;
      /** Súng Săn Lớn: the target's cards in play don't help. */
      noGear?: boolean;
      /** Cards played to cause this: returned by Súng Kíp, … */
      card?: number | null;
      /** Đấu Tay Đôi: the other duellist (answers next). */
      duel?: string;
      /** Evading cancels the queue entries of this group. */
      group?: number;
      /** Đạn Nảy: the card in play that gets discarded instead of losing life. */
      targetCard?: number;
      /** Chuồn (or Mích with a Trượt!) cancels it (Da Đỏ, the first Đấu Tay Đôi prompt). */
      evadable?: boolean;
      deadline: number;
    }
  | { kind: "hurt"; to: string; from: string | null; amount: number; shot?: boolean; asked?: string[] }
  | { kind: "save"; to: string; target: string; from: string | null; amount: number; shot?: boolean; asked: string[]; deadline: number }
  | { kind: "store"; to: string; cards: number[]; order: string[]; deadline: number }
  | { kind: "pick"; to: string; from: string; mode: "take" | "discard"; cause: string; deadline: number }
  | { kind: "keep"; to: string; cards: number[]; keep: number; cause: "kit" | "dutch" | "poker"; deadline: number }
  | { kind: "discard"; to: string; count: number; orLose: number; cause: "bandidas" | "poker"; pool?: string; deadline: number }
  | { kind: "pokerEnd"; to: string; pool: number[] }
  | { kind: "copy"; to: string; options: CharKey[]; deadline: number }
  | { kind: "draw"; to: string; options: DrawMode[]; swap: boolean; blood: boolean; deadline: number }
  | { kind: "effect"; by: string; key: CardKey | "bottle-panic" | "bottle-bang" | "pardner-store" | "pardner-duel" | "pardner-cat"; target?: string; pick?: PickSpec; group?: number; card?: number | null; noGear?: boolean };

export interface TurnInfo {
  player: string;
  step: "start" | "draw" | "play";
  startStep: number;
  bangs: number;
  extraBangs: number;
  played: number;
  uses: Record<string, number>;
  bellTower?: boolean;
  bigFifty?: boolean;
  /** An extra turn (Báo Thù, Đông Chuông) can't grant another. */
  extra?: boolean;
  /** The last brown card played, for Li Bắn Lại. */
  lastBrown?: { key: CardKey; target?: string; target2?: string; pick?: PickSpec } | null;
  skip?: boolean;
  /** When the play phase times out (pushed back after every action). */
  deadline?: number;
}

export interface BangState {
  /** Seat order (clockwise), dead players included. */
  order: string[];
  ps: Record<string, BPlayer>;
  packs: Pack[];
  status: "picking" | "playing" | "ended";
  /** Character choice: each player's two options until they pick. */
  picks: Record<string, CharKey[]>;
  deck: number[];
  discard: number[];
  turn: TurnInfo | null;
  queue: QEntry[];
  /** When the head of the queue (or the turn) started waiting, for absent players. */
  phaseAt: number;
  deadline: number | null;
  events: EventKey[];
  event: EventKey | null;
  shop: GearKey[];
  shopDeck: GearKey[];
  winners: string[];
  finished: string[];
  groupSeq: number;
  deaths: number;
  /** 3-player variant (no Sheriff). */
  three: boolean;
  last: { seq: number; player: string | null; card: number | null; kind: "play" | "flip" | "hit" | "die" | "event"; target?: string | null } | null;
  log: { id: number; at: number; text: string; tone?: "bang" | "heal" | "death" | "event" | "info" | "gold" }[];
  logSeq: number;
  recorded?: boolean;
  turnMs: number;
  respondMs: number;
  forfeited?: string[];
  /** Characters already dealt or borrowed (Xám Nhiều Mặt draws from the rest). */
  usedChars: CharKey[];
}

// ─── Helpers ────────────────────────────────────────────────────────

export function shuffle<T>(a: T[], random: Random = Math.random): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function log(s: BangState, now: number, text: string, tone?: BangState["log"][number]["tone"]) {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, ...(tone ? { tone } : {}) }].slice(-LOG_LIMIT);
}

export function mark(s: BangState, kind: NonNullable<BangState["last"]>["kind"], player: string | null, card: number | null, target?: string | null) {
  s.last = { seq: (s.last?.seq ?? 0) + 1, player, card, kind, ...(target !== undefined ? { target } : {}) };
}

export const cardName = (id: number) => {
  const d = cardDef(id);
  return `${CARD_TYPES[d.key].name} ${rankLabel(d.rank)}${SUIT_SYMBOL[d.suit]}`;
};
export const keyOf = (id: number) => cardDef(id).key;
export const has = (s: BangState, event: EventKey) => s.event === event;
export const P = (s: BangState, id: string) => s.ps[id];

/** In the game and able to act: alive, or a ghost. */
export const present = (s: BangState, id: string) => {
  const p = s.ps[id];
  return !!p && (!p.dead || !!p.ghost || !!p.townGhost);
};
/** Truly alive (counts for victory, can lose life). */
export const alive = (s: BangState, id: string) => !!s.ps[id] && !s.ps[id].dead;
export const livingIds = (s: BangState) => s.order.filter((id) => alive(s, id));
export const presentIds = (s: BangState) => s.order.filter((id) => present(s, id));

/** Abilities a player has right now: their character plus anything borrowed. */
export function abilities(s: BangState, id: string): CharKey[] {
  const p = s.ps[id];
  if (!p) return [];
  return [p.char, ...(p.borrowed ?? [])];
}
export const hasAb = (s: BangState, id: string, key: CharKey) => present(s, id) && abilities(s, id).includes(key);
export const hasGear = (s: BangState, id: string, key: GearKey) => !!s.ps[id]?.gear.some((g) => g.key === key);

/** Do `owner`'s cards in play work right now? (Dây Thòng Lọng, Cô Ngôi Sao's turn.) */
export function gearActive(s: BangState, owner: string): boolean {
  if (has(s, "lasso")) return false;
  const t = s.turn?.player;
  if (t && t !== owner && hasAb(s, t, "belle")) return false;
  return true;
}

export function inPlay(s: BangState, owner: string, key: CardKey): InPlay | undefined {
  if (!gearActive(s, owner)) return undefined;
  return s.ps[owner].play.find((c) => keyOf(c.id) === key);
}

export function weaponRange(s: BangState, id: string): number {
  const gun = gearActive(s, id) ? s.ps[id].play.find((c) => typeOf(c.id).range) : undefined;
  return gun ? typeOf(gun.id).range! : 1;
}

/** Seat distance from `a` to `b` among players still in the game, with Mustang / Scope etc. */
export function distance(s: BangState, a: string, b: string, ignoreCards = false): number {
  if (a === b) return 0;
  if (has(s, "ambush")) return 1;
  const ring = presentIds(s);
  const i = ring.indexOf(a);
  const j = ring.indexOf(b);
  if (i < 0 || j < 0) return 99;
  const raw = Math.min(Math.abs(i - j), ring.length - Math.abs(i - j));
  let d = raw;
  if (!ignoreCards && inPlay(s, b, "mustang")) d += 1;
  if (!ignoreCards && inPlay(s, b, "hideout")) d += 1;
  if (hasAb(s, b, "paul")) d += 1;
  if (inPlay(s, a, "scope")) d -= 1;
  if (inPlay(s, a, "binocular")) d -= 1;
  if (hasAb(s, a, "rose")) d -= 1;
  return Math.max(1, d);
}

export function handLimit(s: BangState, id: string): number {
  const p = s.ps[id];
  let limit = p.dead ? p.max : p.life;
  if (hasAb(s, id, "sean")) limit = Math.max(limit, 10);
  if (hasGear(s, id, "ace")) limit += 2;
  return limit;
}

// ─── Cards moving around ───────────────────────────────────────────

/** Top of the deck, reshuffling the discard pile when it runs out. */
export function takeTop(s: BangState, random: Random = Math.random): number | null {
  if (!s.deck.length) {
    if (!s.discard.length) return null;
    s.deck = shuffle(s.discard, random);
    s.discard = [];
  }
  return s.deck.shift() ?? null;
}

export function draw(s: BangState, id: string, n: number, random: Random = Math.random): number[] {
  const got: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = takeTop(s, random);
    if (c === null) break;
    got.push(c);
  }
  s.ps[id].hand.push(...got);
  return got;
}

export function toDiscard(s: BangState, ...ids: number[]) {
  s.discard.push(...ids);
}

/** Remove a card from a hand; true if it was there. */
export function fromHand(s: BangState, id: string, card: number): boolean {
  const h = s.ps[id].hand;
  const i = h.indexOf(card);
  if (i < 0) return false;
  h.splice(i, 1);
  return true;
}

export function fromPlay(s: BangState, id: string, card: number): InPlay | null {
  const pl = s.ps[id].play;
  const i = pl.findIndex((c) => c.id === card);
  if (i < 0) return null;
  return pl.splice(i, 1)[0];
}

/** Su Xinh: an empty hand refills by one. */
export function suzy(s: BangState, random: Random = Math.random) {
  for (const id of s.order) {
    const p = s.ps[id];
    if (present(s, id) && !p.hand.length && hasAb(s, id, "suzy")) draw(s, id, 1, random);
  }
}

// ─── Draw! checks ──────────────────────────────────────────────────

export function effSuit(s: BangState, card: number): Suit {
  if (has(s, "blessing")) return "H";
  if (has(s, "curse")) return "S";
  return cardDef(card).suit;
}

/**
 * Flip for a "rút!" check. Lão Hên and Móng Ngựa flip extra cards and keep the good one.
 * Giôn Đau Đớn picks the flipped card up if he holds fewer than 6.
 */
export function flip(s: BangState, id: string, good: (card: number) => boolean, reason: string, now: number, names: NameOf, random: Random = Math.random): boolean {
  const n = 1 + (hasAb(s, id, "lucky") ? 1 : 0) + (hasGear(s, id, "horseshoe") ? 1 : 0);
  const flipped: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = takeTop(s, random);
    if (c !== null) flipped.push(c);
  }
  if (!flipped.length) return false;
  const chosen = flipped.find(good) ?? flipped[0];
  const ok = good(chosen);
  const john = s.order.find((j) => present(s, j) && hasAb(s, j, "johnpain") && s.ps[j].hand.length < 6);
  for (const c of flipped) {
    if (c === chosen && john) s.ps[john].hand.push(c);
    else toDiscard(s, c);
  }
  mark(s, "flip", id, chosen);
  log(s, now, `${names(id)} rút! (${reason}): ${cardName(chosen)} — ${ok ? "thành công" : "thất bại"}`, "info");
  return ok;
}

// ─── Queue ──────────────────────────────────────────────────────────

const INTERACTIVE = new Set<QEntry["kind"]>(["react", "save", "store", "pick", "keep", "discard", "copy", "draw"]);
export const isInteractive = (e: QEntry): e is Extract<QEntry, { deadline: number }> & { started?: boolean } => INTERACTIVE.has(e.kind);

export function respondMs(s: BangState) {
  return s.respondMs ?? RESPOND_MS;
}

/** Put entries at the front of the queue (they run before whatever was waiting). */
export function now_(s: BangState, ...entries: QEntry[]) {
  s.queue.unshift(...entries);
}
/** Append entries after everything already waiting. */
export function later(s: BangState, ...entries: QEntry[]) {
  s.queue.push(...entries);
}
export const newGroup = (s: BangState) => (s.groupSeq = (s.groupSeq ?? 0) + 1);

/** Deadline for a new interactive entry. */
export const until = (s: BangState, now: number) => now + respondMs(s);

/** Remove the head entry (after it has been answered). */
export function done(s: BangState, now: number) {
  s.queue.shift();
  s.phaseAt = now;
}

/**
 * Take an entry out of the queue because its player is gone, without losing what it held:
 * a Tạp Hoá passes on, Kít's cards go back, a Cứu Nguy window turns back into the damage.
 */
export function salvage(s: BangState, e: QEntry): QEntry[] {
  switch (e.kind) {
    case "store": {
      const order = e.order.filter((o) => present(s, o));
      if (order.length) return [{ ...e, to: order[0], order: order.slice(1), started: false } as QEntry];
      toDiscard(s, ...e.cards);
      return [];
    }
    case "keep":
      toDiscard(s, ...e.cards);
      return [];
    case "save":
      return [{ kind: "hurt", to: e.target, from: e.from, amount: e.amount, ...(e.shot ? { shot: true } : {}), asked: e.asked }];
    default:
      return [];
  }
}

/** Drop every queued entry of an evaded / finished group. */
export function dropGroup(s: BangState, group: number | undefined) {
  if (group === undefined) return;
  s.queue = s.queue.filter((e) => !("group" in e && e.group === group));
}

// ─── Damage, death, victory ────────────────────────────────────────

export function heal(s: BangState, id: string, amount: number) {
  const p = s.ps[id];
  if (p.dead) return 0;
  const before = p.life;
  p.life = Math.min(p.max, p.life + amount);
  return p.life - before;
}

export const beerWorks = (s: BangState) => livingIds(s).length > 2 && !has(s, "hangover") && !has(s, "reverend");

/** Apply `amount` damage now (saving windows are handled by the "hurt" queue entry). */
export function applyDamage(s: BangState, id: string, from: string | null, amount: number, shot: boolean, now: number, names: NameOf, random: Random) {
  const p = s.ps[id];
  if (!p || p.dead) return;
  for (let i = 0; i < amount; i++) {
    p.life -= 1;
    if (hasAb(s, id, "bart")) draw(s, id, 1, random);
    if (hasAb(s, id, "simeon")) p.gold += 1;
    if (hasGear(s, id, "luckycharm")) p.gold += 1;
    if (hasAb(s, id, "elgringo") && from && from !== id && present(s, from) && s.ps[from].hand.length) {
      const h = s.ps[from].hand;
      const c = h.splice(Math.floor(random() * h.length), 1)[0];
      p.hand.push(c);
    }
  }
  mark(s, "hit", from, null, id);
  log(s, now, `${names(id)} mất ${amount} máu${from && from !== id ? ` (do ${names(from)})` : ""} — còn ${Math.max(0, p.life)}`, "bang");
  if (shot && from && from !== id) {
    if (inPlay(s, id, "bounty") && present(s, from)) draw(s, from, 1, random);
    if (inPlay(s, from, "shotgun") && p.hand.length) toDiscard(s, p.hand.splice(Math.floor(random() * p.hand.length), 1)[0]);
  }
  if (hasAb(s, id, "julie") && from && from !== id && present(s, from) && p.life > 0) {
    if (flip(s, id, (c) => effSuit(s, c) === "H" || effSuit(s, c) === "D", "Giu-li bắn trả", now, names, random)) {
      now_(s, { kind: "react", to: from, from: id, answer: "missed", cause: "Giu-li bắn trả", need: 1, dmg: 1, shot: true, deadline: until(s, now) });
    }
  }
  if (p.life <= 0) dying(s, id, from, now, names, random);
  suzy(s, random);
}

/** At 0 life: Bia, Ly Cuối, Sít Liều Mạng save you if they can; otherwise you die. */
function dying(s: BangState, id: string, from: string | null, now: number, names: NameOf, random: Random) {
  const p = s.ps[id];
  const beerHeal = hasAb(s, id, "tequilajoe") ? 2 : 1;
  while (p.life <= 0) {
    const beer = beerWorks(s) ? p.hand.find((c) => keyOf(c) === "beer") : undefined;
    const last = p.hand.find((c) => keyOf(c) === "lastcall");
    if (beer !== undefined) {
      fromHand(s, id, beer);
      toDiscard(s, beer);
      p.life += beerHeal;
      beerSideEffects(s, id, now, names, random);
      log(s, now, `${names(id)} uống Bia cứu mạng`, "heal");
    } else if (last !== undefined) {
      fromHand(s, id, last);
      toDiscard(s, last);
      p.life += 1;
      log(s, now, `${names(id)} uống Ly Cuối cứu mạng`, "heal");
    } else if (hasAb(s, id, "sid") && p.hand.length >= 2) {
      toDiscard(s, ...p.hand.splice(0, 2));
      p.life += 1;
      log(s, now, `${names(id)} bỏ 2 lá để hồi 1 máu`, "heal");
    } else break;
  }
  p.life = Math.min(p.life, p.max);
  if (p.life <= 0) kill(s, id, from, now, names, random);
}

/** Bà Chủ Quán draws, Chanh Muối heals whenever someone drinks a Bia. */
export function beerSideEffects(s: BangState, drinker: string, now: number, names: NameOf, random: Random) {
  for (const id of s.order) {
    if (!present(s, id)) continue;
    if (hasAb(s, id, "madam")) draw(s, id, 1, random);
    if (id !== drinker && hasAb(s, id, "lemonade") && alive(s, id) && heal(s, id, 1)) log(s, now, `${names(id)} hồi 1 máu theo`, "heal");
  }
}

export function kill(s: BangState, id: string, killer: string | null, now: number, names: NameOf, random: Random) {
  const p = s.ps[id];
  if (hasAb(s, id, "teren")) {
    if (flip(s, id, (c) => effSuit(s, c) !== "S", "Tê Rèn Lì", now, names, random)) {
      p.life = 1;
      draw(s, id, 1, random);
      log(s, now, `${names(id)} gượng dậy với 1 máu`, "heal");
      return;
    }
  }
  p.dead = true;
  p.life = 0;
  p.ghost = false;
  s.deaths = (s.deaths ?? 0) + 1;
  p.diedAt = s.deaths;
  mark(s, "die", killer, null, id);
  log(s, now, `☠️ ${names(id)} đã chết — là ${ROLE_INFO[p.role].name}`, "death");

  // Their cards: Kền Kền takes everything, otherwise the discard pile.
  const cards = [...p.hand, ...p.play.map((c) => c.id)];
  p.hand = [];
  p.play = [];
  const vulture = s.order.find((v) => v !== id && alive(s, v) && hasAb(s, v, "vulture"));
  if (vulture) s.ps[vulture].hand.push(...cards);
  else toDiscard(s, ...cards);
  const wanted = p.gear.find((g) => g.key === "wanted");
  p.gear = [];

  if (killer && killer !== id && present(s, killer)) {
    if (wanted) {
      draw(s, killer, 2, random);
      s.ps[killer].gold += 1;
    }
    if (p.role === "outlaw" && !s.three) {
      draw(s, killer, 3, random);
      log(s, now, `${names(killer)} nhận thưởng 3 lá vì hạ Kẻ cướp`, "info");
    }
    if (s.ps[killer].role === "sheriff" && p.role === "deputy") {
      const k = s.ps[killer];
      toDiscard(s, ...k.hand, ...k.play.map((c) => c.id));
      k.hand = [];
      k.play = [];
      log(s, now, `${names(killer)} bắn nhầm Phó — phải bỏ hết bài`, "info");
    }
  }
  for (const o of s.order) {
    if (o === id || !alive(s, o)) continue;
    if (hasAb(s, o, "greg")) heal(s, o, 2);
    if (hasAb(s, o, "herb")) draw(s, o, 2, random);
  }
  // Whatever they still had to answer goes away (keeping the cards it held).
  s.queue = s.queue.flatMap((e) => ("to" in e && e.to === id && e.kind !== "pokerEnd" && e.kind !== "hurt" ? salvage(s, e) : [e]));
  checkWin(s, id, killer, now, names);
  if (s.status === "playing" && s.turn?.player === id && !p.townGhost) s.turn.skip = true;
}

/** Decide the game after a death. */
export function checkWin(s: BangState, dead: string, killer: string | null, now: number, names: NameOf) {
  const living = livingIds(s);
  const role = (id: string) => s.ps[id].role;
  let winners: string[] | null = null;
  if (has(s, "wildwestshow")) {
    if (living.length <= 1) winners = living;
  } else if (s.three) {
    if (killer && killer !== dead && THREE_PLAYER_TARGET[role(killer)] === role(dead)) winners = [killer];
    else if (living.length <= 1) winners = living;
  } else {
    const sheriffAlive = s.order.some((id) => role(id) === "sheriff" && alive(s, id));
    if (!sheriffAlive) {
      winners = living.length === 1 && role(living[0]) === "renegade" ? living : s.order.filter((id) => role(id) === "outlaw");
    } else if (!living.some((id) => role(id) === "outlaw" || role(id) === "renegade")) {
      winners = s.order.filter((id) => role(id) === "sheriff" || role(id) === "deputy");
    }
  }
  if (winners) finish(s, winners, now, names);
}

export function finish(s: BangState, winners: string[], now: number, names: NameOf) {
  s.status = "ended";
  s.winners = winners;
  const losers = s.order.filter((id) => !winners.includes(id));
  // Winners first (alive before dead), then the rest, the last to die higher.
  const byDeath = (a: string, b: string) => (s.ps[b].diedAt ?? 999) - (s.ps[a].diedAt ?? 999);
  s.finished = [...winners.slice().sort(byDeath), ...losers.slice().sort(byDeath)];
  s.turn = null;
  s.queue = [];
  s.deadline = null;
  log(s, now, `🏆 Thắng: ${winners.map(names).join(", ") || "không ai"}`, "event");
}

// ─── Setup ──────────────────────────────────────────────────────────

export interface BangOptions {
  packs: Pack[];
  turnMs?: number;
  respondMs?: number;
}

export function newBangGame(players: string[], now: number, opts: BangOptions, random: Random = Math.random): BangState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error("bad player count");
  const packs: Pack[] = ["base", ...opts.packs.filter((p) => p !== "base")];
  const roles = shuffle(ROLES_FOR[players.length], random);
  const charPool = shuffle(
    (Object.keys(CHARACTERS) as CharKey[]).filter((k) => packs.includes(CHARACTERS[k].pack)),
    random,
  );
  const ps: Record<string, BPlayer> = {};
  const picks: Record<string, CharKey[]> = {};
  const used: CharKey[] = [];
  players.forEach((id, i) => {
    picks[id] = charPool.splice(0, 2);
    used.push(...picks[id]);
    ps[id] = { id, role: roles[i], char: picks[id][0], alt: picks[id][1] ?? null, life: 0, max: 0, hand: [], play: [], gear: [], gold: 0, cubes: 0, dead: false };
  });
  // The Sheriff starts; seats stay in join order.
  const events = eventDeck(packs, random);
  const shopDeck = packs.includes("goldrush") ? shuffle(GEAR_DECK, random) : [];
  const s: BangState = {
    order: players.slice(),
    ps,
    packs,
    status: "picking",
    picks,
    deck: shuffle(deckFor(packs), random),
    discard: [],
    turn: null,
    queue: [],
    phaseAt: now,
    deadline: now + PICK_MS,
    events,
    event: null,
    shop: shopDeck.splice(0, packs.includes("goldrush") ? SHOP_SLOTS : 0),
    shopDeck,
    winners: [],
    finished: [],
    groupSeq: 0,
    deaths: 0,
    three: players.length === 3,
    last: null,
    log: [],
    logSeq: 0,
    turnMs: opts.turnMs ?? TURN_MS,
    respondMs: opts.respondMs ?? RESPOND_MS,
    usedChars: used,
  };
  return s;
}

/** Shuffle the chosen event packs, keep at most EVENT_DECK_SIZE, and put one final event last. */
function eventDeck(packs: Pack[], random: Random): EventKey[] {
  const pool = (Object.keys(EVENTS) as EventKey[]).filter((k) => packs.includes(EVENTS[k].pack));
  if (!pool.length) return [];
  const finals = shuffle(pool.filter((k) => EVENTS[k].final), random);
  const rest = shuffle(pool.filter((k) => !EVENTS[k].final), random).slice(0, EVENT_DECK_SIZE);
  return [...rest, ...finals.slice(0, 1)];
}

/** A player chooses one of their two characters. */
export function pickCharacter(s: BangState, id: string, char: unknown, now: number, names: NameOf, random: Random = Math.random): Result {
  if (s.status !== "picking") return fail("Đã chọn nhân vật xong");
  const opts = s.picks[id];
  if (!opts) return fail("Bạn đã chọn rồi");
  if (!opts.includes(char as CharKey)) return fail("Nhân vật không hợp lệ");
  const p = s.ps[id];
  p.char = char as CharKey;
  p.alt = opts.find((o) => o !== char) ?? null;
  delete s.picks[id];
  if (!Object.keys(s.picks).length) begin(s, now, names, random);
  return OK;
}

/** Everyone has a character: life, starting hands, first turn. */
function begin(s: BangState, now: number, names: NameOf, random: Random) {
  s.status = "playing";
  for (const id of s.order) {
    const p = s.ps[id];
    p.max = CHARACTERS[p.char].life + (p.role === "sheriff" ? 1 : 0);
    // Kicked during character choice: already dead, gets no life and no cards.
    if (p.dead) continue;
    p.life = p.max;
    draw(s, id, hasAb(s, id, "bigspencer") ? 5 : p.life, random);
    if (hasAb(s, id, "redringo")) p.cubes = 4;
  }
  const first = s.order.find((id) => s.ps[id].role === "sheriff") ?? s.order[0];
  log(s, now, `Ván bắt đầu — ${names(first)} đi trước`, "event");
  startTurn(s, first, now, false);
  run(s, now, names, random);
}

// ─── Turns ──────────────────────────────────────────────────────────

export function startTurn(s: BangState, id: string, now: number, extra: boolean) {
  s.turn = { player: id, step: "start", startStep: 0, bangs: 0, extraBangs: 0, played: 0, uses: {}, lastBrown: null, ...(extra ? { extra } : {}) };
  s.phaseAt = now;
  s.deadline = null;
  const p = s.ps[id];
  p.borrowed = [];
}

/** Next seat (clockwise, or the other way during Đổ Xô Tìm Vàng) that takes a turn. */
function nextPlayer(s: BangState, from: string): string | null {
  const n = s.order.length;
  const dir = has(s, "reverse") ? -1 : 1;
  let i = s.order.indexOf(from);
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    const id = s.order[i];
    const p = s.ps[id];
    if (!p.dead || p.ghost || has(s, "ghosttown")) return id;
  }
  return null;
}

/** End the current turn (discards already checked) and move on. */
export function passTurn(s: BangState, now: number, names: NameOf, random: Random) {
  const t = s.turn;
  if (!t) return;
  const id = t.player;
  const p = s.ps[id];
  // Green cards played this turn become usable.
  for (const c of p.play) delete c.fresh;
  let again = false;
  if (!t.skip && !p.dead && !t.extra && s.status === "playing") {
    if (has(s, "susanna") && t.played < 3) {
      now_(s, { kind: "hurt", to: id, from: null, amount: 1 });
      log(s, now, `${names(id)} đánh ít hơn 3 lá — mất 1 máu`, "event");
    }
    if (has(s, "vendetta") && flip(s, id, (c) => effSuit(s, c) === "H", "Báo Thù", now, names, random)) again = true;
    if (!again && hasAb(s, id, "donbell") && flip(s, id, (c) => effSuit(s, c) === "H" || effSuit(s, c) === "D", "Đông Chuông", now, names, random)) again = true;
  }
  if (p.townGhost) {
    toDiscard(s, ...p.hand, ...p.play.map((c) => c.id));
    p.hand = [];
    p.play = [];
    p.townGhost = false;
  }
  if (s.status !== "playing") return;
  const next = again && !p.dead ? id : nextPlayer(s, id);
  if (!next) return;
  if (again && next === id) log(s, now, `${names(id)} được chơi thêm 1 lượt`, "event");
  startTurn(s, next, now, again && next === id);
}

/**
 * Process the queue and the turn machine until something needs a player's input.
 */
export function run(s: BangState, now: number, names: NameOf, random: Random = Math.random) {
  for (let step = 0; step < MAX_STEPS && s.status === "playing"; step++) {
    const head = s.queue[0];
    if (head) {
      if ("to" in head && head.kind !== "pokerEnd" && !present(s, head.to) && head.kind !== "hurt") {
        s.queue.shift();
        s.queue.unshift(...salvage(s, head));
        continue;
      }
      if (isInteractive(head)) {
        if (head.kind === "react" && !head.rolled) {
          head.rolled = true;
          prepareReact(s, now, names, random);
          continue;
        }
        // The clock starts when an entry reaches the front, not when it was queued.
        if (!head.started) {
          head.started = true;
          head.deadline = until(s, now);
        }
        if (s.deadline !== head.deadline) {
          s.deadline = head.deadline;
          s.phaseAt = now;
        }
        return;
      }
      s.queue.shift();
      if (head.kind === "hurt") processHurt(s, head, now, names, random);
      else if (head.kind === "pokerEnd") pokerEnd(s, head, now, names);
      else if (head.kind === "effect") applyEffect(s, head, now, names, random);
      continue;
    }
    const t = s.turn;
    if (!t) return;
    if (t.skip || !present(s, t.player)) {
      passTurn(s, now, names, random);
      continue;
    }
    if (t.step === "start") {
      if (startOfTurn(s, now, names, random)) continue;
      t.step = "draw";
      const q = drawPrompt(s, t.player, now);
      if (q) now_(s, q);
      else drawPhase(s, t.player, "normal", {}, now, names, random);
      continue;
    }
    if (t.step === "draw") {
      // The draw prompt was answered (drawPhase moves to "play").
      return;
    }
    // play: waiting for the player.
    if (!t.deadline) t.deadline = now + s.turnMs;
    if (s.deadline !== t.deadline) {
      s.deadline = t.deadline;
      s.phaseAt = now;
    }
    return;
  }
}

/** Roll Barrel / Giò Đỏ May, and settle shots that can't be answered, when a react reaches the front. */
function prepareReact(s: BangState, now: number, names: NameOf, random: Random) {
  const q = s.queue[0] as Extract<QEntry, { kind: "react" }>;
  const target = q.to;
  if (q.answer === "missed" && !q.unmissable) {
    const rolls = (!q.noGear && inPlay(s, target, "barrel") ? 1 : 0) + (hasAb(s, target, "jourdonnais") ? 1 : 0);
    for (let i = 0; i < rolls && q.need > 0; i++) {
      if (flip(s, target, (c) => effSuit(s, c) === "H", "Thùng Gỗ", now, names, random)) q.need -= 1;
    }
    if (q.need <= 0) {
      s.queue.shift();
      avoided(s, q, now, names, random);
      return;
    }
  }
  q.deadline = until(s, now);
  q.started = true;
  // Nothing to answer with: take it right away.
  if (!canAnswer(s, q)) {
    s.queue.shift();
    took(s, q, now, names, random);
  }
}

/** Could the target answer this prompt at all? */
export function canAnswer(s: BangState, q: Extract<QEntry, { kind: "react" }>): boolean {
  const id = q.to;
  const p = s.ps[id];
  if (q.answer === "evade") {
    return p.hand.some((c) => keyOf(c) === "escape") || (hasAb(s, id, "mick") && missedCards(s, id, q).length > 0);
  }
  if (q.unmissable && q.answer === "missed") return false;
  if (q.answer === "missed") return missedCards(s, id, q).length >= q.need;
  if (beatCards(s, id).length >= q.need) return true;
  return !!q.evadable && (p.hand.some((c) => keyOf(c) === "escape") || (hasAb(s, id, "mick") && missedCards(s, id, q).length > 0));
}

/** Cards (hand, or ready green cards in play) that count as a Trượt! for this player. */
export function missedCards(s: BangState, id: string, q?: { noGear?: boolean }): number[] {
  if (hasAb(s, id, "bigspencer")) return [];
  const p = s.ps[id];
  const out = p.hand.filter(
    (c) =>
      typeOf(c).isMissed ||
      hasAb(s, id, "elena") ||
      (hasAb(s, id, "calamity") && typeOf(c).isBang) ||
      (has(s, "showdown") && typeOf(c).isBang),
  );
  if (!q?.noGear && gearActive(s, id)) for (const c of p.play) if (!c.fresh && typeOf(c.id).color === "green" && typeOf(c.id).isMissed) out.push(c.id);
  return out;
}

/** Cards that count as a BANG! when answering Da Đỏ / Đấu Tay Đôi. */
export function beatCards(s: BangState, id: string): number[] {
  return s.ps[id].hand.filter(
    (c) => typeOf(c).isBang || (hasAb(s, id, "calamity") && typeOf(c).isMissed) || has(s, "showdown"),
  );
}

/** The react's target got away. */
export function avoided(s: BangState, q: Extract<QEntry, { kind: "react" }>, now: number, names: NameOf, random: Random) {
  const from = q.from;
  if (q.answer === "evade") {
    dropGroup(s, q.group);
    log(s, now, `${names(q.to)} né được`, "info");
    return;
  }
  if (q.answer === "bang" && q.duel) {
    // Đấu Tay Đôi: now the other one must answer.
    const { evadable: _first, ...rest } = q;
    now_(s, { ...rest, to: q.duel, duel: q.to, from: q.to, rolled: false, deadline: until(s, now) });
    return;
  }
  if (q.cause === "Cò Quay Nga") {
    const next = nextLiving(s, q.to);
    if (next) // need goes back to 1: a Barrel roll may have lowered it to 0, which would let the whole table "answer" for free forever.
    now_(s, { ...q, to: next, need: 1, rolled: false, deadline: until(s, now) });
    return;
  }
  log(s, now, `${names(q.to)} né được`, "info");
  if (q.shot && from && present(s, from)) {
    if (hasAb(s, from, "bloody")) draw(s, from, 1, random);
    const bunt = inPlay(s, from, "buntline");
    const h = s.ps[q.to].hand;
    if (bunt && (bunt.cubes ?? 0) > 0 && h.length) {
      bunt.cubes = (bunt.cubes ?? 0) - 1;
      toDiscard(s, h.splice(Math.floor(random() * h.length), 1)[0]);
    }
    if (q.card != null && keyOf(q.card) === "flintlock" && s.discard.includes(q.card)) {
      s.discard.splice(s.discard.indexOf(q.card), 1);
      s.ps[from].hand.push(q.card);
    }
  }
}

/** The react's target takes the hit (or, for Đạn Nảy, loses the targeted card). */
export function took(s: BangState, q: Extract<QEntry, { kind: "react" }>, now: number, names: NameOf, random: Random) {
  if (q.answer === "evade") return; // the effect behind it just happens
  if (q.targetCard !== undefined) {
    const c = fromPlay(s, q.to, q.targetCard);
    if (c) {
      toDiscard(s, c.id);
      log(s, now, `${names(q.to)} mất ${cardName(c.id)}`, "info");
    }
    return;
  }
  if (q.cause === "Cò Quay Nga") log(s, now, `${names(q.to)} thua Cò Quay Nga`, "event");
  now_(s, { kind: "hurt", to: q.to, from: q.from, amount: q.dmg, ...(q.shot ? { shot: true } : {}) });
}

function nextLiving(s: BangState, from: string): string | null {
  const n = s.order.length;
  const i = s.order.indexOf(from);
  for (let k = 1; k < n; k++) {
    const id = s.order[(i + k) % n];
    if (alive(s, id)) return id;
  }
  return null;
}

/** Damage, with a Cứu Nguy window for everyone else holding one. */
function processHurt(s: BangState, h: Extract<QEntry, { kind: "hurt" }>, now: number, names: NameOf, random: Random) {
  if (!alive(s, h.to) || h.amount <= 0) return;
  const asked = h.asked ?? [];
  const saver = s.order.find((id) => id !== h.to && present(s, id) && !asked.includes(id) && s.ps[id].hand.some((c) => keyOf(c) === "saved"));
  if (saver) {
    now_(s, { kind: "save", to: saver, target: h.to, from: h.from, amount: h.amount, ...(h.shot ? { shot: true } : {}), asked: [...asked, saver], deadline: until(s, now) });
    return;
  }
  applyDamage(s, h.to, h.from, h.amount, !!h.shot, now, names, random);
}

function pokerEnd(s: BangState, e: Extract<QEntry, { kind: "pokerEnd" }>, now: number, names: NameOf) {
  const aces = e.pool.some((c) => cardDef(c).rank === 14);
  if (!aces && present(s, e.to)) {
    log(s, now, `${names(e.to)} lấy ${Math.min(2, e.pool.length)} lá từ ván Xì Phé`, "info");
    if (e.pool.length <= 2) s.ps[e.to].hand.push(...e.pool);
    else now_(s, { kind: "keep", to: e.to, cards: e.pool, keep: 2, cause: "poker", deadline: until(s, now) });
  } else {
    toDiscard(s, ...e.pool);
    log(s, now, "Có lá A trong ván Xì Phé — không ai được gì", "info");
  }
}

/**
 * Start-of-turn steps, one at a time. Returns true if it did something (maybe queued prompts)
 * so the caller loops again; false when the turn can go on to the draw phase.
 */
function startOfTurn(s: BangState, now: number, names: NameOf, random: Random): boolean {
  const t = s.turn!;
  const id = t.player;
  const p = s.ps[id];
  const stepNo = t.startStep;
  t.startStep += 1;
  switch (stepNo) {
    case 0: {
      // A new event card at the start of the Sheriff's turn (the first player's in a 3-player game).
      const leader = s.order.find((x) => s.ps[x].role === "sheriff") ?? s.order[0];
      if (id === leader && !t.extra && s.events.length && (s.event === null || !EVENTS[s.event].final)) revealEvent(s, now, names, random);
      return true;
    }
    case 1: {
      // Thị Trấn Ma: the dead play one turn as ghosts.
      if (p.dead && !p.ghost) {
        if (has(s, "ghosttown")) {
          p.townGhost = true;
          log(s, now, `👻 ${names(id)} trở về từ cõi chết trong 1 lượt`, "event");
        } else t.skip = true;
      }
      return true;
    }
    case 2: {
      if (has(s, "highnoon") && alive(s, id)) now_(s, { kind: "hurt", to: id, from: null, amount: 1 });
      if (has(s, "fistful") && alive(s, id)) {
        const n = p.hand.length;
        for (let i = 0; i < n; i++) later(s, { kind: "react", to: id, from: null, answer: "missed", cause: "Nắm Bài", need: 1, dmg: 1, deadline: 0 });
      }
      if (has(s, "valentine") && p.hand.length) {
        const n = p.hand.length;
        toDiscard(s, ...p.hand);
        p.hand = [];
        draw(s, id, n, random);
      }
      return true;
    }
    case 3: {
      const dyn = inPlay(s, id, "dynamite");
      if (dyn) {
        const safe = flip(s, id, (c) => !(effSuit(s, c) === "S" && cardDef(c).rank >= 2 && cardDef(c).rank <= 9), "Thuốc Nổ", now, names, random);
        fromPlay(s, id, dyn.id);
        if (!safe) {
          toDiscard(s, dyn.id);
          log(s, now, `💥 Thuốc Nổ nổ tung chỗ ${names(id)}!`, "bang");
          now_(s, { kind: "hurt", to: id, from: null, amount: 3 });
        } else {
          const next = nextHolder(s, id);
          if (next) s.ps[next].play.push(dyn);
          else toDiscard(s, dyn.id);
        }
      }
      return true;
    }
    case 4: {
      const jail = p.play.find((c) => keyOf(c.id) === "jail");
      if (jail) {
        fromPlay(s, id, jail.id);
        toDiscard(s, jail.id);
        if (!gearActive(s, id)) return true;
        if (flip(s, id, (c) => effSuit(s, c) === "H", "Nhà Giam", now, names, random)) log(s, now, `${names(id)} thoát khỏi Nhà Giam`, "info");
        else {
          log(s, now, `${names(id)} bị giam — mất lượt`, "info");
          t.skip = true;
        }
      }
      return true;
    }
    case 5: {
      if (inPlay(s, id, "rattlesnake") && alive(s, id) && flip(s, id, (c) => effSuit(s, c) === "S", "Rắn Chuông", now, names, random)) {
        now_(s, { kind: "hurt", to: id, from: null, amount: 1 });
      }
      return true;
    }
    case 6: {
      if (p.char === "vera") {
        const options = s.order.filter((o) => o !== id && present(s, o)).map((o) => s.ps[o].char).filter((c) => c !== "vera");
        if (options.length) now_(s, { kind: "copy", to: id, options: [...new Set(options)], deadline: until(s, now) });
      }
      if (p.char === "greygory") {
        const pool = shuffle(
          (Object.keys(CHARACTERS) as CharKey[]).filter((k) => s.packs.includes(CHARACTERS[k].pack) && !s.usedChars.includes(k) && k !== "greygory"),
          random,
        ).slice(0, 2);
        p.borrowed = pool;
        s.usedChars.push(...pool);
        if (pool.length) log(s, now, `${names(id)} mượn sức mạnh: ${pool.map((k) => CHARACTERS[k].name).join(", ")}`, "info");
      }
      return true;
    }
    case 7: {
      // Du Cười Toe: everyone holding more cards than him hands one over.
      if (hasAb(s, id, "youl")) {
        for (const o of s.order) {
          if (o === id || !present(s, o)) continue;
          const h = s.ps[o].hand;
          if (h.length > p.hand.length) p.hand.push(h.splice(Math.floor(random() * h.length), 1)[0]);
        }
      }
      return false;
    }
    default:
      return false;
  }
}

/** Next player who can receive the Dynamite (living, not already holding one). */
function nextHolder(s: BangState, from: string): string | null {
  const n = s.order.length;
  const i = s.order.indexOf(from);
  for (let k = 1; k < n; k++) {
    const id = s.order[(i + k) % n];
    if (alive(s, id) && !s.ps[id].play.some((c) => keyOf(c.id) === "dynamite")) return id;
  }
  return null;
}

function revealEvent(s: BangState, now: number, names: NameOf, random: Random) {
  const ev = s.events.shift()!;
  s.event = ev;
  mark(s, "event", null, null);
  log(s, now, `📰 Sự kiện: ${EVENTS[ev].emoji} ${EVENTS[ev].name} — ${EVENTS[ev].text}`, "event");
  switch (ev) {
    case "daltons":
      for (const id of s.order) {
        const blue = s.ps[id].play.find((c) => typeOf(c.id).color === "blue");
        if (alive(s, id) && blue) {
          fromPlay(s, id, blue.id);
          toDiscard(s, blue.id);
        }
      }
      break;
    case "doctor": {
      const living = livingIds(s);
      const low = Math.min(...living.map((id) => s.ps[id].life));
      for (const id of living) if (s.ps[id].life === low) heal(s, id, 1);
      break;
    }
    case "deadman": {
      const first = s.order.filter((id) => s.ps[id].dead).sort((a, b) => (s.ps[a].diedAt ?? 0) - (s.ps[b].diedAt ?? 0))[0];
      if (first) revive(s, first, 2, 2, now, names, random);
      break;
    }
    case "boneyard":
      for (const id of s.order) if (s.ps[id].dead) revive(s, id, 1, 1, now, names, random);
      break;
    case "helena": {
      const ids = livingIds(s).filter((id) => s.ps[id].role !== "sheriff");
      const roles = shuffle(ids.map((id) => s.ps[id].role), random);
      ids.forEach((id, i) => (s.ps[id].role = roles[i]));
      break;
    }
    case "roulette": {
      const start = s.order.find((id) => s.ps[id].role === "sheriff" && alive(s, id)) ?? livingIds(s)[0];
      if (start) later(s, { kind: "react", to: start, from: null, answer: "missed", cause: "Cò Quay Nga", need: 1, dmg: 2, deadline: 0 });
      break;
    }
    default:
      break;
  }
}

function revive(s: BangState, id: string, life: number, cards: number, now: number, names: NameOf, random: Random) {
  const p = s.ps[id];
  p.dead = false;
  p.ghost = false;
  p.life = Math.min(life, p.max);
  delete p.diedAt;
  draw(s, id, cards, random);
  log(s, now, `🧟 ${names(id)} sống lại!`, "event");
}

// ─── Phase 1 ────────────────────────────────────────────────────────

/** A prompt if the player has a real choice for their draw, else null (draw normally). */
function drawPrompt(s: BangState, id: string, now: number): QEntry | null {
  const options: DrawMode[] = ["normal"];
  const others = s.order.filter((o) => o !== id && present(s, o));
  if (hasAb(s, id, "jesse") && others.some((o) => s.ps[o].hand.length)) options.push("jesse");
  if (hasAb(s, id, "pedro") && s.discard.length) options.push("pedro");
  if (hasAb(s, id, "pat") && s.order.some((o) => o !== id && present(s, o) && s.ps[o].play.length)) options.push("pat");
  if (hasAb(s, id, "evelyn")) options.push("evelyn");
  if (has(s, "hardliquor") && alive(s, id) && s.ps[id].life < s.ps[id].max) options.push("liquor");
  if (has(s, "peyote")) options.push("peyote");
  const swap = has(s, "newidentity") && !!s.ps[id].alt && alive(s, id);
  const blood = has(s, "bloodbrothers") && alive(s, id) && s.ps[id].life > 1;
  if (options.length === 1 && !swap && !blood) return null;
  return { kind: "draw", to: id, options, swap, blood, deadline: until(s, now) };
}

export interface DrawArgs {
  target?: string;
  targets?: string[];
  card?: number;
  color?: "red" | "black";
  swap?: boolean;
  blood?: string;
}

/** How many cards a normal phase-1 draw takes. */
export function drawCount(s: BangState, id: string): number {
  const p = s.ps[id];
  if (p.townGhost) return 3;
  let n = 2;
  if (hasAb(s, id, "pixie")) n = 3;
  if (hasAb(s, id, "bill")) n = 1 + (p.max - p.life);
  if (hasAb(s, id, "tuco") && !p.play.some((c) => typeOf(c.id).color === "blue")) n += 2;
  if (has(s, "train")) n += 1;
  if (has(s, "thirst")) n -= 1;
  if (hasGear(s, id, "pickaxe")) n += 1;
  return Math.max(0, n);
}

/** Phase 1 with the chosen mode. Validation of the arguments happens here too. */
export function drawPhase(s: BangState, id: string, mode: DrawMode, args: DrawArgs, now: number, names: NameOf, random: Random): Result {
  const p = s.ps[id];
  const t = s.turn!;
  if (args.swap && has(s, "newidentity") && p.alt && alive(s, id)) {
    const old = p.char;
    p.char = p.alt;
    p.alt = old;
    p.max = CHARACTERS[p.char].life + (p.role === "sheriff" ? 1 : 0);
    p.life = Math.min(2, p.max);
    log(s, now, `${names(id)} đổi danh tính thành ${CHARACTERS[p.char].name}`, "event");
  }
  if (args.blood && has(s, "bloodbrothers") && p.life > 1 && args.blood !== id && alive(s, args.blood)) {
    p.life -= 1;
    heal(s, args.blood, 1);
    log(s, now, `${names(id)} truyền 1 máu cho ${names(args.blood)}`, "heal");
  }
  let n = drawCount(s, id);
  const others = (o: string) => o !== id && present(s, o);
  switch (mode) {
    case "jesse": {
      const from = args.target;
      if (!from || !others(from) || !s.ps[from].hand.length || !hasAb(s, id, "jesse")) return fail("Chọn người có bài trên tay");
      const h = s.ps[from].hand;
      p.hand.push(h.splice(Math.floor(random() * h.length), 1)[0]);
      henryPunish(s, from, id, now);
      n -= 1;
      break;
    }
    case "pedro": {
      if (!hasAb(s, id, "pedro") || !s.discard.length) return fail("Đống bài bỏ đang trống");
      p.hand.push(s.discard.pop()!);
      n -= 1;
      break;
    }
    case "pat": {
      const from = args.target;
      const card = args.card;
      if (!hasAb(s, id, "pat") || !from || !others(from) || card === undefined) return fail("Chọn 1 lá trước mặt người khác");
      const c = fromPlay(s, from, card);
      if (!c) return fail("Không có lá đó");
      p.hand.push(c.id);
      henryPunish(s, from, id, now);
      n = 0;
      break;
    }
    case "evelyn": {
      const targets = (args.targets ?? []).filter((x, i, a) => a.indexOf(x) === i);
      if (!hasAb(s, id, "evelyn") || !targets.length || targets.length > Math.min(2, n)) return fail("Chọn 1–2 người trong tầm");
      for (const x of targets) if (!others(x) || distance(s, id, x) > weaponRange(s, id)) return fail("Người đó ngoài tầm");
      n -= targets.length;
      for (const x of targets) later(s, shot(s, id, x, now, { cause: "Ê-vơ-lin" }));
      break;
    }
    case "liquor": {
      if (!has(s, "hardliquor")) return fail("Không có sự kiện Rượu Mạnh");
      heal(s, id, 1);
      log(s, now, `${names(id)} bỏ rút bài để hồi 1 máu`, "heal");
      n = 0;
      break;
    }
    case "peyote": {
      if (!has(s, "peyote") || (args.color !== "red" && args.color !== "black")) return fail("Đoán Đỏ hoặc Đen");
      let got = 0;
      for (let i = 0; i < 20; i++) {
        const c = takeTop(s, random);
        if (c === null) break;
        const red = effSuit(s, c) === "H" || effSuit(s, c) === "D";
        if (red === (args.color === "red")) {
          p.hand.push(c);
          got += 1;
        } else {
          toDiscard(s, c);
          break;
        }
      }
      log(s, now, `${names(id)} đoán ${args.color === "red" ? "Đỏ" : "Đen"} và được ${got} lá`, "info");
      n = 0;
      break;
    }
    default:
      break;
  }
  if (n > 0) {
    if (hasAb(s, id, "kit") && mode === "normal") {
      const look: number[] = [];
      for (let i = 0; i < n + 1; i++) {
        const c = takeTop(s, random);
        if (c !== null) look.push(c);
      }
      now_(s, { kind: "keep", to: id, cards: look, keep: Math.min(n, look.length), cause: "kit", deadline: until(s, now) });
    } else if (hasAb(s, id, "dutch") && mode === "normal") {
      const look: number[] = [];
      for (let i = 0; i < n; i++) {
        const c = takeTop(s, random);
        if (c !== null) look.push(c);
      }
      now_(s, { kind: "keep", to: id, cards: look, keep: Math.max(0, look.length - 1), cause: "dutch", deadline: until(s, now) });
    } else if (has(s, "mine") && s.discard.length >= n) {
      for (let i = 0; i < n; i++) p.hand.push(s.discard.pop()!);
    } else {
      const got = draw(s, id, n, random);
      if (hasAb(s, id, "blackjack") && got.length >= 2) {
        const second = got[1];
        log(s, now, `${names(id)} lật lá thứ hai: ${cardName(second)}`, "info");
        if (cardDef(second).suit === "H" || cardDef(second).suit === "D") draw(s, id, 1, random);
      }
      if (has(s, "lawwest")) {
        const extra = draw(s, id, 1, random);
        if (extra.length) log(s, now, `${names(id)} lật lá: ${cardName(extra[0])}`, "info");
      }
    }
  }
  t.step = "play";
  t.deadline = now + s.turnMs;
  suzy(s, random);
  return OK;
}

/** Hen-ri Gai Góc shoots back at whoever takes or discards his cards. */
export function henryPunish(s: BangState, owner: string, taker: string, now: number) {
  if (owner !== taker && hasAb(s, owner, "henry") && present(s, taker) && alive(s, owner)) {
    later(s, { kind: "react", to: taker, from: owner, answer: "missed", cause: "Hen-ri Gai Góc", need: 1, dmg: 1, shot: true, deadline: until(s, now) });
  }
}

/** A shot from `from` at `to`, with the shooter's modifiers (Sờ Lép, Cô-lô-ra-đô, Súng Hai Nòng…). */
export function shot(
  s: BangState,
  from: string,
  to: string,
  now: number,
  opts: { cause: string; card?: number | null; dmg?: number; need?: number; noGear?: boolean; targetCard?: number; bang?: boolean; unmissable?: boolean },
): Extract<QEntry, { kind: "react" }> {
  let need = opts.need ?? 1;
  // Sờ Lép, Súng Hai Nòng: only for BANG! cards (`bang`).
  if (opts.bang && hasAb(s, from, "slab")) need = Math.max(need, 2);
  let unmissable = !!opts.unmissable;
  const card = opts.card ?? null;
  if (opts.bang && card !== null && inPlay(s, from, "doublebarrel") && cardDef(card).suit === "D") unmissable = true;
  return {
    kind: "react",
    to,
    from,
    answer: "missed",
    cause: opts.cause,
    need,
    dmg: opts.dmg ?? 1,
    shot: true,
    card,
    ...(unmissable ? { unmissable } : {}),
    ...(opts.noGear ? { noGear: true } : {}),
    ...(opts.targetCard !== undefined ? { targetCard: opts.targetCard } : {}),
    deadline: until(s, now),
  };
}

// ─── Timers ─────────────────────────────────────────────────────────

/** Who the game is waiting for right now. */
export function waitingFor(s: BangState): string[] {
  if (s.status === "picking") return Object.keys(s.picks);
  if (s.status !== "playing") return [];
  const head = s.queue[0];
  if (head && isInteractive(head)) return [head.to];
  return s.turn ? [s.turn.player] : [];
}

export function tickGame(s: BangState, now: number, names: NameOf, absent: (id: string) => boolean, random: Random = Math.random): boolean {
  if (s.status === "picking") {
    const due = now >= (s.deadline ?? Infinity);
    const lazy = Object.keys(s.picks).filter((id) => due || (absent(id) && now >= s.phaseAt + ABSENT_MS));
    for (const id of lazy) {
      if (s.status === "picking" && s.picks[id]) pickCharacter(s, id, s.picks[id][Math.floor(random() * s.picks[id].length)], now, names, random);
    }
    return lazy.length > 0;
  }
  if (s.status !== "playing") return false;
  let changed = false;
  for (let i = 0; i < 50 && s.status === "playing"; i++) {
    const who = waitingFor(s)[0];
    if (!who) break;
    const due = now >= (s.deadline ?? Infinity) || (absent(who) && now >= s.phaseAt + ABSENT_MS);
    if (!due) break;
    autoAnswer(s, who, now, names, random);
    run(s, now, names, random);
    changed = true;
  }
  return changed;
}

export function nextGameTickAt(s: BangState, now: number): number | null {
  if (s.status === "ended") return null;
  const absentAt = s.phaseAt + ABSENT_MS > now ? s.phaseAt + ABSENT_MS : null;
  const times = [s.deadline, absentAt].filter((x): x is number => typeof x === "number");
  return times.length ? Math.min(...times) : null;
}

/** Remove a player for good (kicked while offline): they die without a killer. */
export function forfeitPlayer(s: BangState, id: string, now: number, names: NameOf, random: Random = Math.random): Result {
  if (s.status === "ended" || !s.ps[id]) return fail("Người chơi không còn trong ván");
  s.forfeited = [...(s.forfeited ?? []), id];
  if (s.status === "picking") {
    if (s.picks[id]) pickCharacter(s, id, s.picks[id][0], now, names, random);
  }
  if (!s.ps[id].dead) {
    log(s, now, `${names(id)} rời ván`, "info");
    s.ps[id].ghost = false;
    kill(s, id, null, now, names, random);
  }
  run(s, now, names, random);
  return OK;
}

export { GEAR };
