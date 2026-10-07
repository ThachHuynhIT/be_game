import {
  ACTION_TYPES,
  ALL_TYPES,
  CLAIRVOYANCE,
  CAT_TYPES,
  type CardType,
  type Expansion,
  KITTENS,
  type MCard,
  MIN_PLAYERS,
  NOW_TYPES,
  WILD_CAT,
  deal,
  maxPlayers,
  shuffle,
} from "./cards";

/**
 * Mèo Nổ game state machine. Pure and timer-free: `now` is passed in, and
 * `tickGame()` resolves whatever is due (Nope windows, pending choices, turn timeouts).
 */

/** After an action card, everyone gets this long to answer with "Không!" (Nope). Each Nope restarts it. */
export const NOPE_WINDOW_MS = 7_000;
export const TURN_MS = 30_000;
/** Time to answer a choice (hide a kitten, give a card for Xin xỏ, reorder the future). */
export const CHOICE_MS = 15_000;
export const LOG_LIMIT = 60;

export type PendingKind =
  | "attack"
  | "skip"
  | "favor"
  | "shuffle"
  | "future"
  | "reverse"
  | "bottom"
  | "alter"
  | "targeted"
  | "superskip"
  | "swap"
  | "catomic"
  | "future5"
  | "garbage"
  | "mark"
  | "curse"
  | "barking"
  | "potluck"
  | "ilt"
  | "alternow"
  | "bury"
  | "personal"
  | "share"
  | "zombie"
  | "feed"
  | "dig"
  | "grave"
  | "deadattack"
  | "slap"
  | "annoy"
  | "steal"
  | "rollcall"
  | "corn"
  | "pair"
  | "triple"
  | "five";

export interface Pending {
  kind: PendingKind;
  by: string;
  target: string | null;
  /** Triple: the card type asked for. Five: the card type to take from the discard pile. */
  named: CardType | null;
  cards: MCard[];
  nopes: number;
  /** Who played the most recent Không! (null before any). They can't nope their own card. */
  lastNoper?: string | null;
  deadline: number;
}

export type Choice =
  /** Hide a kitten back in the deck — after a Defuse, or the first draw of the Imploding Kitten (face up). */
  | {
      kind: "defuse" | "implode";
      player: string;
      kitten: MCard;
      deadline: number;
      /** false when the kitten was not drawn on this player's turn (a held kitten, see settleHeld). */
      endsTurn?: boolean;
    }
  | { kind: "favor"; from: string; to: string; deadline: number }
  /** Sửa tương lai (and Chia sẻ tương lai when `share`): put the top cards back in a new order. */
  | { kind: "alter"; player: string; cards: MCard[]; deadline: number; share?: boolean }
  /** Dọn rác / Góp nồi: each player in turn gives one card (shuffled in / put on top). */
  | { kind: "offer"; mode: OfferMode; player: string; queue: string[]; deadline: number }
  /** Đào sâu: look at the top card, keep it or take the next one. */
  | { kind: "dig"; player: string; deadline: number }
  /** Chôn bài: put the (unseen) top card back anywhere; ends the turn. */
  | { kind: "bury"; player: string; card: MCard; deadline: number };

/** Dọn rác (into the deck, shuffled) · Góp nồi (on top) · Nuôi xác sống (to the discard pile). */
export type OfferMode = "garbage" | "potluck" | "feed";

export interface LogEntry {
  id: number;
  at: number;
  text: string;
  /** For UI emphasis. */
  tone?: "boom" | "defuse" | "nope" | "steal" | "info";
  /** The PlayRecord id this line announces (the UI shows the play's cards in its place). */
  play?: number;
}

export interface MeoState {
  /** Seat order (turn order when `dir` is 1). */
  players: string[];
  expansions: Expansion[];
  hands: Record<string, MCard[]>;
  /** deck[0] is the top card. */
  deck: MCard[];
  discard: MCard[];
  turn: string | null;
  /** 1 = seat order, −1 = reversed (Đảo chiều). */
  dir: 1 | -1;
  /** Turns the current player still has to take (Attack stacks them). */
  turnsLeft: number;
  turnDeadline: number | null;
  pending: Pending | null;
  choice: Choice | null;
  /** Top cards shown privately to one player by Xem tương lai (cleared when their turn ends). */
  future: { player: string; cards: MCard[] } | null;
  /** Elimination order, first out first. */
  out: string[];
  status: "playing" | "ended";
  /** Final ranking once ended: winner first, first eliminated last. */
  finished: string[];
  log: LogEntry[];
  logSeq: number;
  /** Set once the finished game has been scored by the room. */
  recorded?: boolean;
  /** Room settings for this game (fall back to TURN_MS / NOPE_WINDOW_MS). */
  turnMs?: number;
  nopeMs?: number;
  /** Để đó cho tui: the victim's next draw goes to `by` instead. */
  claims?: { victim: string; by: string }[];
  /** Lời nguyền mông mèo: these players see their hand face down until their next turn ends. */
  cursed?: string[];
  /** Blind order of a cursed player's hand (card ids); the client only sees positions. */
  curseOrder?: Record<string, number[]>;
  /** Chia sẻ tương lai: top cards shown to the next player too. */
  shared?: { player: string; cards: MCard[] } | null;
  /** Thấu thị: players watching the current kitten being hidden. */
  seers?: string[];
  /** What a Thấu thị player saw (private). */
  visions?: Record<string, { text: string; at: number }>;
  /** Kicked players can't be brought back by Mèo Xác Sống. */
  noRevive?: string[];
  /** Tát: extra turns waiting for a player, added when their turn starts. */
  extra?: Record<string, number>;
  /** Nổi cáu: cards that can't be used until the end of their owner's next turn. */
  annoyed?: { player: string; card: number }[];
  /** Xáo bài is locked until this player's turn ends (Điểm danh mèo / Lời nguyền ngô pha lê). */
  noShuffle?: string | null;
  /** Card history: every play (newest last), with who answered it with Không! and how it ended. */
  plays?: PlayRecord[];
}

export interface PlayRecord {
  id: number;
  at: number;
  by: string;
  kind: string;
  cards: CardType[];
  target: string | null;
  named: CardType | null;
  /** Players who played Không!, in order. */
  nopes: string[];
  /** Filled in when the action resolves. */
  result: "pending" | "done" | "blocked";
}

const PLAY_LIMIT = 60;

export interface MeoOptions {
  turnMs?: number;
  nopeMs?: number;
}

const turnMs = (s: MeoState) => s.turnMs ?? TURN_MS;
const nopeMs = (s: MeoState) => s.nopeMs ?? NOPE_WINDOW_MS;

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

/** Display names are supplied by the room for log lines. */
export type NameOf = (id: string) => string;

export const CARD_NAMES: Record<CardType, string> = {
  exploding: "Mèo Nổ",
  defuse: "Gỡ bom",
  attack: "Tấn công",
  skip: "Bỏ lượt",
  favor: "Xin xỏ",
  shuffle: "Xáo bài",
  future: "Xem tương lai",
  nope: "Không!",
  taco: "Mèo Taco",
  melon: "Mèo Dưa Hấu",
  potato: "Mèo Khoai Tây",
  beard: "Mèo Râu",
  rainbow: "Mèo Cầu Vồng",
  imploding: "Mèo Tự Huỷ",
  reverse: "Đảo chiều",
  bottom: "Rút từ đáy",
  feral: "Mèo Hoang",
  alter: "Sửa tương lai",
  targeted: "Tấn công chỉ định",
  superskip: "Siêu bỏ lượt",
  swap: "Đổi đầu đuôi",
  catomic: "Bom Mèo Nguyên Tử",
  streaking: "Mèo Chạy Rông",
  future5: "Xem tương lai ×5",
  garbage: "Dọn rác",
  mark: "Đánh dấu",
  curse: "Lời nguyền mông mèo",
  barking: "Mèo Sủa",
  potluck: "Góp nồi",
  ilt: "Để đó cho tui",
  alternow: "Sửa tương lai ngay",
  bury: "Chôn bài",
  personal: "Tự tấn công",
  share: "Chia sẻ tương lai",
  zombie: "Mèo Xác Sống",
  feed: "Nuôi xác sống",
  dig: "Đào sâu",
  clone: "Nhân bản",
  grave: "Đào mộ",
  deadattack: "Xác sống tấn công",
  clairvoyance: "Thấu thị",
  slap: "Tát",
  annoy: "Nổi cáu",
  steal: "Cướp bài",
  rollcall: "Điểm danh mèo",
  corn: "Lời nguyền ngô pha lê",
};

const isAnnoyed = (s: MeoState, id: number) => !!s.annoyed?.some((a) => a.card === id);
/** A usable (not annoyed) Gỡ bom in this hand. */
const usableDefuse = (s: MeoState, player: string) => s.hands[player]?.find((c) => c.type === "defuse" && !isAnnoyed(s, c.id));

/** Actions Nhân bản can copy (the effect is replayed with no target). */
const CLONEABLE: CardType[] = [
  "attack", "skip", "shuffle", "future", "reverse", "bottom", "alter", "superskip", "swap", "catomic",
  "future5", "garbage", "potluck", "alternow", "bury", "personal", "share", "feed", "dig", "grave", "deadattack",
  "slap", "rollcall", "corn",
];

export function newMeoGame(
  players: string[],
  now: number,
  expansions: Expansion[] = [],
  random: () => number = Math.random,
  opts: MeoOptions = {},
): MeoState {
  if (players.length < MIN_PLAYERS || players.length > maxPlayers(expansions)) {
    throw new Error(`Cần ${MIN_PLAYERS}-${maxPlayers(expansions)} người chơi`);
  }
  const { hands, deck } = deal(players, expansions, random);
  return {
    players: players.slice(),
    expansions: expansions.slice(),
    hands,
    deck,
    discard: [],
    turn: players[Math.floor(random() * players.length)],
    dir: 1,
    turnsLeft: 1,
    turnDeadline: now + (opts.turnMs ?? TURN_MS),
    ...(opts.turnMs ? { turnMs: opts.turnMs } : {}),
    ...(opts.nopeMs ? { nopeMs: opts.nopeMs } : {}),
    pending: null,
    choice: null,
    future: null,
    out: [],
    status: "playing",
    finished: [],
    log: [],
    logSeq: 0,
  };
}

export const alive = (s: MeoState) => s.players.filter((p) => !s.out.includes(p));

function log(s: MeoState, now: number, text: string, tone: LogEntry["tone"] = "info", play?: number) {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, tone, ...(play ? { play } : {}) }].slice(-LOG_LIMIT);
}

function nextAlive(s: MeoState, from: string): string {
  const n = s.players.length;
  const start = s.players.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(((start + k * (s.dir ?? 1)) % n) + n) % n];
    if (!s.out.includes(p)) return p;
  }
  return from;
}

function takeFromHand(s: MeoState, player: string, ids: number[]): MCard[] | null {
  const hand = s.hands[player] ?? [];
  if (new Set(ids).size !== ids.length) return null;
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) return null;
  s.hands[player] = hand.filter((c) => !ids.includes(c.id));
  return cards as MCard[];
}

/** The current player finished one turn (drew a card or skipped). */
function endTurn(s: MeoState, now: number) {
  s.future = null;
  if (s.turn && s.turnsLeft > 1 && !s.out.includes(s.turn)) {
    s.turnsLeft -= 1;
  } else if (s.turn) {
    leaveTurn(s, s.turn);
    s.turn = nextAlive(s, s.turn);
    s.turnsLeft = 1 + takeExtra(s, s.turn);
  }
  s.turnDeadline = now + turnMs(s);
}

/** Tát: turns someone owes, collected when their turn starts. */
function takeExtra(s: MeoState, player: string): number {
  const n = s.extra?.[player] ?? 0;
  if (n && s.extra) delete s.extra[player];
  return n;
}

/** The turn moves away from `player`: their curse lifts, a future shared with them expires. */
function leaveTurn(s: MeoState, player: string) {
  if (s.cursed?.includes(player)) {
    s.cursed = s.cursed.filter((p) => p !== player);
    if (s.curseOrder) delete s.curseOrder[player];
  }
  if (s.shared?.player === player) s.shared = null;
  if (s.annoyed?.length) s.annoyed = s.annoyed.filter((a) => a.player !== player);
  if (s.noShuffle === player) s.noShuffle = null;
}

/** Hand the turn to `to` with `turns` turns (attacks). */
function passTurnTo(s: MeoState, to: string, turns: number, now: number) {
  s.future = null;
  if (s.turn && s.turn !== to) leaveTurn(s, s.turn);
  s.turn = to;
  s.turnsLeft = turns + takeExtra(s, to);
  s.turnDeadline = now + turnMs(s);
}

function checkEnd(s: MeoState) {
  const left = alive(s);
  if (left.length > 1) return false;
  s.status = "ended";
  s.finished = [...left, ...s.out.slice().reverse()];
  s.turn = null;
  s.turnDeadline = null;
  s.pending = null;
  s.choice = null;
  return true;
}

const choiceOwner = (c: Choice) => (c.kind === "favor" ? c.from : c.player);

const count = (hand: MCard[], type: CardType) => hand.filter((c) => c.type === type).length;
/** Mèo Chạy Rông: each one lets you keep one Mèo Nổ in your hand. */
const canHoldKitten = (hand: MCard[]) => count(hand, "exploding") < count(hand, "streaking");

/**
 * A player holding more Mèo Nổ than Mèo Chạy Rông (their Streaking Kitten was taken, or they
 * received a kitten) must deal with one straight away: Gỡ bom, or explode.
 * Only runs when nothing else is waiting, so choices never overlap.
 */
function settleHeld(s: MeoState, now: number, nameOf: NameOf) {
  if (s.status !== "playing" || s.pending || s.choice) return;
  for (const p of alive(s)) {
    const hand = s.hands[p];
    if (count(hand, "exploding") <= count(hand, "streaking")) continue;
    const kitten = hand.find((c) => c.type === "exploding")!;
    takeFromHand(s, p, [kitten.id]);
    const defuse = usableDefuse(s, p);
    if (defuse) {
      takeFromHand(s, p, [defuse.id]);
      s.discard.push(defuse);
      s.choice = { kind: "defuse", player: p, kitten, deadline: now + CHOICE_MS, endsTurn: false };
      log(s, now, `💣 ${nameOf(p)} không còn Mèo Chạy Rông che chở cho Mèo Nổ… và gỡ bom kịp! 🧯`, "defuse");
      return;
    }
    log(s, now, `💥 ${nameOf(p)} không còn Mèo Chạy Rông che chở — Mèo Nổ phát nổ!`, "boom");
    s.discard.push(kitten);
    eliminate(s, p, now);
    if (s.status !== "playing" || s.choice) return;
  }
}

function eliminate(s: MeoState, player: string, now: number) {
  if (s.out.includes(player)) return;
  s.discard.push(...(s.hands[player] ?? []));
  s.hands[player] = [];
  s.out.push(player);
  if (s.choice && (choiceOwner(s.choice) === player || (s.choice.kind === "favor" && s.choice.to === player))) {
    // A kitten waiting to be hidden goes back on top rather than vanishing.
    if (s.choice.kind === "defuse" || s.choice.kind === "implode") s.deck.unshift(s.choice.kitten);
    if (s.choice.kind === "alter") s.deck.unshift(...s.choice.cards);
    if (s.choice.kind === "bury") s.deck.unshift(s.choice.card);
    if (s.choice.kind === "offer") {
      // Skip them; the rest of the queue still gives a card (and the turn still moves on below).
      const c = s.choice;
      s.choice = null;
      startOffer(s, c.mode, c.queue, now);
    } else s.choice = null;
  }
  if (checkEnd(s)) return;
  if (s.turn === player) {
    s.turn = nextAlive(s, player);
    s.turnsLeft = 1;
    s.pending = null;
    s.future = null;
    s.turnDeadline = now + turnMs(s);
  }
}

const busy = (s: MeoState): string | null =>
  s.status !== "playing" ? "Ván đã kết thúc" : s.pending ? "Đang chờ người khác phản ứng" : s.choice ? "Đang chờ lựa chọn" : null;

/** Pairs / triples: identical cards, or cat cards mixed with Mèo Hoang (wild). */
function isSet(types: CardType[]): boolean {
  if (types.includes("exploding") || types.includes("imploding")) return false;
  if (types.every((t) => t === types[0])) return true;
  return types.every((t) => t === WILD_CAT || CAT_TYPES.includes(t)) && new Set(types.filter((t) => t !== WILD_CAT)).size === 1;
}

export interface PlayOptions {
  target?: unknown;
  named?: unknown;
}

const TARGETED: PendingKind[] = ["favor", "pair", "triple", "targeted", "mark", "curse", "ilt", "zombie", "annoy", "steal"];
/** Targeted cards that work even on a player with an empty hand. */
const TARGET_ANY_HAND: PendingKind[] = ["targeted", "curse", "ilt"];

/** Play card(s) on your turn: a single action card, a pair / triple, or five different cards. */
export function playCards(s: MeoState, player: string, ids: unknown, opts: PlayOptions, now: number, nameOf: NameOf): Result {
  const blocked = busy(s);
  if (blocked) return fail(blocked);
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => Number.isInteger(x))) return fail("Chọn bài để đánh");
  // The same card twice would pass the set checks below but cannot be taken from the hand.
  if (new Set(ids).size !== ids.length) return fail("Mỗi lá chỉ được chọn một lần");
  if (s.out.includes(player) || !s.players.includes(player)) return fail("Bạn đã bị loại");
  const hand = s.hands[player] ?? [];
  const chosen = (ids as number[]).map((id) => hand.find((c) => c.id === id));
  if (chosen.some((c) => !c)) return fail("Bạn không có lá bài này");
  const types = (chosen as MCard[]).map((c) => c.type);
  const nowCard = types.length === 1 && NOW_TYPES.includes(types[0]);
  if (s.turn !== player && !nowCard) return fail("Chưa đến lượt bạn");
  if (types.includes("exploding")) return fail("Mèo Nổ không đánh ra được — nó chỉ nằm yên nhờ Mèo Chạy Rông");
  if ((chosen as MCard[]).some((c) => isAnnoyed(s, c.id))) return fail("Lá này đang bị Nổi cáu vô hiệu hoá tới hết lượt tới của bạn");
  if (types.length === 1 && types[0] === "shuffle" && s.noShuffle) return fail("Xáo bài đang bị khoá");

  let kind: PendingKind;
  if (types.length === 1) {
    if (!ACTION_TYPES.includes(types[0])) {
      return fail(
        types[0] === "nope"
          ? "Chỉ đánh “Không!” để chặn người khác"
          : types[0] === "streaking"
            ? "Mèo Chạy Rông chỉ cần giữ trong tay"
          : types[0] === "defuse"
            ? "Gỡ bom chỉ dùng khi rút phải Mèo Nổ"
            : "Lá mèo phải đánh theo đôi hoặc bộ ba",
      );
    }
    kind = types[0] as PendingKind;
    if (types[0] === "clone") {
      const last = s.discard[s.discard.length - 1]?.type;
      if (!last || !CLONEABLE.includes(last)) return fail("Nhân bản cần một lá hành động (không nhắm ai) vừa được đánh ngay trước");
      kind = last as PendingKind;
    }
  } else if (types.length === 2 && isSet(types)) kind = "pair";
  else if (types.length === 3 && isSet(types)) kind = "triple";
  else if (types.length === 5 && new Set(types).size === 5) kind = "five";
  else return fail("Bộ bài không hợp lệ");

  const needsTarget = TARGETED.includes(kind);
  const target = needsTarget ? (typeof opts.target === "string" ? opts.target : "") : null;
  if (kind === "zombie") {
    if (!target || !s.out.includes(target) || s.noRevive?.includes(target)) return fail("Chọn một người đã bị loại để hồi sinh");
  } else if (needsTarget) {
    if (!target || target === player || !s.players.includes(target) || s.out.includes(target)) return fail("Chọn người chơi để nhắm tới");
    if (!TARGET_ANY_HAND.includes(kind) && (s.hands[target] ?? []).length === 0) return fail("Người đó không còn lá nào");
  }
  let named: CardType | null = null;
  if (kind === "triple" || kind === "five") {
    if (typeof opts.named !== "string" || !ALL_TYPES.includes(opts.named as CardType)) return fail("Chọn loại lá muốn lấy");
    named = opts.named as CardType;
    if (kind === "five" && !s.discard.some((c) => c.type === named)) return fail("Chồng bài đã đánh không có lá đó");
    if (kind === "five" && KITTENS.includes(named)) return fail("Không nhặt Mèo Nổ từ chồng bài đã đánh");
  }

  const cards = takeFromHand(s, player, ids as number[])!;
  s.discard.push(...cards);
  s.pending = { kind, by: player, target, named, cards, nopes: 0, deadline: now + nopeMs(s) };
  const plays = s.plays ?? [];
  s.plays = [
    ...plays,
    { id: (plays.at(-1)?.id ?? 0) + 1, at: now, by: player, kind, cards: cards.map((c) => c.type), target, named, nopes: [], result: "pending" as const },
  ].slice(-PLAY_LIMIT);
  const main = types.find((t) => t !== WILD_CAT) ?? types[0];
  const label =
    kind === "pair"
      ? `đôi ${CARD_NAMES[main]}`
      : kind === "triple"
        ? `bộ ba ${CARD_NAMES[main]} (đòi ${CARD_NAMES[named!]})`
        : kind === "five"
          ? `5 lá khác nhau (lấy ${CARD_NAMES[named!]})`
          : types[0] === "clone"
            ? `Nhân bản (${CARD_NAMES[kind as CardType]})`
            : CARD_NAMES[types[0]];
  log(s, now, `${nameOf(player)} đánh ${label}${target ? ` → ${nameOf(target)}` : ""}`, "info", s.plays.at(-1)?.id);
  return OK;
}

/** Owner of the card a new Không! would answer: the last noper, or the original player. */
export function nopeOwner(p: Pending): string {
  return p.nopes > 0 && p.lastNoper ? p.lastNoper : p.by;
}

/** Answer the pending action with a Nope (anyone still in the game, any number of times). */
export function playNope(s: MeoState, player: string, cardId: unknown, now: number, nameOf: NameOf): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (!s.pending) return fail("Không có gì để chặn");
  if (s.out.includes(player)) return fail("Bạn đã bị loại");
  const card = (s.hands[player] ?? []).find((c) => c.id === cardId && c.type === "nope");
  if (!card) return fail("Bạn không có lá “Không!”");
  if (isAnnoyed(s, card.id)) return fail("Lá “Không!” này đang bị Nổi cáu vô hiệu hoá");
  // You can't answer your own card: the play itself, or your own Không! on top of the chain.
  if (nopeOwner(s.pending) === player) return fail("Không thể tự chặn lá bài của chính mình");
  takeFromHand(s, player, [card.id]);
  s.discard.push(card);
  s.pending.nopes += 1;
  s.pending.lastNoper = player;
  s.pending.deadline = now + nopeMs(s);
  const last = s.plays?.at(-1);
  if (last?.result === "pending") last.nopes.push(player);
  log(s, now, `${nameOf(player)}: KHÔNG! ${s.pending.nopes % 2 ? "(chặn)" : "(chặn lại lần nữa)"}`, "nope");
  return OK;
}

/** Resolve drawing `card` (from the top, or the bottom via Rút từ đáy). Ends the turn unless a kitten needs hiding. */
function receiveDraw(s: MeoState, player: string, card: MCard | undefined, now: number, nameOf: NameOf) {
  s.future = null;
  if (s.shared && s.shared.player !== player) s.shared = null;
  // Để đó cho tui: someone claimed this player's next draw (kittens are still yours to face).
  const claimIdx = card && !KITTENS.includes(card.type) ? (s.claims ?? []).findIndex((c) => c.victim === player && !s.out.includes(c.by)) : -1;
  if (card && claimIdx >= 0) {
    const [claim] = s.claims!.splice(claimIdx, 1);
    s.hands[claim.by].push(card);
    log(s, now, `🫳 ${nameOf(player)} rút 1 lá… nhưng ${nameOf(claim.by)} đã “để đó cho tui” và lấy mất!`, "steal");
    endTurn(s, now);
    return;
  }
  if (!card) {
    // Cannot happen with kittens left in the deck, but never deadlock.
    endTurn(s, now);
    return;
  }
  if (card.type === "imploding") {
    if (card.faceUp) {
      log(s, now, `🌀 ${nameOf(player)} rút phải MÈO TỰ HUỶ đang ngửa — bị loại ngay!`, "boom");
      s.discard.push(card);
      eliminate(s, player, now);
      return;
    }
    card.faceUp = true;
    s.choice = { kind: "implode", player, kitten: card, deadline: now + CHOICE_MS };
    log(s, now, `🌀 ${nameOf(player)} rút phải MÈO TỰ HUỶ! Nó được lật ngửa và nhét lại vào chồng bài…`, "defuse");
    return;
  }
  if (card.type !== "exploding") {
    s.hands[player].push(card);
    log(s, now, `${nameOf(player)} rút 1 lá`);
    endTurn(s, now);
    return;
  }
  if (canHoldKitten(s.hands[player])) {
    // Mèo Chạy Rông: keep it secretly in hand.
    s.hands[player].push(card);
    log(s, now, `${nameOf(player)} rút 1 lá`);
    endTurn(s, now);
    return;
  }
  const defuse = usableDefuse(s, player);
  if (defuse) {
    takeFromHand(s, player, [defuse.id]);
    s.discard.push(defuse);
    s.choice = { kind: "defuse", player, kitten: card, deadline: now + CHOICE_MS };
    log(s, now, `💣 ${nameOf(player)} rút phải MÈO NỔ… và gỡ bom thành công! 🧯`, "defuse");
    return;
  }
  log(s, now, `💥 ${nameOf(player)} rút phải MÈO NỔ và bị nổ tung!`, "boom");
  s.discard.push(card);
  eliminate(s, player, now);
}

/** Draw the top card, ending one turn — or meet a kitten. */
export function drawCard(s: MeoState, player: string, now: number, nameOf: NameOf): Result {
  const blocked = busy(s);
  if (blocked) return fail(blocked);
  if (s.turn !== player) return fail("Chưa đến lượt bạn");
  receiveDraw(s, player, s.deck.shift(), now, nameOf);
  return OK;
}

/** Hide the pending kitten back in the deck (0 = top). */
/**
 * Where a kitten may go back (0 = top, deckLength = bottom): not in the top or bottom 10% of the
 * deck. When the deck is too small for 10% to be a whole card, anywhere is allowed.
 */
export function insertRange(deckLength: number): [number, number] {
  const margin = Math.floor(deckLength * 0.1);
  return margin < 1 ? [0, deckLength] : [margin, deckLength - margin];
}

export function insertKitten(s: MeoState, player: string, position: unknown, now: number, nameOf: NameOf): Result {
  const c = s.choice;
  if (c?.kind === "bury" && c.player === player) {
    // Chôn bài: anywhere at all, and nobody (not even you) learns what it was.
    const pos = Math.max(0, Math.min(s.deck.length, Math.floor(Number(position)) || 0));
    s.deck.splice(pos, 0, c.card);
    s.choice = null;
    log(s, now, `⚰️ ${nameOf(player)} chôn lá trên cùng vào lại chồng bài`, "info");
    endTurn(s, now);
    return OK;
  }
  if (!c || (c.kind !== "defuse" && c.kind !== "implode") || c.player !== player) return fail("Không có Mèo Nổ để nhét lại");
  const [min, max] = insertRange(s.deck.length);
  const wanted = Math.floor(Number(position));
  if (Number.isFinite(wanted) && (wanted < min || wanted > max)) {
    return fail(`Chỉ được nhét từ lá thứ ${min + 1} đến lá thứ ${max + 1} (không nằm trong 10% trên cùng / dưới cùng)`);
  }
  const pos = Math.max(min, Math.min(max, Number.isFinite(wanted) ? wanted : min));
  s.deck.splice(pos, 0, c.kitten);
  s.choice = null;
  for (const seer of s.seers ?? []) {
    s.visions = { ...s.visions, [seer]: { text: `👁️ ${nameOf(player)} vừa nhét Mèo Nổ ở lá thứ ${pos + 1} từ trên xuống`, at: now } };
  }
  s.seers = [];
  log(
    s,
    now,
    c.kind === "implode"
      ? `${nameOf(player)} đặt Mèo Tự Huỷ (ngửa) ở vị trí thứ ${pos + 1} từ trên xuống 👀`
      : `${nameOf(player)} đã nhét Mèo Nổ vào lại chồng bài 🤫`,
    "defuse",
  );
  if (c.endsTurn === false) s.turnDeadline = now + turnMs(s);
  else endTurn(s, now);
  settleHeld(s, now, nameOf);
  return OK;
}

/** Xin xỏ: the target hands over a card of their choice. */
export function giveCard(s: MeoState, player: string, cardId: unknown, now: number, nameOf: NameOf, random: () => number = Math.random): Result {
  const oc = s.choice;
  if (oc?.kind === "offer" && oc.player === player) {
    const card = (s.hands[player] ?? []).find((c) => c.id === cardId);
    if (!card) return fail("Bạn không có lá bài này");
    takeFromHand(s, player, [card.id]);
    delete card.marked;
    if (oc.mode === "potluck") s.deck.unshift(card);
    else if (oc.mode === "feed") s.discard.push(card);
    else s.deck.push(card);
    log(
      s,
      now,
      `${nameOf(player)} ${oc.mode === "potluck" ? "góp 1 lá lên đầu chồng bài" : oc.mode === "feed" ? `bỏ ${CARD_NAMES[card.type]} cho xác sống ăn 🧟` : "bỏ 1 lá vào chồng bài"}`,
    );
    s.choice = null;
    startOffer(s, oc.mode, oc.queue, now);
    if (!s.choice && oc.mode === "garbage") {
      s.deck = shuffle(s.deck, random);
      log(s, now, `🗑️ Dọn rác xong — chồng bài đã được xáo`);
    }
    if (!s.choice) s.turnDeadline = now + turnMs(s);
    settleHeld(s, now, nameOf);
    return OK;
  }
  if (s.choice?.kind !== "favor" || s.choice.from !== player) return fail("Không ai xin bài của bạn");
  const card = (s.hands[player] ?? []).find((c) => c.id === cardId);
  if (!card) return fail("Bạn không có lá bài này");
  takeFromHand(s, player, [card.id]);
  s.hands[s.choice.to].push(card);
  log(s, now, `${nameOf(player)} đưa 1 lá cho ${nameOf(s.choice.to)}`, "steal");
  s.choice = null;
  s.turnDeadline = now + turnMs(s);
  settleHeld(s, now, nameOf);
  return OK;
}

/** Next player in `queue` with a card gives one (Dọn rác / Góp nồi). */
function startOffer(s: MeoState, mode: OfferMode, queue: string[], now: number) {
  const rest = queue.filter((p) => !s.out.includes(p));
  while (rest.length && !(s.hands[rest[0]] ?? []).length) rest.shift();
  if (!rest.length) return;
  const [player, ...more] = rest;
  s.choice = { kind: "offer", mode, player, queue: more, deadline: now + CHOICE_MS };
}

/** Everyone still in, in turn order starting with `from`. */
function roundFrom(s: MeoState, from: string): string[] {
  const order = [from];
  for (let p = nextAlive(s, from); p !== from && !order.includes(p); p = nextAlive(s, p)) order.push(p);
  return order;
}

/** Sửa tương lai: put the top cards back in the given order (ids, first = top). */
export function alterFuture(s: MeoState, player: string, order: unknown, now: number, nameOf: NameOf): Result {
  const c = s.choice;
  if (c?.kind !== "alter" || c.player !== player) return fail("Bạn không sửa tương lai lúc này");
  const ids = Array.isArray(order) ? order : [];
  const sorted = ids.map((id) => c.cards.find((x) => x.id === id)).filter((x): x is MCard => !!x);
  if (sorted.length !== c.cards.length || new Set(sorted).size !== c.cards.length) return fail("Thứ tự không hợp lệ");
  s.deck.unshift(...sorted);
  s.choice = null;
  s.future = { player, cards: sorted };
  s.turnDeadline = now + turnMs(s);
  if (c.share) {
    const next = nextAlive(s, player);
    s.shared = { player: next, cards: sorted };
    log(s, now, `${nameOf(player)} sắp xếp lại tương lai và chia sẻ cho ${nameOf(next)} 🔮`);
  } else log(s, now, `${nameOf(player)} đã sắp xếp lại tương lai 🔮`);
  return OK;
}

function stealRandom(s: MeoState, from: string, to: string, random: () => number): MCard | null {
  const hand = s.hands[from] ?? [];
  if (!hand.length) return null;
  const card = hand[Math.floor(random() * hand.length)];
  takeFromHand(s, from, [card.id]);
  s.hands[to].push(card);
  return card;
}

const attackTurns = (s: MeoState) => (s.turnsLeft > 1 ? s.turnsLeft + 2 : 2);

function resolvePending(s: MeoState, now: number, nameOf: NameOf, random: () => number) {
  const p = s.pending!;
  s.pending = null;
  s.turnDeadline = now + turnMs(s);
  const record = s.plays?.at(-1);
  if (record?.result === "pending") record.result = p.nopes % 2 === 1 ? "blocked" : "done";
  if (p.nopes % 2 === 1) {
    log(s, now, `${CARD_NAMES[p.cards[0].type]} của ${nameOf(p.by)} đã bị chặn 🚫`, "nope");
    return;
  }
  // The actor may have been eliminated meanwhile (kicked); nothing to apply then.
  if (s.out.includes(p.by)) return;
  switch (p.kind) {
    case "attack":
    case "targeted": {
      const victim = p.kind === "targeted" && p.target && !s.out.includes(p.target) ? p.target : nextAlive(s, p.by);
      const turns = attackTurns(s);
      passTurnTo(s, victim, turns, now);
      log(s, now, `⚔️ ${nameOf(victim)} bị tấn công: phải chơi ${turns} lượt!`);
      break;
    }
    case "skip":
      log(s, now, `${nameOf(p.by)} bỏ lượt`);
      endTurn(s, now);
      break;
    case "superskip":
      log(s, now, `${nameOf(p.by)} siêu bỏ lượt — kết thúc mọi lượt còn lại`);
      passTurnTo(s, nextAlive(s, p.by), 1, now);
      break;
    case "reverse":
      s.dir = s.dir === 1 ? -1 : 1;
      log(s, now, `🔁 Đảo chiều vòng chơi`);
      endTurn(s, now);
      break;
    case "bottom":
      receiveDraw(s, p.by, s.deck.pop(), now, nameOf);
      break;
    case "favor":
      if (p.target && !s.out.includes(p.target) && s.hands[p.target].length) {
        s.choice = { kind: "favor", from: p.target, to: p.by, deadline: now + CHOICE_MS };
      }
      break;
    case "shuffle":
      s.deck = shuffle(s.deck, random);
      s.future = null;
      log(s, now, `🔀 Chồng bài đã được xáo`);
      break;
    case "future":
      s.future = { player: p.by, cards: s.deck.slice(0, 3) };
      break;
    case "alter": {
      const top = s.deck.splice(0, 3);
      if (top.length) s.choice = { kind: "alter", player: p.by, cards: top, deadline: now + CHOICE_MS };
      break;
    }
    case "swap":
      if (s.deck.length > 1) [s.deck[0], s.deck[s.deck.length - 1]] = [s.deck[s.deck.length - 1], s.deck[0]];
      s.future = null;
      log(s, now, `🔃 Đổi lá trên cùng với lá dưới cùng`);
      break;
    case "catomic": {
      const kittens = s.deck.filter((c) => KITTENS.includes(c.type));
      const rest = shuffle(
        s.deck.filter((c) => !KITTENS.includes(c.type)),
        random,
      );
      s.deck = [...kittens, ...rest];
      log(s, now, `☢️ BOM MÈO NGUYÊN TỬ! ${kittens.length} quả Mèo Nổ đã nằm trên đầu chồng bài`, "boom");
      endTurn(s, now);
      break;
    }
    case "future5":
      s.future = { player: p.by, cards: s.deck.slice(0, 5) };
      break;
    case "garbage":
    case "potluck":
      startOffer(s, p.kind, roundFrom(s, p.by), now);
      log(s, now, p.kind === "garbage" ? `🗑️ Dọn rác: mỗi người bỏ 1 lá vào chồng bài` : `🍲 Góp nồi: mỗi người đặt 1 lá lên đầu chồng bài`);
      break;
    case "mark": {
      const hand = p.target ? s.hands[p.target].filter((c) => !c.marked) : [];
      const card = hand[Math.floor(random() * hand.length)];
      if (card && p.target) {
        card.marked = true;
        log(s, now, `🔖 ${nameOf(p.by)} đánh dấu 1 lá của ${nameOf(p.target)}: ${CARD_NAMES[card.type]} — ai cũng thấy lá này`, "steal");
      }
      break;
    }
    case "curse":
      if (p.target && !s.out.includes(p.target)) {
        s.cursed = [...new Set([...(s.cursed ?? []), p.target])];
        log(s, now, `🍑 ${nameOf(p.target)} dính Lời nguyền mông mèo: phải chơi bài úp đến hết lượt tới`, "nope");
      }
      break;
    case "barking": {
      const holder = alive(s).find((q) => q !== p.by && s.hands[q].some((c) => c.type === "barking"));
      if (!holder) {
        log(s, now, `🐶 Gâu gâu… không ai khác giữ Mèo Sủa còn lại`);
        break;
      }
      const theirs = s.hands[holder].find((c) => c.type === "barking")!;
      takeFromHand(s, holder, [theirs.id]);
      s.discard.push(theirs);
      const defuse = usableDefuse(s, holder);
      if (defuse) {
        takeFromHand(s, holder, [defuse.id]);
        s.discard.push(defuse);
        log(s, now, `🐶 GÂU! ${nameOf(holder)} đang giữ Mèo Sủa còn lại — mất 1 Gỡ bom 🧯`, "defuse");
      } else {
        log(s, now, `🐶 GÂU! ${nameOf(holder)} giữ Mèo Sủa còn lại mà không có Gỡ bom — nổ tung!`, "boom");
        eliminate(s, holder, now);
      }
      break;
    }
    case "ilt":
      if (p.target && !s.out.includes(p.target)) {
        s.claims = [...(s.claims ?? []), { victim: p.target, by: p.by }];
        log(s, now, `🫳 ${nameOf(p.by)}: “Để đó cho tui” — lá tiếp theo ${nameOf(p.target)} rút sẽ về tay ${nameOf(p.by)}`);
      }
      break;
    case "alternow":
    case "share": {
      const top = s.deck.splice(0, 3);
      if (top.length) s.choice = { kind: "alter", player: p.by, cards: top, deadline: now + CHOICE_MS, ...(p.kind === "share" ? { share: true } : {}) };
      break;
    }
    case "bury": {
      const top = s.deck.shift();
      if (top) s.choice = { kind: "bury", player: p.by, card: top, deadline: now + CHOICE_MS };
      break;
    }
    case "zombie": {
      const t = p.target;
      if (!t || !s.out.includes(t) || s.noRevive?.includes(t)) break;
      s.out = s.out.filter((x) => x !== t);
      const pool = s.discard.filter((c) => !KITTENS.includes(c.type));
      const back: MCard[] = [];
      for (let i = 0; i < 2 && pool.length; i++) {
        const c = pool.splice(Math.floor(random() * pool.length), 1)[0];
        s.discard.splice(s.discard.indexOf(c), 1);
        back.push(c);
      }
      s.hands[t] = back;
      log(s, now, `🧟 ${nameOf(p.by)} hồi sinh ${nameOf(t)}! Họ quay lại bàn với ${back.length} lá`, "defuse");
      break;
    }
    case "feed":
      startOffer(s, "feed", roundFrom(s, p.by), now);
      log(s, now, `🧟 Nuôi xác sống: mỗi người bỏ 1 lá vào chồng bài đã đánh`);
      break;
    case "dig":
      if (s.deck.length) s.choice = { kind: "dig", player: p.by, deadline: now + CHOICE_MS };
      break;
    case "grave":
      for (const q of roundFrom(s, p.by)) {
        const pool = s.discard.filter((c) => !KITTENS.includes(c.type));
        if (!pool.length) break;
        const c = pool[Math.floor(random() * pool.length)];
        s.discard.splice(s.discard.indexOf(c), 1);
        s.hands[q].push(c);
      }
      log(s, now, `⚰️ Đào mộ: mỗi người nhặt ngẫu nhiên 1 lá từ chồng bài đã đánh`, "steal");
      break;
    case "deadattack": {
      const victim = nextAlive(s, p.by);
      const turns = attackTurns(s) + s.out.length;
      passTurnTo(s, victim, turns, now);
      log(s, now, `🧟⚔️ Xác sống tấn công! ${nameOf(victim)} phải chơi ${turns} lượt`);
      break;
    }
    case "slap": {
      // End one of your turns without drawing; the next player draws it for you.
      const next = nextAlive(s, p.by);
      if (s.turnsLeft > 1) {
        s.turnsLeft -= 1;
        s.extra = { ...s.extra, [next]: (s.extra?.[next] ?? 0) + 1 };
        log(s, now, `👋 ${nameOf(p.by)} tát! ${nameOf(next)} sẽ phải rút hộ 1 lượt`);
      } else {
        passTurnTo(s, next, 2, now);
        log(s, now, `👋 ${nameOf(p.by)} tát! ${nameOf(next)} phải rút hộ rồi chơi lượt của mình (${s.turnsLeft} lượt)`);
      }
      break;
    }
    case "annoy": {
      const hand = p.target ? s.hands[p.target].filter((c) => !isAnnoyed(s, c.id)) : [];
      const card = hand[Math.floor(random() * hand.length)];
      if (card && p.target) {
        s.annoyed = [...(s.annoyed ?? []), { player: p.target, card: card.id }];
        log(s, now, `😾 ${nameOf(p.by)} làm ${nameOf(p.target)} nổi cáu — 1 lá của họ bị vô hiệu tới hết lượt tới`, "nope");
      }
      break;
    }
    case "steal":
      if (p.target && stealRandom(s, p.target, p.by, random)) log(s, now, `🦝 ${nameOf(p.by)} cướp 1 lá của ${nameOf(p.target)}`, "steal");
      break;
    case "rollcall": {
      const kittens = s.deck.filter((c) => KITTENS.includes(c.type));
      s.deck = [...kittens, ...s.deck.filter((c) => !KITTENS.includes(c.type))];
      const next = nextAlive(s, p.by);
      s.noShuffle = next;
      log(s, now, `📋 Điểm danh mèo! ${kittens.length} quả Mèo Nổ lên đầu chồng bài — ${nameOf(next)} không được Xáo bài`, "boom");
      endTurn(s, now);
      break;
    }
    case "corn": {
      const next = nextAlive(s, p.by);
      s.noShuffle = next;
      log(s, now, `🌽 Lời nguyền ngô pha lê: không ai được Xáo bài cho tới hết lượt của ${nameOf(next)}`, "nope");
      break;
    }
    case "personal":
      s.turnsLeft += 2;
      log(s, now, `🥊 ${nameOf(p.by)} tự tấn công: phải chơi thêm 2 lượt (còn ${s.turnsLeft} lượt)`);
      break;
    case "pair":
      if (p.target && stealRandom(s, p.target, p.by, random)) log(s, now, `${nameOf(p.by)} rút trộm 1 lá của ${nameOf(p.target)}`, "steal");
      break;
    case "triple": {
      const card = p.target ? s.hands[p.target].find((c) => c.type === p.named) : undefined;
      if (card && p.target) {
        takeFromHand(s, p.target, [card.id]);
        s.hands[p.by].push(card);
        log(s, now, `${nameOf(p.by)} lấy được ${CARD_NAMES[card.type]} của ${nameOf(p.target)}!`, "steal");
      } else if (p.target) {
        log(s, now, `${nameOf(p.target)} không có ${CARD_NAMES[p.named!]} 😏`);
      }
      break;
    }
    case "five": {
      const idx = s.discard.map((c) => c.type).lastIndexOf(p.named!);
      if (idx >= 0) {
        const [card] = s.discard.splice(idx, 1);
        s.hands[p.by].push(card);
        log(s, now, `${nameOf(p.by)} nhặt ${CARD_NAMES[card.type]} từ chồng bài đã đánh`, "steal");
      }
      break;
    }
  }
  settleHeld(s, now, nameOf);
}

/**
 * Resolve everything due at `now`. `absent(id)` marks players who are offline:
 * their turns and choices are played for them straight away.
 */
export function tickGame(s: MeoState, now: number, nameOf: NameOf, absent: (id: string) => boolean, random: () => number = Math.random): boolean {
  let changed = false;
  const before = s.logSeq;
  settleHeld(s, now, nameOf);
  if (s.logSeq !== before) changed = true;
  for (let guard = 0; guard < 20 && s.status === "playing"; guard++) {
    if (s.pending) {
      if (now < s.pending.deadline) break;
      resolvePending(s, now, nameOf, random);
      changed = true;
      continue;
    }
    if (s.choice) {
      const c = s.choice;
      const owner = choiceOwner(c);
      if (now < c.deadline && !absent(owner)) break;
      if (c.kind === "defuse" || c.kind === "implode") {
        const [min, max] = insertRange(s.deck.length);
        insertKitten(s, owner, min + Math.floor(random() * (max - min + 1)), now, nameOf);
      }
      else if (c.kind === "alter") alterFuture(s, owner, c.cards.map((x) => x.id), now, nameOf);
      else if (c.kind === "bury") insertKitten(s, owner, Math.floor(random() * (s.deck.length + 1)), now, nameOf);
      else if (c.kind === "dig") digDeeper(s, owner, true, now, nameOf);
      else {
        const hand = s.hands[owner];
        giveCard(s, owner, hand[Math.floor(random() * hand.length)]?.id, now, nameOf, random);
      }
      changed = true;
      continue;
    }
    if (!s.turn) break;
    const timedOut = s.turnDeadline !== null && now >= s.turnDeadline;
    if (!timedOut && !absent(s.turn)) break;
    // Out of time (or away): draw for them.
    drawCard(s, s.turn, now, nameOf);
    changed = true;
  }
  return changed;
}

/** When `tickGame` next has something to do. */
export function nextGameTickAt(s: MeoState): number | null {
  if (s.status !== "playing") return null;
  if (s.pending) return s.pending.deadline;
  if (s.choice) return s.choice.deadline;
  return s.turnDeadline;
}

/** A player left for good (kicked while disconnected): they are out, as if they exploded. */
export function forfeitPlayer(s: MeoState, player: string, now: number, nameOf: NameOf): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (!s.players.includes(player) || s.out.includes(player)) return fail("Người chơi không còn trong ván");
  log(s, now, `${nameOf(player)} đã bị mời ra khỏi ván`, "boom");
  s.noRevive = [...(s.noRevive ?? []), player];
  eliminate(s, player, now);
  return OK;
}

/** Face-up Imploding Kitten position (0 = top), visible to everyone. */
export const implodingAt = (s: MeoState) => {
  const i = s.deck.findIndex((c) => c.type === "imploding" && c.faceUp);
  return i >= 0 ? i : null;
};


// ─── Lời nguyền mông mèo: blind hands ──────────────────────────────

/** Keep each cursed player's blind order in step with their hand (new cards slot in at random). */
export function syncCurse(s: MeoState, random: () => number = Math.random) {
  const cursed = (s.cursed ?? []).filter((p) => !s.out.includes(p));
  const next: Record<string, number[]> = {};
  for (const p of cursed) {
    const ids = (s.hands[p] ?? []).map((c) => c.id);
    const order = (s.curseOrder?.[p] ?? []).filter((id) => ids.includes(id));
    for (const id of ids) if (!order.includes(id)) order.splice(Math.floor(random() * (order.length + 1)), 0, id);
    next[p] = order;
  }
  s.cursed = cursed;
  s.curseOrder = next;
}

/** A cursed player picks by blind position: -1 = first face-down card, -2 = second… */
export function unblind(s: MeoState, player: string, id: unknown): unknown {
  if (typeof id !== "number" || id >= 0 || !s.cursed?.includes(player)) return id;
  return s.curseOrder?.[player]?.[-id - 1] ?? id;
}


// ─── Mèo Xác Sống pack ─────────────────────────────────────────────

/** Đào sâu: keep the top card (as a normal draw), or leave it and draw the one under it. */
export function digDeeper(s: MeoState, player: string, keep: boolean, now: number, nameOf: NameOf): Result {
  if (s.choice?.kind !== "dig" || s.choice.player !== player) return fail("Bạn không đào bài lúc này");
  s.choice = null;
  if (keep || s.deck.length < 2) {
    log(s, now, `⛏️ ${nameOf(player)} giữ lá vừa đào`);
    receiveDraw(s, player, s.deck.shift(), now, nameOf);
  } else {
    log(s, now, `⛏️ ${nameOf(player)} bỏ qua lá trên cùng, đào sâu thêm 1 lá`);
    receiveDraw(s, player, s.deck.splice(1, 1)[0], now, nameOf);
  }
  settleHeld(s, now, nameOf);
  return OK;
}

/** The card Đào sâu shows its player. */
export const digCard = (s: MeoState, player: string): CardType | null =>
  s.choice?.kind === "dig" && s.choice.player === player ? (s.deck[0]?.type ?? null) : null;

/** Thấu thị: while someone else is hiding a Mèo Nổ, secretly watch where it goes. */
export function playClairvoyance(s: MeoState, player: string, cardId: unknown, now: number, nameOf: NameOf): Result {
  const c = s.choice;
  if (s.status !== "playing" || !c || c.kind !== "defuse" || c.player === player) return fail("Chỉ dùng khi người khác đang nhét Mèo Nổ");
  if (s.out.includes(player)) return fail("Bạn đã bị loại");
  const card = (s.hands[player] ?? []).find((x) => x.id === cardId && x.type === CLAIRVOYANCE);
  if (!card) return fail("Bạn không có lá Thấu thị");
  takeFromHand(s, player, [card.id]);
  s.discard.push(card);
  s.seers = [...new Set([...(s.seers ?? []), player])];
  log(s, now, `🔮 ${nameOf(player)} dùng Thấu thị — sẽ biết Mèo Nổ được nhét ở đâu`, "steal");
  return OK;
}
