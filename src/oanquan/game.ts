import {
  CELLS,
  MAX_MOVES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  QUAN_CELLS,
  QUAN_NON_MIN,
  RESEED,
  ROWS,
  START_DAN,
  isQuanCell,
  nextCell,
  quanIndex,
  sideOfCell,
} from "./board";
import type { OQMove, OQReseed, OQStep } from "./protocol";

/**
 * Ô Ăn Quan state machine (2 players). Pure and timer-free: `now` and `random`
 * are passed in; `tickGame()` plays a random legal move for a player who times
 * out or goes offline. Board layout: see board.ts.
 */

export const TURN_MS = 30_000;
export const ABSENT_MS = 2_500;
export const LOG_LIMIT = 30;
/** Guard against an (in theory) endless relay of rải tiếp within one move. */
const MAX_STEPS = 2_000;

export interface OQState {
  /** players[0] owns squares 1–5, players[1] owns 7–11. */
  players: string[];
  turn: string | null;
  phaseAt: number;
  deadline: number | null;
  dan: number[];
  /** Quan piece still on square 0 / square 6. */
  quan: boolean[];
  captured: Record<string, { dan: number; quan: number }>;
  /** Dân borrowed from the opponent to reseed an empty row. */
  borrowed: Record<string, number>;
  quanValue: number;
  quanNon: boolean;
  moves: number;
  status: "playing" | "ended";
  finished: string[];
  winner: string | null;
  endReason: "board" | "stuck" | "forfeit" | "limit" | null;
  lastMove: OQMove | null;
  lastReseed: OQReseed | null;
  log: { id: number; at: number; text: string; tone?: "sow" | "capture" | "quan" | "info" | "win" }[];
  logSeq: number;
  recorded?: boolean;
  turnMs?: number;
}

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };
export type NameOf = (id: string) => string;
export type Random = () => number;

const turnMs = (s: OQState) => s.turnMs ?? TURN_MS;
const other = (s: OQState, id: string) => s.players.find((p) => p !== id)!;
const sideOf = (s: OQState, id: string) => s.players.indexOf(id) as 0 | 1;

export function newOQGame(
  players: string[],
  now: number,
  opts: { quanValue: number; quanNon: boolean; turnMs?: number },
  random: Random = Math.random,
): OQState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`need ${MIN_PLAYERS} players`);
  const order = random() < 0.5 ? players.slice() : players.slice().reverse();
  const dan = Array.from({ length: CELLS }, (_, c) => (isQuanCell(c) ? 0 : START_DAN));
  return {
    players: order,
    turn: order[0],
    phaseAt: now,
    deadline: now + (opts.turnMs ?? TURN_MS),
    dan,
    quan: [true, true],
    captured: Object.fromEntries(order.map((p) => [p, { dan: 0, quan: 0 }])),
    borrowed: Object.fromEntries(order.map((p) => [p, 0])),
    quanValue: opts.quanValue,
    quanNon: opts.quanNon,
    moves: 0,
    status: "playing",
    finished: [],
    winner: null,
    endReason: null,
    lastMove: null,
    lastReseed: null,
    log: [],
    logSeq: 0,
    ...(opts.turnMs ? { turnMs: opts.turnMs } : {}),
  };
}

function log(s: OQState, now: number, text: string, tone?: OQState["log"][number]["tone"]) {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, tone }].slice(-LOG_LIMIT);
}

// ─── Derived values ──────────────────────────────────────────────────

/** dân + quan × value − borrowed + lent to the opponent. */
export function scoreOf(s: OQState, id: string) {
  const c = s.captured[id];
  if (!c) return 0;
  const opp = other(s, id);
  return c.dan + c.quan * s.quanValue - (s.borrowed[id] ?? 0) + (opp ? (s.borrowed[opp] ?? 0) : 0);
}

const isEmpty = (s: OQState, c: number) => s.dan[c] === 0 && !(isQuanCell(c) && s.quan[quanIndex(c)]);

/** Every (square, direction) the player may choose now. */
export function legalMoves(s: OQState, id: string): { cell: number; dir: 1 | -1 }[] {
  if (s.status !== "playing" || s.turn !== id) return [];
  const out: { cell: number; dir: 1 | -1 }[] = [];
  for (const cell of ROWS[sideOf(s, id)]) if (s.dan[cell] > 0) out.push({ cell, dir: 1 }, { cell, dir: -1 });
  return out;
}

// ─── Moves ───────────────────────────────────────────────────────────

/** Sow from `start`, keep sowing (rải tiếp), then capture (ăn, ăn liên tiếp). Mutates the board. */
function sow(s: OQState, id: string, start: number, dir: 1 | -1, steps: OQStep[]) {
  let cell = start;
  let hand = s.dan[cell];
  s.dan[cell] = 0;
  steps.push({ k: "pick", cell, n: hand });
  for (let guard = 0; guard < MAX_STEPS; guard++) {
    while (hand > 0) {
      cell = nextCell(cell, dir);
      s.dan[cell] += 1;
      hand -= 1;
      steps.push({ k: "sow", cell });
    }
    const n1 = nextCell(cell, dir);
    if (!isEmpty(s, n1)) {
      // An ô quan can't be picked up: the turn ends.
      if (isQuanCell(n1)) return;
      hand = s.dan[n1];
      s.dan[n1] = 0;
      cell = n1;
      steps.push({ k: "pick", cell, n: hand });
      continue;
    }
    // Empty square: capture what follows, as long as the pattern empty → full repeats.
    let gap = n1;
    for (;;) {
      const t = nextCell(gap, dir);
      if (isEmpty(s, t)) return;
      const hasQuan = isQuanCell(t) && s.quan[quanIndex(t)];
      if (hasQuan && s.quanNon && s.dan[t] < QUAN_NON_MIN) return;
      const dan = s.dan[t];
      s.captured[id].dan += dan;
      s.dan[t] = 0;
      if (hasQuan) {
        s.quan[quanIndex(t)] = false;
        s.captured[id].quan += 1;
      }
      steps.push({ k: "capture", cell: t, dan, quan: hasQuan });
      gap = nextCell(t, dir);
      if (!isEmpty(s, gap)) return;
    }
  }
}

export function makeMove(s: OQState, id: string, cell: unknown, dir: unknown, now: number, names: NameOf, auto = false): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.turn !== id) return fail("Chưa đến lượt bạn");
  if (dir !== 1 && dir !== -1) return fail("Chọn hướng rải trái hoặc phải");
  if (typeof cell !== "number" || !Number.isInteger(cell) || sideOfCell(cell) !== sideOf(s, id)) return fail("Chỉ được chọn ô dân bên mình");
  if (s.dan[cell] === 0) return fail("Ô này đang trống");
  const before = { dan: s.dan.slice(), quan: s.quan.slice() };
  const steps: OQStep[] = [];
  sow(s, id, cell, dir, steps);
  s.moves += 1;
  s.lastMove = { seq: s.logSeq + 1, player: id, cell, dir, before, steps, ...(auto ? { auto: true } : {}) };

  const caps = steps.filter((x): x is Extract<OQStep, { k: "capture" }> => x.k === "capture");
  const gotDan = caps.reduce((t, x) => t + x.dan, 0);
  const gotQuan = caps.filter((x) => x.quan).length;
  const where = `ô ${ROWS[sideOf(s, id)].indexOf(cell) + 1}`;
  const way = dir === 1 ? "phải" : "trái";
  const prefix = `${auto ? "⏱ " : ""}${names(id)} rải ${where} sang ${way}`;
  if (caps.length) {
    const parts = [gotQuan ? `${gotQuan} quan` : "", gotDan ? `${gotDan} dân` : ""].filter(Boolean).join(" + ");
    log(s, now, `${prefix} — ăn ${parts}${caps.length > 1 ? ` (${caps.length} ô liên tiếp)` : ""}`, gotQuan ? "quan" : "capture");
  } else log(s, now, `${prefix}`, "sow");

  endTurn(s, id, now, names);
  return OK;
}

function endTurn(s: OQState, id: string, now: number, names: NameOf) {
  const quanCleared = QUAN_CELLS.every((c) => !s.quan[quanIndex(c)] && s.dan[c] === 0);
  if (quanCleared) return finishBoard(s, now, names, "board");
  if (s.moves >= MAX_MOVES) return finishBoard(s, now, names, "limit");
  beginTurn(s, other(s, id), now, names);
}

/** Start `id`'s turn: rải quân first if their row is empty. */
function beginTurn(s: OQState, id: string, now: number, names: NameOf) {
  const row = ROWS[sideOf(s, id)];
  if (row.every((c) => s.dan[c] === 0)) {
    const opp = other(s, id);
    const own = s.captured[id].dan;
    if (own + s.captured[opp].dan < RESEED) {
      log(s, now, `${names(id)} hết dân để rải lại — thua`, "info");
      return finish(s, now, names, "stuck", opp);
    }
    const borrow = Math.max(0, RESEED - own);
    s.captured[id].dan -= RESEED - borrow;
    s.captured[opp].dan -= borrow;
    s.borrowed[id] += borrow;
    for (const c of row) s.dan[c] = 1;
    s.lastReseed = { seq: s.logSeq + 1, player: id, borrowed: borrow };
    log(s, now, `${names(id)} rải quân: đặt 5 dân lên hàng của mình${borrow ? ` (vay ${names(opp)} ${borrow} dân)` : ""}`, "info");
  }
  s.turn = id;
  s.phaseAt = now;
  s.deadline = now + turnMs(s);
}

/** Both ô quan are cleared (or the move limit hit): each side collects the dân on its own row. */
function finishBoard(s: OQState, now: number, names: NameOf, reason: "board" | "limit") {
  for (const id of s.players) {
    let n = 0;
    for (const c of ROWS[sideOf(s, id)]) {
      n += s.dan[c];
      s.dan[c] = 0;
    }
    s.captured[id].dan += n;
  }
  // On the move limit, whatever is still on the ô quan squares counts for nobody.
  log(s, now, reason === "board" ? "Hết quan, kéo quân về — tính điểm" : "Đã quá số nước — kéo quân về, tính điểm", "info");
  const [a, b] = s.players;
  const sa = scoreOf(s, a);
  const sb = scoreOf(s, b);
  finish(s, now, names, reason, sa === sb ? null : sa > sb ? a : b);
}

function finish(s: OQState, now: number, names: NameOf, reason: OQState["endReason"], winner: string | null) {
  s.status = "ended";
  s.endReason = reason;
  s.winner = winner;
  s.turn = null;
  s.deadline = null;
  const [a, b] = s.players;
  s.finished = winner ? [winner, other(s, winner)] : [a, b];
  if (winner) {
    const loser = other(s, winner);
    log(s, now, `🏆 ${names(winner)} thắng ${scoreOf(s, winner)} – ${scoreOf(s, loser)}`, "win");
  } else log(s, now, `🤝 Hoà ${scoreOf(s, a)} – ${scoreOf(s, b)}`, "win");
}

/** A player leaves for good (kicked while offline): the other one wins. */
export function forfeitPlayer(s: OQState, id: string, now: number, names: NameOf): Result {
  if (s.status !== "playing" || !s.players.includes(id)) return fail("Người chơi không còn trong ván");
  log(s, now, `${names(id)} rời ván`, "info");
  finish(s, now, names, "forfeit", other(s, id));
  return OK;
}

// ─── Auto play ──────────────────────────────────────────────────────

export function tickGame(s: OQState, now: number, names: NameOf, absent: (id: string) => boolean, random: Random = Math.random): boolean {
  if (s.status !== "playing" || !s.turn) return false;
  if (now >= (s.deadline ?? Infinity) || (absent(s.turn) && now >= s.phaseAt + ABSENT_MS)) {
    const moves = legalMoves(s, s.turn);
    const pick = moves[Math.min(moves.length - 1, Math.floor(random() * moves.length))];
    if (!pick) return false; // cannot happen: beginTurn always leaves a non-empty row
    makeMove(s, s.turn, pick.cell, pick.dir, now, names, true);
    return true;
  }
  return false;
}

export function nextGameTickAt(s: OQState, now: number): number | null {
  if (s.status !== "playing") return null;
  const absentAt = s.phaseAt + ABSENT_MS > now ? s.phaseAt + ABSENT_MS : null;
  const times = [s.deadline, absentAt].filter((x): x is number => typeof x === "number");
  return times.length ? Math.min(...times) : null;
}
