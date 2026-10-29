import { DEFAULT_TURN_SECONDS, MAX_PLAYERS, MAX_WORDS, MIN_PLAYERS, normalizeWord, syllablesOf } from "./board";
import type { NCWordView } from "./protocol";
import { hasWord, randomOpeningWord } from "./words";

/**
 * Nối Chữ state machine (2–8 players). Pure and timer-free: `now` and `random` are passed in. Players take turns
 * adding a two-syllable word that starts with the last syllable of the previous word; whoever runs out of time (or
 * is kicked) is out, the last one standing wins. A wrong word is refused and changes nothing, the clock keeps
 * running. The game also ends after MAX_WORDS words so it always finishes.
 */

export const TURN_MS = DEFAULT_TURN_SECONDS * 1000;
export const LOG_LIMIT = 30;

export interface NCState {
  /** Seating order shuffled at the start = turn order. */
  players: string[];
  turn: string | null;
  phaseAt: number;
  deadline: number | null;
  /** The opening word (`by: null`) followed by every word played, in order. */
  chain: NCWordView[];
  /** Words added per player. */
  counts: Record<string, number>;
  /** Players who ran out of time or were kicked, in elimination order. */
  out: string[];
  /** Final rank (0 = best, ties share) per player once the game has ended. */
  ranks: Record<string, number>;
  status: "playing" | "ended";
  finished: string[];
  winner: string | null;
  endReason: "last" | "forfeit" | "limit" | null;
  log: { id: number; at: number; text: string; tone?: "word" | "out" | "info" | "win" }[];
  logSeq: number;
  recorded?: boolean;
  turnMs?: number;
  /** Check words against the dictionary (default true; absent in rooms from before the setting existed). */
  dictionary?: boolean;
}

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };
export type NameOf = (id: string) => string;
export type Random = () => number;

const turnMs = (s: NCState) => s.turnMs ?? TURN_MS;
const isOut = (s: NCState, id: string) => s.out.includes(id);
const activeOf = (s: NCState) => s.players.filter((p) => !isOut(s, p));

/** Next player still in the game after `id` in turn order (id itself if alone). */
function nextActive(s: NCState, id: string): string {
  const n = s.players.length;
  const at = s.players.indexOf(id);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(at + k) % n];
    if (!isOut(s, p)) return p;
  }
  return id;
}

/** The syllable the next word must start with. */
export const needOf = (s: NCState): string | null => {
  const last = s.chain[s.chain.length - 1];
  return last ? syllablesOf(last.word)[1] : null;
};

function log(s: NCState, now: number, text: string, tone?: NCState["log"][number]["tone"]) {
  s.logSeq += 1;
  s.log.push({ id: s.logSeq, at: now, text, tone });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

export function newNCGame(
  players: string[],
  now: number,
  opts: { turnMs?: number; dictionary?: boolean } = {},
  random: Random = Math.random,
): NCState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const order = players.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const opening = randomOpeningWord(random);
  const s: NCState = {
    players: order,
    turn: order[0],
    phaseAt: now,
    deadline: now + (opts.turnMs ?? TURN_MS),
    chain: [{ by: null, word: opening, at: now }],
    counts: Object.fromEntries(order.map((p) => [p, 0])),
    out: [],
    ranks: {},
    status: "playing",
    finished: [],
    winner: null,
    endReason: null,
    log: [],
    logSeq: 0,
    turnMs: opts.turnMs ?? TURN_MS,
    dictionary: opts.dictionary ?? true,
  };
  log(s, now, `Từ mở đầu: ${opening}`, "info");
  return s;
}

function beginTurn(s: NCState, id: string, now: number) {
  s.turn = id;
  s.phaseAt = now;
  s.deadline = now + turnMs(s);
}

/** Add a word to the chain. A refused word changes nothing. */
export function playWord(s: NCState, id: string, text: unknown, now: number, names: NameOf): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (!s.players.includes(id) || isOut(s, id)) return fail("Bạn đã bị loại");
  if (s.turn !== id) return fail("Chưa đến lượt bạn");
  const word = normalizeWord(text);
  if (!word) return fail("Từ phải gồm đúng 2 tiếng, chỉ có chữ cái");
  const need = needOf(s);
  if (need !== null && syllablesOf(word)[0] !== need) return fail(`Từ phải bắt đầu bằng "${need}"`);
  if (s.chain.some((w) => w.word === word)) return fail("Từ này đã được dùng");
  if (s.dictionary !== false && !hasWord(word)) return fail("Từ này không có trong từ điển");
  s.chain.push({ by: id, word, at: now });
  s.counts[id] = (s.counts[id] ?? 0) + 1;
  log(s, now, `${names(id)}: ${word}`, "word");
  if (s.chain.length >= MAX_WORDS) {
    log(s, now, "Đã nối quá nhiều từ, kết thúc ván", "info");
    finish(s, now, names, "limit");
    return OK;
  }
  beginTurn(s, nextActive(s, id), now);
  return OK;
}

/** `id` is out: ran out of time or left. The last one standing wins. */
function eliminate(s: NCState, id: string, now: number, names: NameOf, reason: "time" | "forfeit") {
  if (isOut(s, id)) return;
  s.out.push(id);
  log(s, now, reason === "time" ? `⏰ ${names(id)} hết giờ, bị loại` : `${names(id)} rời ván`, "out");
  const alive = activeOf(s);
  if (alive.length <= 1) {
    finish(s, now, names, reason === "time" ? "last" : "forfeit");
    return;
  }
  if (s.turn === id) beginTurn(s, nextActive(s, id), now);
}

/**
 * End the game. Ranking: players still in first (on the word limit: most words first, ties share a rank), then
 * the players who are out, the one who lasted longest first. `winner` is the outright first place (null if shared).
 */
function finish(s: NCState, now: number, names: NameOf, reason: NCState["endReason"]) {
  s.status = "ended";
  s.endReason = reason;
  s.turn = null;
  s.deadline = null;
  const alive = activeOf(s);
  const order = [...alive.slice().sort((x, y) => (s.counts[y] ?? 0) - (s.counts[x] ?? 0)), ...s.out.slice().reverse()];
  const ranks: Record<string, number> = {};
  order.forEach((id, i) => {
    const prev = order[i - 1];
    ranks[id] = i > 0 && alive.includes(id) && alive.includes(prev) && (s.counts[id] ?? 0) === (s.counts[prev] ?? 0) ? ranks[prev] : i;
  });
  s.ranks = ranks;
  s.finished = order;
  const top = order.filter((id) => ranks[id] === 0);
  s.winner = top.length === 1 ? top[0] : null;
  const words = s.chain.length - 1;
  if (s.winner) log(s, now, `🏆 ${names(s.winner)} thắng sau ${words} từ`, "win");
  else log(s, now, `🤝 Hoà sau ${words} từ`, "win");
}

/** A player leaves for good (kicked while offline): they are out. */
export function forfeitPlayer(s: NCState, id: string, now: number, names: NameOf): Result {
  if (s.status !== "playing" || !s.players.includes(id) || isOut(s, id)) return fail("Người chơi không còn trong ván");
  eliminate(s, id, now, names, "forfeit");
  return OK;
}

/** Whoever's turn it is runs out of time (an offline player simply never answers) and is out. */
export function tickGame(s: NCState, now: number, names: NameOf): boolean {
  if (s.status !== "playing" || !s.turn || now < (s.deadline ?? Infinity)) return false;
  eliminate(s, s.turn, now, names, "time");
  return true;
}

export function nextGameTickAt(s: NCState): number | null {
  return s.status === "playing" ? s.deadline : null;
}
