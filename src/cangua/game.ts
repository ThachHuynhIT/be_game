import type { CNMove } from "./protocol";
import { COLORS, COLORS_FOR_PLAYERS, COLOR_NAMES, FINAL, GATE, HORSES, MAX_PLAYERS, MIN_PLAYERS, STABLE, trackIndex } from "./board";

/**
 * Cờ Cá Ngựa state machine. Pure and timer-free: `now` and `random` are passed in;
 * `tickGame()` rolls and moves for players who time out or go offline.
 * One die per turn; a 6 rolls again; a horse moves exactly the die. See board.ts for positions.
 */

export const TURN_MS = 15_000;
export const ABSENT_MS = 2_500;
export const LOG_LIMIT = 20;

export interface CNRules {
  exitOn1: boolean;
  noJump: boolean;
  ladder: boolean;
  threeSixes: boolean;
  rankAll: boolean;
}

export const DEFAULT_RULES: CNRules = { exitOn1: false, noJump: true, ladder: true, threeSixes: true, rankAll: false };

export interface CNState {
  /** Turn order (clockwise by colour); forfeited players are removed. */
  players: string[];
  colors: Record<string, number>;
  horses: Record<string, number[]>;
  turn: string | null;
  phase: "roll" | "move";
  die: number | null;
  sixes: number;
  legal: number[];
  phaseAt: number;
  deadline: number | null;
  rules: CNRules;
  status: "playing" | "ended";
  /** Players with every horse home, in order. */
  done: string[];
  /** Full ranking once the game ends. */
  finished: string[];
  rollSeq: number;
  roll: { seq: number; player: string; value: number } | null;
  last: CNMove | null;
  log: { id: number; at: number; text: string; tone?: "roll" | "move" | "kick" | "home" | "info" }[];
  logSeq: number;
  recorded?: boolean;
  turnMs?: number;
  forfeited?: string[];
}

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };
export type NameOf = (id: string) => string;
export type Random = () => number;

const turnMs = (s: CNState) => s.turnMs ?? TURN_MS;

function shuffle<T>(a: T[], random: Random): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function newCNGame(players: string[], now: number, opts: { rules?: Partial<CNRules>; turnMs?: number }, random: Random = Math.random): CNState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const order = shuffle(players, random);
  const colors = COLORS_FOR_PLAYERS[order.length];
  return {
    players: order,
    colors: Object.fromEntries(order.map((p, i) => [p, colors[i]])),
    horses: Object.fromEntries(order.map((p) => [p, Array.from({ length: HORSES }, () => STABLE)])),
    turn: order[0],
    phase: "roll",
    die: null,
    sixes: 0,
    legal: [],
    phaseAt: now,
    deadline: now + (opts.turnMs ?? TURN_MS),
    rules: { ...DEFAULT_RULES, ...opts.rules },
    status: "playing",
    done: [],
    finished: [],
    rollSeq: 0,
    roll: null,
    last: null,
    log: [],
    logSeq: 0,
    ...(opts.turnMs ? { turnMs: opts.turnMs } : {}),
  };
}

function log(s: CNState, now: number, text: string, tone?: CNState["log"][number]["tone"]) {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, tone }].slice(-LOG_LIMIT);
}

const colorName = (s: CNState, id: string) => COLOR_NAMES[COLORS[s.colors[id]]];

// ─── Moves ──────────────────────────────────────────────────────────

/** Who stands on a track square (at most one horse can). */
function occupant(s: CNState, square: number): { player: string; horse: number } | null {
  for (const player of [...s.players]) {
    const hs = s.horses[player];
    for (let h = 0; h < hs.length; h++) {
      if (hs[h] >= 0 && hs[h] <= GATE && trackIndex(s.colors[player], hs[h]) === square) return { player, horse: h };
    }
  }
  return null;
}

/** Any horse on this colour's track squares from progress `a` to `b` (inclusive)? */
function trackBlocked(s: CNState, color: number, a: number, b: number) {
  for (let p = a; p <= b; p++) if (occupant(s, trackIndex(color, p))) return true;
  return false;
}

const homeTaken = (s: CNState, id: string, p: number) => s.horses[id].includes(p);
function homeBlocked(s: CNState, id: string, a: number, b: number) {
  for (let p = a; p <= b; p++) if (homeTaken(s, id, p)) return true;
  return false;
}

type Target = { to: number; kicked: { player: string; horse: number } | null };

function landOnTrack(s: CNState, id: string, to: number): Target | null {
  const who = occupant(s, trackIndex(s.colors[id], to));
  if (who?.player === id) return null;
  return { to, kicked: who };
}

/** Where horse `h` would go with die `d`, or null if it can't move. */
export function targetOf(s: CNState, id: string, h: number, d: number): Target | null {
  const p = s.horses[id]?.[h];
  if (p === undefined) return null;
  const { noJump, ladder, exitOn1 } = s.rules;
  if (p === STABLE) return d === 6 || (exitOn1 && d === 1) ? landOnTrack(s, id, 0) : null;
  if (p <= GATE) {
    const to = p + d;
    if (to <= GATE) {
      if (noJump && trackBlocked(s, s.colors[id], p + 1, to - 1)) return null;
      return landOnTrack(s, id, to);
    }
    if (ladder ? to !== GATE + 1 : to > FINAL) return null;
    if (noJump && (trackBlocked(s, s.colors[id], p + 1, GATE) || homeBlocked(s, id, GATE + 1, to - 1))) return null;
    return homeTaken(s, id, to) ? null : { to, kicked: null };
  }
  const step = p - GATE;
  let to: number;
  if (ladder) {
    if (d !== step + 1 || p >= FINAL) return null;
    to = p + 1;
  } else {
    to = p + d;
    if (to > FINAL || (noJump && homeBlocked(s, id, p + 1, to - 1))) return null;
  }
  return homeTaken(s, id, to) ? null : { to, kicked: null };
}

export function legalMoves(s: CNState, id: string, d: number): number[] {
  return (s.horses[id] ?? []).map((_, h) => h).filter((h) => targetOf(s, id, h, d) !== null);
}

// ─── Turn flow ──────────────────────────────────────────────────────

/** Vietnamese rule: a player is home when their 4 horses fill the top 4 steps of the home column (steps 3–6). */
export const HOME_DONE_STEP = 3;
const allHome = (s: CNState, id: string) => s.horses[id].every((p) => p >= GATE + HOME_DONE_STEP);
const racing = (s: CNState) => s.players.filter((p) => !s.done.includes(p));
const progressOf = (s: CNState, id: string) => s.horses[id].reduce((t, p) => t + (p === STABLE ? 0 : p + 1), 0);

function startPhase(s: CNState, phase: CNState["phase"], now: number) {
  s.phase = phase;
  s.phaseAt = now;
  s.deadline = now + turnMs(s);
}

/** Next racing player after `from` in turn order (from may have left the list). */
function nextTurn(s: CNState, now: number, fromIdx = s.players.indexOf(s.turn!)) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const p = s.players[(fromIdx + k + n) % n];
    if (!s.done.includes(p)) {
      s.turn = p;
      break;
    }
  }
  s.die = null;
  s.sixes = 0;
  s.legal = [];
  startPhase(s, "roll", now);
}

function finish(s: CNState, now: number, names: NameOf) {
  const rest = racing(s)
    .map((p, i) => ({ p, i, prog: progressOf(s, p) }))
    .sort((a, b) => b.prog - a.prog || a.i - b.i)
    .map((x) => x.p);
  s.finished = [...s.done, ...rest, ...(s.forfeited ?? []).slice().reverse()];
  s.status = "ended";
  s.turn = null;
  s.deadline = null;
  s.die = null;
  s.legal = [];
  if (s.finished.length) log(s, now, `🏆 ${names(s.finished[0])} thắng!`, "home");
}

function check(s: CNState, id: string, phase: CNState["phase"]): Result | null {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.turn !== id) return fail("Chưa đến lượt bạn");
  if (s.phase !== phase) return fail(phase === "roll" ? "Hãy chọn ngựa để đi" : "Hãy gieo xúc xắc trước");
  return null;
}

export function rollDie(s: CNState, id: string, now: number, names: NameOf, random: Random = Math.random): Result {
  const bad = check(s, id, "roll");
  if (bad) return bad;
  const value = 1 + Math.min(5, Math.floor(random() * 6));
  s.rollSeq += 1;
  s.roll = { seq: s.rollSeq, player: id, value };
  if (value === 6) s.sixes += 1;
  if (value === 6 && s.rules.threeSixes && s.sixes >= 3) {
    log(s, now, `🎲 ${names(id)} gieo 6 lần thứ ba — mất lượt`, "info");
    nextTurn(s, now);
    return OK;
  }
  const legal = legalMoves(s, id, value);
  if (!legal.length) {
    if (value === 6) {
      log(s, now, `🎲 ${names(id)} gieo 6 nhưng không đi được — gieo tiếp`, "roll");
      s.die = null;
      startPhase(s, "roll", now);
    } else {
      log(s, now, `🎲 ${names(id)} gieo ${value} — không đi được`, "roll");
      nextTurn(s, now);
    }
    return OK;
  }
  s.die = value;
  s.legal = legal;
  startPhase(s, "move", now);
  return OK;
}

export function moveHorse(s: CNState, id: string, horse: unknown, now: number, names: NameOf): Result {
  const bad = check(s, id, "move");
  if (bad) return bad;
  if (typeof horse !== "number" || !s.legal.includes(horse)) return fail("Ngựa này không đi được");
  const die = s.die!;
  const target = targetOf(s, id, horse, die);
  if (!target) return fail("Ngựa này không đi được");
  const from = s.horses[id][horse];
  s.horses[id][horse] = target.to;
  let kicked: CNMove["kicked"] = null;
  if (target.kicked) {
    const { player, horse: kh } = target.kicked;
    kicked = { player, horse: kh, from: s.horses[player][kh] };
    s.horses[player][kh] = STABLE;
  }
  s.last = { seq: s.rollSeq, player: id, horse, from, to: target.to, kicked };
  const who = `${names(id)} (${colorName(s, id)})`;
  if (from === STABLE) log(s, now, `🐴 ${who} xuất quân`, "move");
  else if (target.to > GATE) log(s, now, `🏠 ${who} lên chuồng bậc ${target.to - GATE}`, "home");
  else log(s, now, `🐴 ${who} đi ${die} bước`, "move");
  if (kicked) log(s, now, `💥 ${names(id)} đá ngựa của ${names(kicked.player)} về chuồng`, "kick");

  if (allHome(s, id)) {
    s.done.push(id);
    log(s, now, `🎉 ${names(id)} đã đưa cả 4 ngựa về chuồng${s.done.length > 1 ? ` (hạng ${s.done.length})` : ""}`, "home");
    if (!s.rules.rankAll || racing(s).length < 2) {
      finish(s, now, names);
      return OK;
    }
    nextTurn(s, now);
    return OK;
  }
  if (die === 6) {
    s.die = null;
    s.legal = [];
    startPhase(s, "roll", now);
  } else nextTurn(s, now);
  return OK;
}

export function forfeitPlayer(s: CNState, id: string, now: number, names: NameOf): Result {
  if (s.status !== "playing" || !s.players.includes(id)) return fail("Người chơi không còn trong ván");
  const wasTurn = s.turn === id;
  const idx = s.players.indexOf(id);
  s.players = s.players.filter((p) => p !== id);
  s.done = s.done.filter((p) => p !== id);
  s.horses[id] = s.horses[id].map(() => STABLE);
  s.forfeited = [...(s.forfeited ?? []), id];
  log(s, now, `${names(id)} rời ván`, "info");
  if (s.players.length < 2 || racing(s).length < 2) {
    finish(s, now, names);
    return OK;
  }
  if (wasTurn) nextTurn(s, now, idx - 1);
  return OK;
}

// ─── Auto play ──────────────────────────────────────────────────────

/** Best horse for the bot: kick > into / up the home column > leave the stable > furthest along. */
export function bestMove(s: CNState, id: string): number | null {
  const d = s.die;
  if (d === null || !s.legal.length) return null;
  const score = (h: number) => {
    const t = targetOf(s, id, h, d)!;
    const from = s.horses[id][h];
    if (t.kicked) return 3000 + from;
    if (t.to > GATE) return 2000 + t.to;
    if (from === STABLE) return 1000;
    return from;
  };
  return s.legal.slice().sort((a, b) => score(b) - score(a))[0];
}

function autoStep(s: CNState, now: number, names: NameOf, random: Random) {
  const id = s.turn!;
  if (s.phase === "roll") {
    rollDie(s, id, now, names, random);
    if (s.status !== "playing" || s.turn !== id || (s.phase as CNState["phase"]) !== "move") return;
  }
  const h = bestMove(s, id);
  if (h !== null) moveHorse(s, id, h, now, names);
}

export function tickGame(s: CNState, now: number, names: NameOf, absent: (id: string) => boolean, random: Random = Math.random): boolean {
  if (s.status !== "playing" || !s.turn) return false;
  if (now >= (s.deadline ?? Infinity) || (absent(s.turn) && now >= s.phaseAt + ABSENT_MS)) {
    autoStep(s, now, names, random);
    return true;
  }
  return false;
}

export function nextGameTickAt(s: CNState, now: number): number | null {
  if (s.status !== "playing") return null;
  const absentAt = s.phaseAt + ABSENT_MS > now ? s.phaseAt + ABSENT_MS : null;
  const times = [s.deadline, absentAt].filter((x): x is number => typeof x === "number");
  return times.length ? Math.min(...times) : null;
}
