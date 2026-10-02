import {
  BOARD_SLOTS,
  CARDS,
  CARD_BY_ID,
  type Cost,
  type DevCard,
  GEMS,
  GEMS_FOR_PLAYERS,
  GEM_NAMES,
  GOLD_TOKENS,
  type Gem,
  MAX_PLAYERS,
  MAX_RESERVED,
  MAX_TOKENS,
  MIN_PLAYERS,
  NOBLES,
  NOBLE_BY_ID,
  type Token,
} from "./cards";

/**
 * Đá Quý (Splendor-style) state machine. Pure and timer-free: `now` and `random` are
 * passed in; `tickGame()` plays for players who time out or go offline.
 * Simplification: when several nobles could visit, the first one comes automatically.
 */

export const TURN_MS = 45_000;
export const ABSENT_MS = 2_500;
export const LOG_LIMIT = 16;

export type Tokens = Record<Token, number>;

export interface SPState {
  players: string[];
  turn: string | null;
  /** "discard": the current player holds more than 10 tokens and must return some. */
  phase: "turn" | "discard";
  discardNeed: number;
  phaseAt: number;
  deadline: number | null;
  bank: Tokens;
  tokens: Record<string, Tokens>;
  /** Bought development cards (ids). */
  owned: Record<string, number[]>;
  reserved: Record<string, number[]>;
  /** Reserved cards that were drawn blind from a deck (hidden from others). Missing on older saved games = all hidden. */
  blind?: number[];
  nobles: Record<string, number[]>;
  /** decks[tier-1], top first. */
  decks: number[][];
  /** Face-up cards per tier; null = empty slot (deck ran out). */
  board: (number | null)[][];
  nobleRow: number[];
  /** Points needed to trigger the end (the round is finished so everyone has had equal turns). */
  target: number;
  endTriggered: boolean;
  status: "playing" | "ended";
  finished: string[];
  /** Last thing that happened, for client animations. */
  last: { seq: number; player: string; kind: "take" | "reserve" | "buy" | "noble"; card?: number; noble?: number; gems?: Token[] } | null;
  log: { id: number; at: number; text: string; tone?: "buy" | "take" | "reserve" | "noble" | "info" }[];
  logSeq: number;
  recorded?: boolean;
  turnMs?: number;
  /** Players who left for good (kicked while offline); ranked last, first to leave lowest. */
  forfeited?: string[];
}

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };
export type NameOf = (id: string) => string;
export type Random = () => number;

const emptyTokens = (): Tokens => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
const turnMs = (s: SPState) => s.turnMs ?? TURN_MS;
const isGem = (x: unknown): x is Gem => typeof x === "string" && (GEMS as readonly string[]).includes(x);

function shuffle<T>(a: T[], random: Random): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function newSPGame(players: string[], now: number, opts: { target: number; turnMs?: number }, random: Random = Math.random): SPState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const per = GEMS_FOR_PLAYERS[players.length];
  const bank = emptyTokens();
  for (const g of GEMS) bank[g] = per;
  bank.gold = GOLD_TOKENS;
  const decks = [1, 2, 3].map((t) => shuffle(CARDS.filter((c) => c.tier === t).map((c) => c.id), random));
  const board = decks.map((d) => d.splice(0, BOARD_SLOTS));
  const order = shuffle(players, random);
  return {
    players: order,
    turn: order[0],
    phase: "turn",
    discardNeed: 0,
    phaseAt: now,
    deadline: now + (opts.turnMs ?? TURN_MS),
    bank,
    tokens: Object.fromEntries(order.map((p) => [p, emptyTokens()])),
    owned: Object.fromEntries(order.map((p) => [p, []])),
    reserved: Object.fromEntries(order.map((p) => [p, []])),
    blind: [],
    nobles: Object.fromEntries(order.map((p) => [p, []])),
    decks,
    board,
    nobleRow: shuffle(NOBLES.map((n) => n.id), random).slice(0, players.length + 1),
    target: opts.target,
    endTriggered: false,
    status: "playing",
    finished: [],
    last: null,
    log: [],
    logSeq: 0,
    ...(opts.turnMs ? { turnMs: opts.turnMs } : {}),
  };
}

function log(s: SPState, now: number, text: string, tone?: SPState["log"][number]["tone"]) {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, tone }].slice(-LOG_LIMIT);
}

// ─── Derived values ──────────────────────────────────────────────────

export function bonuses(s: SPState, id: string): Record<Gem, number> {
  const b = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const c of s.owned[id] ?? []) b[CARD_BY_ID[c].bonus] += 1;
  return b;
}

export function pointsOf(s: SPState, id: string) {
  const cards = (s.owned[id] ?? []).reduce((t, c) => t + CARD_BY_ID[c].points, 0);
  const nobles = (s.nobles[id] ?? []).reduce((t, n) => t + NOBLE_BY_ID[n].points, 0);
  return cards + nobles;
}

const tokenCount = (t: Tokens) => Object.values(t).reduce((a, b) => a + b, 0);

/** What buying `card` would cost this player: gems per colour and gold to cover the rest; null if unaffordable. */
export function paymentFor(s: SPState, id: string, card: DevCard): Tokens | null {
  const bonus = bonuses(s, id);
  const have = s.tokens[id];
  const pay = emptyTokens();
  let gold = 0;
  for (const g of GEMS) {
    const need = Math.max(0, (card.cost[g] ?? 0) - bonus[g]);
    const use = Math.min(need, have[g]);
    pay[g] = use;
    gold += need - use;
  }
  if (gold > have.gold) return null;
  pay.gold = gold;
  return pay;
}

const costText = (c: Cost) =>
  GEMS.filter((g) => c[g])
    .map((g) => `${c[g]} ${GEM_NAMES[g]}`)
    .join(", ");

// ─── Turn flow ──────────────────────────────────────────────────────

function check(s: SPState, id: string): Result | null {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (s.turn !== id) return fail("Chưa đến lượt bạn");
  if (s.phase !== "turn") return fail("Hãy trả bớt đá trước");
  return null;
}

/** After an action: discard down to 10, then nobles, end-of-game check and the next turn. */
function afterAction(s: SPState, id: string, now: number, names: NameOf) {
  const over = tokenCount(s.tokens[id]) - MAX_TOKENS;
  if (over > 0) {
    s.phase = "discard";
    s.discardNeed = over;
    s.phaseAt = now;
    s.deadline = now + turnMs(s);
    return;
  }
  endTurn(s, id, now, names);
}

function endTurn(s: SPState, id: string, now: number, names: NameOf) {
  const bonus = bonuses(s, id);
  const visiting = s.nobleRow.find((n) => Object.entries(NOBLE_BY_ID[n].req).every(([g, need]) => bonus[g as Gem] >= (need ?? 0)));
  if (visiting !== undefined) {
    s.nobleRow = s.nobleRow.filter((n) => n !== visiting);
    s.nobles[id].push(visiting);
    s.last = { seq: s.logSeq + 1, player: id, kind: "noble", noble: visiting };
    log(s, now, `👑 Quý tộc đến thăm ${names(id)} (+${NOBLE_BY_ID[visiting].points} điểm)`, "noble");
  }
  if (!s.endTriggered && pointsOf(s, id) >= s.target) {
    s.endTriggered = true;
    log(s, now, `🏁 ${names(id)} đạt ${pointsOf(s, id)} điểm — chơi nốt vòng này rồi kết thúc`, "info");
  }
  const i = s.players.indexOf(id);
  const next = s.players[(i + 1) % s.players.length];
  // The round ends when play comes back to the first player.
  if (s.endTriggered && next === s.players[0]) {
    finish(s, now, names);
    return;
  }
  s.turn = next;
  s.phase = "turn";
  s.discardNeed = 0;
  s.phaseAt = now;
  s.deadline = now + turnMs(s);
}

function finish(s: SPState, now: number, names: NameOf) {
  const order = s.players.map((p, i) => ({ p, i, pts: pointsOf(s, p), cards: s.owned[p].length }));
  order.sort((a, b) => b.pts - a.pts || a.cards - b.cards || a.i - b.i);
  s.finished = [...order.map((o) => o.p), ...(s.forfeited ?? []).slice().reverse()];
  s.status = "ended";
  s.turn = null;
  s.deadline = null;
  log(s, now, `🏆 ${names(s.finished[0])} thắng với ${order[0].pts} điểm!`, "noble");
}

export function takeGems(s: SPState, id: string, raw: unknown, now: number, names: NameOf): Result {
  const bad = check(s, id);
  if (bad) return bad;
  const gems = Array.isArray(raw) ? raw : [];
  if (!gems.every(isGem)) return fail("Chọn đá không hợp lệ");
  const picked = gems as Gem[];
  const distinct = new Set(picked);
  const available = GEMS.filter((g) => s.bank[g] > 0);
  if (picked.length === 2 && distinct.size === 1) {
    const g = picked[0];
    if (s.bank[g] < 4) return fail(`Chỉ lấy 2 ${GEM_NAMES[g]} khi còn ít nhất 4 viên`);
  } else {
    if (distinct.size !== picked.length || picked.length === 0 || picked.length > 3) return fail("Lấy 3 viên khác màu, hoặc 2 viên cùng màu");
    if (picked.length < Math.min(3, available.length)) return fail("Hãy lấy đủ 3 màu khác nhau");
    if (!picked.every((g) => s.bank[g] > 0)) return fail("Hết đá màu này");
  }
  for (const g of picked) {
    s.bank[g] -= 1;
    s.tokens[id][g] += 1;
  }
  s.last = { seq: s.logSeq + 1, player: id, kind: "take", gems: picked };
  log(s, now, `💎 ${names(id)} lấy ${picked.map((g) => GEM_NAMES[g]).join(", ")}`, "take");
  afterAction(s, id, now, names);
  return OK;
}

/** Take a face-up card (or refill its slot) off the board. */
function takeFromBoard(s: SPState, cardId: number): boolean {
  for (let t = 0; t < 3; t++) {
    const slot = s.board[t].indexOf(cardId);
    if (slot >= 0) {
      s.board[t][slot] = s.decks[t].shift() ?? null;
      return true;
    }
  }
  return false;
}

export function reserveCard(s: SPState, id: string, target: { card?: unknown; tier?: unknown }, now: number, names: NameOf): Result {
  const bad = check(s, id);
  if (bad) return bad;
  if (s.reserved[id].length >= MAX_RESERVED) return fail(`Chỉ giữ tối đa ${MAX_RESERVED} thẻ`);
  let cardId: number | undefined;
  let blind = false;
  if (typeof target.card === "number") {
    if (!s.board.some((row) => row.includes(target.card as number))) return fail("Thẻ không có trên bàn");
    cardId = target.card;
    takeFromBoard(s, cardId);
  } else if (target.tier === 1 || target.tier === 2 || target.tier === 3) {
    cardId = s.decks[target.tier - 1].shift();
    if (cardId === undefined) return fail("Chồng bài này đã hết");
    blind = true;
  } else return fail("Chọn thẻ để giữ");
  s.reserved[id].push(cardId);
  if (blind) s.blind = [...(s.blind ?? []), cardId];
  const gold = s.bank.gold > 0;
  if (gold) {
    s.bank.gold -= 1;
    s.tokens[id].gold += 1;
  }
  s.last = { seq: s.logSeq + 1, player: id, kind: "reserve", card: blind ? undefined : cardId };
  log(s, now, `📌 ${names(id)} giữ ${blind ? `1 thẻ úp cấp ${CARD_BY_ID[cardId].tier}` : "1 thẻ"}${gold ? " và lấy 1 Vàng" : ""}`, "reserve");
  afterAction(s, id, now, names);
  return OK;
}

export function buyCard(s: SPState, id: string, cardId: unknown, now: number, names: NameOf): Result {
  const bad = check(s, id);
  if (bad) return bad;
  if (typeof cardId !== "number" || !CARD_BY_ID[cardId]) return fail("Thẻ không hợp lệ");
  const fromReserve = s.reserved[id].includes(cardId);
  const onBoard = s.board.some((row) => row.includes(cardId));
  if (!fromReserve && !onBoard) return fail("Thẻ không có trên bàn hoặc trong tay bạn");
  const card = CARD_BY_ID[cardId];
  const pay = paymentFor(s, id, card);
  if (!pay) return fail(`Không đủ đá (cần ${costText(card.cost)})`);
  for (const t of Object.keys(pay) as Token[]) {
    s.tokens[id][t] -= pay[t];
    s.bank[t] += pay[t];
  }
  if (fromReserve) s.reserved[id] = s.reserved[id].filter((c) => c !== cardId);
  else takeFromBoard(s, cardId);
  s.owned[id].push(cardId);
  s.last = { seq: s.logSeq + 1, player: id, kind: "buy", card: cardId };
  log(s, now, `🛒 ${names(id)} mua thẻ ${GEM_NAMES[card.bonus]}${card.points ? ` (+${card.points} điểm)` : ""}`, "buy");
  afterAction(s, id, now, names);
  return OK;
}

export function discardTokens(s: SPState, id: string, raw: unknown, now: number, names: NameOf): Result {
  if (s.status !== "playing" || s.turn !== id || s.phase !== "discard") return fail("Không cần trả đá lúc này");
  const give = raw && typeof raw === "object" ? (raw as Partial<Record<Token, unknown>>) : {};
  const back = emptyTokens();
  let total = 0;
  for (const t of Object.keys(back) as Token[]) {
    const n = give[t];
    if (n === undefined) continue;
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > s.tokens[id][t]) return fail("Số đá trả không hợp lệ");
    back[t] = n as number;
    total += n as number;
  }
  if (total !== s.discardNeed) return fail(`Hãy trả đúng ${s.discardNeed} viên`);
  for (const t of Object.keys(back) as Token[]) {
    s.tokens[id][t] -= back[t];
    s.bank[t] += back[t];
  }
  log(s, now, `${names(id)} trả lại ${total} viên đá`, "info");
  endTurn(s, id, now, names);
  return OK;
}

/** Whether `id` can take gems, reserve or buy anything right now. */
export function hasLegalMove(s: SPState, id: string): boolean {
  if (GEMS.some((g) => s.bank[g] > 0)) return true;
  if (s.reserved[id].length < MAX_RESERVED && (s.board.some((row) => row.some((c) => c !== null)) || s.decks.some((d) => d.length > 0))) return true;
  const visible = [...s.board.flat().filter((c): c is number => c !== null), ...s.reserved[id]];
  return visible.some((c) => paymentFor(s, id, CARD_BY_ID[c]));
}

function skipTurn(s: SPState, id: string, now: number, names: NameOf) {
  log(s, now, `${names(id)} bỏ lượt`, "info");
  endTurn(s, id, now, names);
}

/** Only when there's no legal move at all (rare): skip the turn. */
export function passTurn(s: SPState, id: string, now: number, names: NameOf): Result {
  const bad = check(s, id);
  if (bad) return bad;
  if (hasLegalMove(s, id)) return fail("Bạn vẫn còn nước đi — lấy đá, giữ hoặc mua thẻ");
  skipTurn(s, id, now, names);
  return OK;
}

export function forfeitPlayer(s: SPState, id: string, now: number, names: NameOf): Result {
  if (s.status !== "playing" || !s.players.includes(id)) return fail("Người chơi không còn trong ván");
  const wasTurn = s.turn === id;
  const idx = s.players.indexOf(id);
  // Their tokens and reserved cards go back (cards to the bottom of their tier's deck); they rank last.
  for (const t of Object.keys(s.tokens[id]) as Token[]) s.bank[t] += s.tokens[id][t];
  s.tokens[id] = emptyTokens();
  for (const c of s.reserved[id]) s.decks[CARD_BY_ID[c].tier - 1].push(c);
  s.reserved[id] = [];
  if (s.blind) s.blind = s.blind.filter((c) => CARD_BY_ID[c] && !s.decks[CARD_BY_ID[c].tier - 1].includes(c));
  s.players = s.players.filter((p) => p !== id);
  s.forfeited = [...(s.forfeited ?? []), id];
  log(s, now, `${names(id)} rời ván`, "info");
  if (s.players.length < 2) {
    finish(s, now, names);
    return OK;
  }
  if (wasTurn) {
    const next = s.players[idx % s.players.length];
    // Same end-of-round rule as endTurn: play coming back to the first player ends a triggered last round.
    if (s.endTriggered && next === s.players[0]) {
      finish(s, now, names);
      return OK;
    }
    s.turn = next;
    s.phase = "turn";
    s.discardNeed = 0;
    s.phaseAt = now;
    s.deadline = now + turnMs(s);
  }
  return OK;
}

// ─── Auto play ──────────────────────────────────────────────────────

function autoStep(s: SPState, now: number, names: NameOf) {
  const id = s.turn!;
  if (s.phase === "discard") {
    // Return the colours held most of.
    const give = emptyTokens();
    let need = s.discardNeed;
    while (need > 0) {
      const t = (Object.keys(s.tokens[id]) as Token[])
        .filter((k) => k !== "gold" && s.tokens[id][k] - give[k] > 0)
        .sort((a, b) => s.tokens[id][b] - give[b] - (s.tokens[id][a] - give[a]))[0] ?? "gold";
      give[t] += 1;
      need -= 1;
    }
    discardTokens(s, id, give, now, names);
    return;
  }
  // Buy the best affordable card, else take gems, else pass.
  const visible = [...s.board.flat().filter((c): c is number => c !== null), ...s.reserved[id]];
  const affordable = visible.filter((c) => paymentFor(s, id, CARD_BY_ID[c])).sort((a, b) => CARD_BY_ID[b].points - CARD_BY_ID[a].points);
  if (affordable.length) {
    buyCard(s, id, affordable[0], now, names);
    return;
  }
  const gems = GEMS.filter((g) => s.bank[g] > 0)
    .sort((a, b) => s.bank[b] - s.bank[a])
    .slice(0, 3);
  if (gems.length) {
    takeGems(s, id, gems, now, names);
    return;
  }
  skipTurn(s, id, now, names);
}

export function tickGame(s: SPState, now: number, names: NameOf, absent: (id: string) => boolean): boolean {
  if (s.status !== "playing" || !s.turn) return false;
  if (now >= (s.deadline ?? Infinity) || (absent(s.turn) && now >= s.phaseAt + ABSENT_MS)) {
    autoStep(s, now, names);
    return true;
  }
  return false;
}

export function nextGameTickAt(s: SPState, now: number): number | null {
  if (s.status !== "playing") return null;
  const absentAt = s.phaseAt + ABSENT_MS > now ? s.phaseAt + ABSENT_MS : null;
  const times = [s.deadline, absentAt].filter((x): x is number => typeof x === "number");
  return times.length ? Math.min(...times) : null;
}
