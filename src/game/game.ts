import { type Card, RANK_TWO, newDeck, rankOf, shuffle, sortCards } from "./cards";
import { type Combo, canBeat, detectCombo, isChop } from "./combos";
import { type InstantWinReason, detectInstantWin } from "./rules";
import { type ChopScore, chopPoints } from "./scoring";

export const HAND_SIZE = 13;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export interface LastPlay {
  playerId: string;
  combo: Combo;
  chop: boolean;
  /** The combo this play chopped (chặt), e.g. a single 2 — null for a normal beat. */
  chopped?: Combo | null;
  /** Points the chopper takes from the chopped player (chặt heo). */
  chopPoints?: number;
  /** Who got chopped. */
  choppedPlayer?: string;
}

export interface GameState {
  /** Player ids in seat (turn) order. */
  players: string[];
  hands: Record<string, Card[]>;
  /** Id of the player whose turn it is (null once the game is over). */
  turn: string | null;
  /** Combo currently on the table for this round (null = the turn player leads freely). */
  lastPlay: LastPlay | null;
  /** Players who passed in the current round — they cannot play again until a new round. */
  passed: string[];
  /** Finishing order; the full ranking once status === "ended". */
  finished: string[];
  /** On the first game, the opening combo must contain this card (the lowest dealt card). */
  mustInclude: Card | null;
  status: "playing" | "ended";
  /** Players removed mid-game (kicked while disconnected); they rank last. */
  forfeited?: string[];
  instantWin: { playerId: string; reason: InstantWinReason } | null;
  /** Chặt heo point transfers so far, settled when the game ends. */
  chops?: ChopScore[];
  /** Chết cháy: still holding all 13 cards when the first player finished. They stop playing and rank last. */
  burned?: string[];
  /** Players the server passed for because they had nothing that could beat the table this round. */
  autoPassed?: string[];
  /** Room setting: pass automatically for a player who cannot beat the table (default on). */
  autoPass?: boolean;
  /** Room setting: points for Nhất / Nhì this game (the rest is derived, see scoring.ts). */
  points?: { first: number; second: number };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface NewGameOptions {
  /** Winner of the previous game leads; omit on the first game (lowest card leads). */
  starter?: string;
  random?: () => number;
  /** Pre-dealt hands (tests). */
  hands?: Record<string, Card[]>;
  autoPass?: boolean;
  points?: { first: number; second: number };
}

export function newGame(players: string[], opts: NewGameOptions = {}): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`Cần ${MIN_PLAYERS}-${MAX_PLAYERS} người chơi`);
  }
  let hands = opts.hands;
  if (!hands) {
    const deck = shuffle(newDeck(), opts.random);
    const dealt: Record<string, Card[]> = {};
    players.forEach((p, i) => {
      dealt[p] = sortCards(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE));
    });
    hands = dealt;
  }

  const state: GameState = {
    players: players.slice(),
    hands,
    turn: null,
    lastPlay: null,
    passed: [],
    finished: [],
    mustInclude: null,
    status: "playing",
    instantWin: null,
    autoPass: opts.autoPass ?? true,
    ...(opts.points ? { points: opts.points } : {}),
  };

  // Tới trắng.
  for (const p of players) {
    const reason = detectInstantWin(hands[p]);
    if (reason) {
      state.instantWin = { playerId: p, reason };
      state.status = "ended";
      state.finished = [p, ...players.filter((x) => x !== p)];
      return state;
    }
  }

  if (opts.starter && players.includes(opts.starter)) {
    state.turn = opts.starter;
  } else {
    // First game: whoever holds the lowest dealt card (3♠ with 4 players) leads with it.
    let lowest = Infinity;
    for (const p of players) {
      const min = Math.min(...hands[p]);
      if (min < lowest) {
        lowest = min;
        state.turn = p;
      }
    }
    state.mustInclude = lowest;
  }
  return state;
}

/** Finished normally, or forfeited (kicked while disconnected). */
const isOut = (s: GameState, p: string) => s.finished.includes(p) || !!s.forfeited?.includes(p) || !!s.burned?.includes(p);

export const activePlayers = (s: GameState) => s.players.filter((p) => !isOut(s, p));

/** Next active player after `from` in seat order, optionally skipping those who passed this round. */
function nextPlayer(s: GameState, from: string, skipPassed: boolean): string | null {
  const n = s.players.length;
  const start = s.players.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(start + k) % n];
    if (isOut(s, p)) continue;
    if (skipPassed && s.passed.includes(p)) continue;
    return p;
  }
  return null;
}

/** After any action, decide who moves next (possibly starting a new round). */
function advance(s: GameState, actor: string | null) {
  const remaining = activePlayers(s);
  if (remaining.length <= 1) {
    // Then the burned (chết cháy), then forfeited players, the first one kicked last.
    s.finished.push(...remaining, ...(s.burned ?? []), ...(s.forfeited ?? []).slice().reverse());
    s.status = "ended";
    s.turn = null;
    return;
  }

  const leader = s.lastPlay?.playerId;
  const contenders = remaining.filter((p) => !s.passed.includes(p) && p !== leader);
  if (leader && contenders.length === 0) {
    // Everyone else passed: new round. If the leader is already out, the next player leads.
    s.turn = isOut(s, leader) ? nextPlayer(s, leader, false) : leader;
    s.lastPlay = null;
    s.passed = [];
    s.autoPassed = [];
    return;
  }
  // `actor` null = nobody acted (a forfeit off-turn): keep the current turn.
  if (actor !== null) s.turn = nextPlayer(s, actor, true);
  autoPassHopeless(s);
}

/** Nothing in hand can beat the table → pass for that player right away (tự bỏ lượt). */
function autoPassHopeless(s: GameState) {
  const p = s.turn;
  if (s.autoPass === false || s.status !== "playing" || !p || !s.lastPlay || s.lastPlay.playerId === p) return;
  if (hasBeatingPlay(s.hands[p], s.lastPlay.combo)) return;
  s.autoPassed = [...(s.autoPassed ?? []), p];
  s.passed.push(p);
  advance(s, p);
}

/**
 * Could any combination of `hand` be played on `prev`? `canBeat` only looks at a combo's
 * type, length and top card, so trying the strongest set of each shape is enough.
 */
export function hasBeatingPlay(hand: Card[], prev: Combo): boolean {
  const byRank = new Map<number, Card[]>();
  for (const c of [...hand].sort((a, b) => b - a)) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  const candidates: Card[][] = [];
  for (const cards of byRank.values()) for (let k = 1; k <= cards.length; k++) candidates.push(cards.slice(0, k));
  // Straights and đôi thông: runs of consecutive ranks (never containing a 2).
  for (let end = RANK_TWO - 1; end >= 0; end--) {
    const singles: Card[] = [];
    const pairs: Card[] = [];
    for (let r = end; r >= 0; r--) {
      const cards = byRank.get(r);
      if (!cards) break;
      singles.push(cards[0]);
      if (singles.length >= 3) candidates.push(singles.slice());
      if (cards.length < 2 || pairs.length !== (end - r) * 2) continue;
      pairs.push(cards[0], cards[1]);
      if (pairs.length >= 6) candidates.push(pairs.slice());
    }
  }
  return candidates.some((cards) => {
    const combo = detectCombo(cards);
    return !!combo && canBeat(prev, combo);
  });
}

/** 4+ đôi thông may chop at any moment — out of turn, even after passing this round. */
export const isAnytimeChop = (prev: Combo | null, next: Combo) =>
  !!prev && next.type === "pairSeq" && next.length >= 8 && isChop(prev, next);

export function play(s: GameState, playerId: string, cards: Card[]): ActionResult {
  if (s.status !== "playing") return { ok: false, error: "Ván đã kết thúc" };
  if (!s.players.includes(playerId) || isOut(s, playerId)) return { ok: false, error: "Bạn không còn trong ván" };
  const early = detectCombo(Array.isArray(cards) ? cards : []);
  const anytime = !!early && isAnytimeChop(s.lastPlay?.combo ?? null, early) && s.lastPlay?.playerId !== playerId;
  if (s.turn !== playerId && !anytime) return { ok: false, error: "Chưa đến lượt bạn" };
  const hand = s.hands[playerId];
  if (!Array.isArray(cards) || !cards.every((c) => hand.includes(c))) {
    return { ok: false, error: "Bạn không có lá bài này" };
  }

  const combo = detectCombo(cards);
  if (!combo) return { ok: false, error: "Bộ bài không hợp lệ" };
  if (s.mustInclude !== null && !cards.includes(s.mustInclude)) {
    return { ok: false, error: "Nước đầu tiên phải có lá nhỏ nhất (3♠)" };
  }
  const prev = s.lastPlay?.combo ?? null;
  if (!canBeat(prev, combo)) return { ok: false, error: "Bài không chặn được" };

  s.hands[playerId] = hand.filter((c) => !cards.includes(c));
  // An out-of-turn 4 đôi thông puts the chopper back in the round; play continues after them.
  if (anytime) s.passed = s.passed.filter((p) => p !== playerId);
  const chop = isChop(prev, combo);
  const prevPlayer = s.lastPlay?.playerId;
  const prevChopPoints = s.lastPlay?.chop ? (s.lastPlay.chopPoints ?? 0) : 0;
  s.lastPlay = { playerId, combo, chop, chopped: chop ? prev : null };
  if (chop && prev && prevPlayer && prevPlayer !== playerId) {
    // Chặt chồng: chopping a chop doubles what that chop was worth, every time.
    const points = prevChopPoints > 0 ? prevChopPoints * 2 : chopPoints(prev);
    s.lastPlay.chopPoints = points;
    s.lastPlay.choppedPlayer = prevPlayer;
    s.chops = [...(s.chops ?? []), { from: prevPlayer, to: playerId, points }];
  }
  s.mustInclude = null;
  if (s.hands[playerId].length === 0) {
    s.finished.push(playerId);
    // Chết cháy: when the first player goes out, anyone who has not played a single card is burned.
    if (s.finished.length === 1) {
      const burned = activePlayers(s).filter((p) => s.hands[p].length === HAND_SIZE);
      if (burned.length) {
        s.burned = burned;
        s.passed = s.passed.filter((p) => !burned.includes(p));
      }
    }
  }
  advance(s, playerId);
  return { ok: true };
}

export function pass(s: GameState, playerId: string): ActionResult {
  if (s.status !== "playing") return { ok: false, error: "Ván đã kết thúc" };
  if (s.turn !== playerId) return { ok: false, error: "Chưa đến lượt bạn" };
  if (!s.lastPlay) return { ok: false, error: "Bạn đang mở vòng, không được bỏ lượt" };
  s.passed.push(playerId);
  advance(s, playerId);
  return { ok: true };
}

/** Timeout / absent player: pass if possible, otherwise lead the lowest single (or the required card). */
export function autoAction(s: GameState, playerId: string): ActionResult {
  if (s.lastPlay) return pass(s, playerId);
  const card = s.mustInclude ?? Math.min(...s.hands[playerId]);
  return play(s, playerId, [card]);
}

/** Remove a player from the running game; they rank below everyone still playing. */
export function forfeit(s: GameState, playerId: string): ActionResult {
  if (s.status !== "playing") return { ok: false, error: "Ván đã kết thúc" };
  if (!s.players.includes(playerId) || isOut(s, playerId)) return { ok: false, error: "Người chơi không còn trong ván" };
  s.forfeited = [...(s.forfeited ?? []), playerId];
  s.passed = s.passed.filter((p) => p !== playerId);
  if (s.mustInclude !== null && s.hands[playerId]?.includes(s.mustInclude)) s.mustInclude = null;
  advance(s, s.turn === playerId ? playerId : null);
  return { ok: true };
}
