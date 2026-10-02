import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  QUAN_NON_MIN,
  RESEED,
  START_DAN,
  cellsFor,
  isQuanCell,
  maxMovesFor,
  nextCell,
  quanCellsFor,
  quanIndex,
  rowOf,
  sideOfCell,
} from "./board";
import type { OQMove, OQReseed, OQStep } from "./protocol";

/**
 * Ô Ăn Quan state machine (2–4 players). Pure and timer-free: `now` and `random`
 * are passed in; `tickGame()` plays a random legal move for a player who times
 * out or goes offline. Board layout: see board.ts.
 */

export const TURN_MS = 30_000;
export const ABSENT_MS = 2_500;
export const LOG_LIMIT = 30;
/** Guard against an (in theory) endless relay of rải tiếp within one move. */
const MAX_STEPS = 2_000;

export interface OQState {
  /** players[i] owns the ô dân 6i+1 … 6i+5; the ô quan are the squares 6i (see board.ts). Seating order = turn order. */
  players: string[];
  turn: string | null;
  phaseAt: number;
  deadline: number | null;
  dan: number[];
  /** Quan piece still on square 0, 6, 12, 18 (one per player). */
  quan: boolean[];
  captured: Record<string, { dan: number; quan: number }>;
  /** Dân borrowed from other players to reseed an empty row (total per borrower). */
  borrowed: Record<string, number>;
  /** debts[borrower][lender] = dân owed. */
  debts: Record<string, Record<string, number>>;
  /** Players who could not reseed (or were kicked): they skip turns, their cells stay on the board. In elimination order. */
  out: string[];
  /** Final rank (0 = best, ties share) per player once the game has ended. */
  ranks: Record<string, number>;
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
const sideOf = (s: OQState, id: string) => s.players.indexOf(id);
const cellsOf = (s: OQState) => cellsFor(s.players.length);
const isOut = (s: OQState, id: string) => s.out.includes(id);
const activeOf = (s: OQState) => s.players.filter((p) => !isOut(s, p));
/** Next player still in the game after `id` in turn order (id itself if alone). */
function nextActive(s: OQState, id: string): string {
  const n = s.players.length;
  const at = sideOf(s, id);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(at + k) % n];
    if (!isOut(s, p)) return p;
  }
  return id;
}

export function newOQGame(
  players: string[],
  now: number,
  opts: { quanValue: number; quanNon: boolean; turnMs?: number },
  random: Random = Math.random,
): OQState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`need ${MIN_PLAYERS} players`);
  let order: string[];
  if (players.length === 2) order = random() < 0.5 ? players.slice() : players.slice().reverse();
  else {
    order = players.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const dan = Array.from({ length: cellsFor(order.length) }, (_, c) => (isQuanCell(c) ? 0 : START_DAN));
  return {
    players: order,
    turn: order[0],
    phaseAt: now,
    deadline: now + (opts.turnMs ?? TURN_MS),
    dan,
    quan: order.map(() => true),
    captured: Object.fromEntries(order.map((p) => [p, { dan: 0, quan: 0 }])),
    borrowed: Object.fromEntries(order.map((p) => [p, 0])),
    debts: Object.fromEntries(order.map((p) => [p, {}])),
    out: [],
    ranks: {},
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

/** Dân still owed to `id` by the other players. */
export function lentOf(s: OQState, id: string) {
  return s.players.reduce((t, p) => t + (p === id ? 0 : (s.debts[p]?.[id] ?? 0)), 0);
}

/** dân + quan × value − borrowed + lent to the other players. */
export function scoreOf(s: OQState, id: string) {
  const c = s.captured[id];
  if (!c) return 0;
  return c.dan + c.quan * s.quanValue - (s.borrowed[id] ?? 0) + lentOf(s, id);
}

const isEmpty = (s: OQState, c: number) => s.dan[c] === 0 && !(isQuanCell(c) && s.quan[quanIndex(c)]);

/** Every (square, direction) the player may choose now. */
export function legalMoves(s: OQState, id: string): { cell: number; dir: 1 | -1 }[] {
  if (s.status !== "playing" || s.turn !== id) return [];
  const out: { cell: number; dir: 1 | -1 }[] = [];
  for (const cell of rowOf(sideOf(s, id))) if (s.dan[cell] > 0) out.push({ cell, dir: 1 }, { cell, dir: -1 });
  return out;
}

// ─── Moves ───────────────────────────────────────────────────────────

/** Sow from `start`, keep sowing (rải tiếp), then capture (ăn, ăn liên tiếp). Mutates the board. */
function sow(s: OQState, id: string, start: number, dir: 1 | -1, steps: OQStep[]) {
  const cells = cellsOf(s);
  const next = (c: number) => nextCell(c, dir, cells);
  let cell = start;
  let hand = s.dan[cell];
  s.dan[cell] = 0;
  steps.push({ k: "pick", cell, n: hand });
  for (let guard = 0; guard < MAX_STEPS; guard++) {
    while (hand > 0) {
      cell = next(cell);
      s.dan[cell] += 1;
      hand -= 1;
      steps.push({ k: "sow", cell });
    }
    const n1 = next(cell);
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
      const t = next(gap);
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
      gap = next(t);
      if (!isEmpty(s, gap)) return;
    }
  }
}

export function makeMove(s: OQState, id: string, cell: unknown, dir: unknown, now: number, names: NameOf, auto = false): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.turn !== id) return fail("Chưa đến lượt bạn");
  if (dir !== 1 && dir !== -1) return fail("Chọn hướng rải trái hoặc phải");
  if (typeof cell !== "number" || !Number.isInteger(cell) || sideOfCell(cell) !== sideOf(s, id) || cell >= cellsOf(s)) return fail("Chỉ được chọn ô dân bên mình");
  if (s.dan[cell] === 0) return fail("Ô này đang trống");
  const before = { dan: s.dan.slice(), quan: s.quan.slice() };
  const steps: OQStep[] = [];
  sow(s, id, cell, dir, steps);
  s.moves += 1;
  s.lastMove = { seq: s.logSeq + 1, at: now, player: id, cell, dir, before, steps, ...(auto ? { auto: true } : {}) };

  const caps = steps.filter((x): x is Extract<OQStep, { k: "capture" }> => x.k === "capture");
  const gotDan = caps.reduce((t, x) => t + x.dan, 0);
  const gotQuan = caps.filter((x) => x.quan).length;
  const where = `ô ${rowOf(sideOf(s, id)).indexOf(cell) + 1}`;
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
  const quanCleared = quanCellsFor(s.players.length).every((c) => !s.quan[quanIndex(c)] && s.dan[c] === 0);
  if (quanCleared) return finishBoard(s, now, names, "board");
  if (s.moves >= maxMovesFor(s.players.length)) return finishBoard(s, now, names, "limit");
  beginTurn(s, nextActive(s, id), now, names);
}

/**
 * Start `id`'s turn: rải quân first if their row is empty. The 5 dân come from their own pile first, then are
 * borrowed (per lender, tracked in `debts`) from the next players in turn order who still have dân. If the
 * piles of everyone still playing can't cover it, `id` is out: skips turns, their cells stay on the board.
 */
function beginTurn(s: OQState, id: string, now: number, names: NameOf) {
  const row = rowOf(sideOf(s, id));
  if (row.every((c) => s.dan[c] === 0)) {
    const lenders: string[] = [];
    for (let p = nextActive(s, id); p !== id && !lenders.includes(p); p = nextActive(s, p)) lenders.push(p);
    const own = s.captured[id].dan;
    if (own + lenders.reduce((t, p) => t + s.captured[p].dan, 0) < RESEED) {
      log(s, now, `${names(id)} hết dân để rải lại — bị loại`, "info");
      return eliminate(s, id, now, names, "stuck");
    }
    const useOwn = Math.min(own, RESEED);
    s.captured[id].dan -= useOwn;
    let need = RESEED - useOwn;
    const from: { id: string; n: number }[] = [];
    for (const p of lenders) {
      if (need <= 0) break;
      const n = Math.min(need, s.captured[p].dan);
      if (n <= 0) continue;
      s.captured[p].dan -= n;
      s.debts[id][p] = (s.debts[id][p] ?? 0) + n;
      s.borrowed[id] += n;
      need -= n;
      from.push({ id: p, n });
    }
    const borrow = from.reduce((t, x) => t + x.n, 0);
    for (const c of row) s.dan[c] = 1;
    s.lastReseed = { seq: s.logSeq + 1, player: id, borrowed: borrow, ...(from.length ? { lenders: from } : {}) };
    const via = from.map((x) => `${names(x.id)} ${x.n} dân`).join(", ");
    log(s, now, `${names(id)} rải quân: đặt 5 dân lên hàng của mình${borrow ? ` (vay ${via})` : ""}`, "info");
  }
  s.turn = id;
  s.phaseAt = now;
  s.deadline = now + turnMs(s);
}

/** `id` can no longer play. One player left → they win; otherwise the turn passes on if it was theirs. */
function eliminate(s: OQState, id: string, now: number, names: NameOf, reason: "stuck" | "forfeit") {
  // In the "stuck" case `id` was about to start their turn (s.turn still names the previous mover).
  const passOn = reason === "stuck" || s.turn === id;
  if (!isOut(s, id)) s.out = [...s.out, id];
  const alive = activeOf(s);
  if (alive.length <= 1) return finish(s, now, names, reason, alive[0] ?? null);
  if (passOn) beginTurn(s, nextActive(s, id), now, names);
}

/** Both ô quan are cleared (or the move limit hit): each remaining player collects the dân on their own row. */
function finishBoard(s: OQState, now: number, names: NameOf, reason: "board" | "limit") {
  for (const id of activeOf(s)) {
    let n = 0;
    for (const c of rowOf(sideOf(s, id))) {
      n += s.dan[c];
      s.dan[c] = 0;
    }
    s.captured[id].dan += n;
  }
  // On the move limit, whatever is still on the ô quan squares (and on rows of players who are out) counts for nobody.
  log(s, now, reason === "board" ? "Hết quan, kéo quân về — tính điểm" : "Đã quá số nước — kéo quân về, tính điểm", "info");
  finish(s, now, names, reason, null);
}

/**
 * End the game. Ranking: players still in, best score first (ties share a rank); then the players who are out,
 * the one who lasted longest first. `winner` is the outright first place (null if shared). `sole` is the last
 * one standing, who wins regardless of score.
 */
function finish(s: OQState, now: number, names: NameOf, reason: OQState["endReason"], sole: string | null) {
  s.status = "ended";
  s.endReason = reason;
  s.turn = null;
  s.deadline = null;
  const alive = activeOf(s);
  const order = [...alive.slice().sort((x, y) => scoreOf(s, y) - scoreOf(s, x)), ...s.out.slice().reverse()];
  const ranks: Record<string, number> = {};
  order.forEach((id, i) => {
    const prev = order[i - 1];
    ranks[id] = i > 0 && alive.includes(id) && alive.includes(prev) && scoreOf(s, id) === scoreOf(s, prev) ? ranks[prev] : i;
  });
  s.ranks = ranks;
  s.finished = order;
  const top = order.filter((id) => ranks[id] === 0);
  s.winner = sole ?? (top.length === 1 ? top[0] : null);
  const list = order.map((id) => String(scoreOf(s, id))).join(" – ");
  if (s.winner) log(s, now, `🏆 ${names(s.winner)} thắng ${list}`, "win");
  else log(s, now, `🤝 Hoà ${list}`, "win");
}

/** A player leaves for good (kicked while offline): they are out. The last one standing wins. */
export function forfeitPlayer(s: OQState, id: string, now: number, names: NameOf): Result {
  if (s.status !== "playing" || !s.players.includes(id)) return fail("Người chơi không còn trong ván");
  log(s, now, `${names(id)} rời ván`, "info");
  eliminate(s, id, now, names, "forfeit");
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
