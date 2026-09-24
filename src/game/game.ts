import { type Card, newDeck, shuffle, sortCards } from "./cards";
import { type Combo, canBeat, detectCombo, isChop } from "./combos";
import { type InstantWinReason, detectInstantWin } from "./rules";

export const HAND_SIZE = 13;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export interface LastPlay {
  playerId: string;
  combo: Combo;
  chop: boolean;
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
  instantWin: { playerId: string; reason: InstantWinReason } | null;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface NewGameOptions {
  /** Winner of the previous game leads; omit on the first game (lowest card leads). */
  starter?: string;
  random?: () => number;
  /** Pre-dealt hands (tests). */
  hands?: Record<string, Card[]>;
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

export const activePlayers = (s: GameState) => s.players.filter((p) => !s.finished.includes(p));

/** Next active player after `from` in seat order, optionally skipping those who passed this round. */
function nextPlayer(s: GameState, from: string, skipPassed: boolean): string | null {
  const n = s.players.length;
  const start = s.players.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(start + k) % n];
    if (s.finished.includes(p)) continue;
    if (skipPassed && s.passed.includes(p)) continue;
    return p;
  }
  return null;
}

/** After any action, decide who moves next (possibly starting a new round). */
function advance(s: GameState, actor: string) {
  const remaining = activePlayers(s);
  if (remaining.length <= 1) {
    s.finished.push(...remaining);
    s.status = "ended";
    s.turn = null;
    return;
  }

  const leader = s.lastPlay?.playerId;
  const contenders = remaining.filter((p) => !s.passed.includes(p) && p !== leader);
  if (leader && contenders.length === 0) {
    // Everyone else passed: new round. If the leader already finished, the next player leads.
    s.turn = s.finished.includes(leader) ? nextPlayer(s, leader, false) : leader;
    s.lastPlay = null;
    s.passed = [];
    return;
  }
  s.turn = nextPlayer(s, actor, true);
}

export function play(s: GameState, playerId: string, cards: Card[]): ActionResult {
  if (s.status !== "playing") return { ok: false, error: "Ván đã kết thúc" };
  if (s.turn !== playerId) return { ok: false, error: "Chưa đến lượt bạn" };
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
  s.lastPlay = { playerId, combo, chop: isChop(prev, combo) };
  s.mustInclude = null;
  if (s.hands[playerId].length === 0) s.finished.push(playerId);
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
