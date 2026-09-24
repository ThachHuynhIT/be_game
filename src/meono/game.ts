import {
  ACTION_TYPES,
  ALL_TYPES,
  CAT_TYPES,
  type CardType,
  type Expansion,
  KITTENS,
  type MCard,
  MIN_PLAYERS,
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
export const NOPE_WINDOW_MS = 3_500;
export const TURN_MS = 30_000;
/** Time to answer a choice (hide a kitten, give a card for Xin xỏ, reorder the future). */
export const CHOICE_MS = 15_000;
export const LOG_LIMIT = 14;

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
  deadline: number;
}

export type Choice =
  /** Hide a kitten back in the deck — after a Defuse, or the first draw of the Imploding Kitten (face up). */
  | { kind: "defuse" | "implode"; player: string; kitten: MCard; deadline: number }
  | { kind: "favor"; from: string; to: string; deadline: number }
  /** Sửa tương lai: put the top cards back in a new order. */
  | { kind: "alter"; player: string; cards: MCard[]; deadline: number };

export interface LogEntry {
  id: number;
  at: number;
  text: string;
  /** For UI emphasis. */
  tone?: "boom" | "defuse" | "nope" | "steal" | "info";
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
}

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
};

export function newMeoGame(players: string[], now: number, expansions: Expansion[] = [], random: () => number = Math.random): MeoState {
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
    turnDeadline: now + TURN_MS,
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

function log(s: MeoState, now: number, text: string, tone: LogEntry["tone"] = "info") {
  s.logSeq += 1;
  s.log = [...s.log, { id: s.logSeq, at: now, text, tone }].slice(-LOG_LIMIT);
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
    s.turn = nextAlive(s, s.turn);
    s.turnsLeft = 1;
  }
  s.turnDeadline = now + TURN_MS;
}

/** Hand the turn to `to` with `turns` turns (attacks). */
function passTurnTo(s: MeoState, to: string, turns: number, now: number) {
  s.future = null;
  s.turn = to;
  s.turnsLeft = turns;
  s.turnDeadline = now + TURN_MS;
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

function eliminate(s: MeoState, player: string, now: number) {
  if (s.out.includes(player)) return;
  s.discard.push(...(s.hands[player] ?? []));
  s.hands[player] = [];
  s.out.push(player);
  if (s.choice && (choiceOwner(s.choice) === player || (s.choice.kind === "favor" && s.choice.to === player))) {
    // A kitten waiting to be hidden goes back on top rather than vanishing.
    if (s.choice.kind === "defuse" || s.choice.kind === "implode") s.deck.unshift(s.choice.kitten);
    if (s.choice.kind === "alter") s.deck.unshift(...s.choice.cards);
    s.choice = null;
  }
  if (checkEnd(s)) return;
  if (s.turn === player) {
    s.turn = nextAlive(s, player);
    s.turnsLeft = 1;
    s.pending = null;
    s.future = null;
    s.turnDeadline = now + TURN_MS;
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

const TARGETED: PendingKind[] = ["favor", "pair", "triple", "targeted"];

/** Play card(s) on your turn: a single action card, a pair / triple, or five different cards. */
export function playCards(s: MeoState, player: string, ids: unknown, opts: PlayOptions, now: number, nameOf: NameOf): Result {
  const blocked = busy(s);
  if (blocked) return fail(blocked);
  if (s.turn !== player) return fail("Chưa đến lượt bạn");
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => Number.isInteger(x))) return fail("Chọn bài để đánh");
  const hand = s.hands[player] ?? [];
  const chosen = (ids as number[]).map((id) => hand.find((c) => c.id === id));
  if (chosen.some((c) => !c)) return fail("Bạn không có lá bài này");
  const types = (chosen as MCard[]).map((c) => c.type);

  let kind: PendingKind;
  if (types.length === 1) {
    if (!ACTION_TYPES.includes(types[0])) {
      return fail(
        types[0] === "nope"
          ? "Chỉ đánh “Không!” để chặn người khác"
          : types[0] === "defuse"
            ? "Gỡ bom chỉ dùng khi rút phải Mèo Nổ"
            : "Lá mèo phải đánh theo đôi hoặc bộ ba",
      );
    }
    kind = types[0] as PendingKind;
  } else if (types.length === 2 && isSet(types)) kind = "pair";
  else if (types.length === 3 && isSet(types)) kind = "triple";
  else if (types.length === 5 && new Set(types).size === 5) kind = "five";
  else return fail("Bộ bài không hợp lệ");

  const needsTarget = TARGETED.includes(kind);
  const target = needsTarget ? (typeof opts.target === "string" ? opts.target : "") : null;
  if (needsTarget) {
    if (!target || target === player || !s.players.includes(target) || s.out.includes(target)) return fail("Chọn người chơi để nhắm tới");
    if (kind !== "targeted" && (s.hands[target] ?? []).length === 0) return fail("Người đó không còn lá nào");
  }
  let named: CardType | null = null;
  if (kind === "triple" || kind === "five") {
    if (typeof opts.named !== "string" || !ALL_TYPES.includes(opts.named as CardType)) return fail("Chọn loại lá muốn lấy");
    named = opts.named as CardType;
    if (kind === "five" && !s.discard.some((c) => c.type === named)) return fail("Chồng bài đã đánh không có lá đó");
  }

  const cards = takeFromHand(s, player, ids as number[])!;
  s.discard.push(...cards);
  s.pending = { kind, by: player, target, named, cards, nopes: 0, deadline: now + NOPE_WINDOW_MS };
  const main = types.find((t) => t !== WILD_CAT) ?? types[0];
  const label =
    kind === "pair"
      ? `đôi ${CARD_NAMES[main]}`
      : kind === "triple"
        ? `bộ ba ${CARD_NAMES[main]} (đòi ${CARD_NAMES[named!]})`
        : kind === "five"
          ? `5 lá khác nhau (lấy ${CARD_NAMES[named!]})`
          : CARD_NAMES[types[0]];
  log(s, now, `${nameOf(player)} đánh ${label}${target ? ` → ${nameOf(target)}` : ""}`);
  return OK;
}

/** Answer the pending action with a Nope (anyone still in the game, any number of times). */
export function playNope(s: MeoState, player: string, cardId: unknown, now: number, nameOf: NameOf): Result {
  if (s.status !== "playing") return fail("Ván đã kết thúc");
  if (!s.pending) return fail("Không có gì để chặn");
  if (s.out.includes(player)) return fail("Bạn đã bị loại");
  const card = (s.hands[player] ?? []).find((c) => c.id === cardId && c.type === "nope");
  if (!card) return fail("Bạn không có lá “Không!”");
  takeFromHand(s, player, [card.id]);
  s.discard.push(card);
  s.pending.nopes += 1;
  s.pending.deadline = now + NOPE_WINDOW_MS;
  log(s, now, `${nameOf(player)}: KHÔNG! ${s.pending.nopes % 2 ? "(chặn)" : "(chặn lại lần nữa)"}`, "nope");
  return OK;
}

/** Resolve drawing `card` (from the top, or the bottom via Rút từ đáy). Ends the turn unless a kitten needs hiding. */
function receiveDraw(s: MeoState, player: string, card: MCard | undefined, now: number, nameOf: NameOf) {
  s.future = null;
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
  const defuse = s.hands[player].find((c) => c.type === "defuse");
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
export function insertKitten(s: MeoState, player: string, position: unknown, now: number, nameOf: NameOf): Result {
  const c = s.choice;
  if (!c || (c.kind !== "defuse" && c.kind !== "implode") || c.player !== player) return fail("Không có Mèo Nổ để nhét lại");
  const pos = Math.max(0, Math.min(s.deck.length, Math.floor(Number(position)) || 0));
  s.deck.splice(pos, 0, c.kitten);
  s.choice = null;
  log(
    s,
    now,
    c.kind === "implode"
      ? `${nameOf(player)} đặt Mèo Tự Huỷ (ngửa) ở vị trí thứ ${pos + 1} từ trên xuống 👀`
      : `${nameOf(player)} đã nhét Mèo Nổ vào lại chồng bài 🤫`,
    "defuse",
  );
  endTurn(s, now);
  return OK;
}

/** Xin xỏ: the target hands over a card of their choice. */
export function giveCard(s: MeoState, player: string, cardId: unknown, now: number, nameOf: NameOf): Result {
  if (s.choice?.kind !== "favor" || s.choice.from !== player) return fail("Không ai xin bài của bạn");
  const card = (s.hands[player] ?? []).find((c) => c.id === cardId);
  if (!card) return fail("Bạn không có lá bài này");
  takeFromHand(s, player, [card.id]);
  s.hands[s.choice.to].push(card);
  log(s, now, `${nameOf(player)} đưa 1 lá cho ${nameOf(s.choice.to)}`, "steal");
  s.choice = null;
  s.turnDeadline = now + TURN_MS;
  return OK;
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
  s.turnDeadline = now + TURN_MS;
  log(s, now, `${nameOf(player)} đã sắp xếp lại tương lai 🔮`);
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
  s.turnDeadline = now + TURN_MS;
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
}

/**
 * Resolve everything due at `now`. `absent(id)` marks players who are offline:
 * their turns and choices are played for them straight away.
 */
export function tickGame(s: MeoState, now: number, nameOf: NameOf, absent: (id: string) => boolean, random: () => number = Math.random): boolean {
  let changed = false;
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
      if (c.kind === "defuse" || c.kind === "implode") insertKitten(s, owner, Math.floor(random() * (s.deck.length + 1)), now, nameOf);
      else if (c.kind === "alter") alterFuture(s, owner, c.cards.map((x) => x.id), now, nameOf);
      else {
        const hand = s.hands[owner];
        giveCard(s, owner, hand[Math.floor(random() * hand.length)]?.id, now, nameOf);
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
  eliminate(s, player, now);
  return OK;
}

/** Face-up Imploding Kitten position (0 = top), visible to everyone. */
export const implodingAt = (s: MeoState) => {
  const i = s.deck.findIndex((c) => c.type === "imploding" && c.faceUp);
  return i >= 0 ? i : null;
};
