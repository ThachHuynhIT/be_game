import type { ChatMessage, GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";
import type { MapSize } from "./board";
import type { Deed, Loan, LoanOffer, LogEntry, Phase, TradeSide } from "./game";

export type { MapSize };
export type { ChatMessage, Deed, GameRecord, Loan, LoanOffer, LeaderboardEntry, LogEntry, Phase, Reaction, TradeSide };
export { CHAT_MAX_LENGTH, EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Cờ Tỷ Phú. */
export const TYPHU_WS_PATH = "/api/typhu/ws";

export interface TPSettings {
  startCash: number;
  /** Minutes, 0 = no limit. */
  timeLimit: number;
  /** Seconds per step of a turn (roll, buy, end). */
  stepSeconds: number;
  /** Landing exactly on Khởi hành pays double. */
  doubleGo: boolean;
  /** Taxes and fines pile up on Nghỉ chân for whoever lands there. */
  parkingPot: boolean;
  /** Map size: the standard 40 squares or a bigger ring (see MAP_SIZES in board.ts). */
  map: MapSize;
  /** Points for Nhất / Nhì (the rest is mirrored so games sum to zero). */
  first: number;
  second: number;
  /** House rules (see TPRules in game.ts). */
  buildRule: "even" | "chain";
  needGroup: boolean;
  sellLand: boolean;
  bankruptTo: "bank" | "creditor";
  /** Cash for passing Khởi hành (GO_SALARY_OPTIONS). */
  goSalary: number;
  /** Each building on a lot costs more than the last. */
  risingCost: boolean;
  /** Extra % to lift a mortgage (UNMORTGAGE_FEE_OPTIONS). */
  unmortgageFee: number;
  /** % of the price paid for land sold back to the bank (LAND_SALE_OPTIONS). */
  landSalePct: number;
  /** Owners in jail still collect rent. */
  jailRent: boolean;
  /** A double gives another roll. */
  doubleRoll: boolean;
}

/** A player's token: the emoji that walks the board and the colour of their houses / deeds. */
export interface TPPiece {
  emoji: string;
  color: string;
}
/** Pieces every seat starts with (by seat index). */
export const DEFAULT_PIECES: TPPiece[] = [
  { emoji: "🛵", color: "#ef4444" },
  { emoji: "🐃", color: "#3b82f6" },
  { emoji: "🚲", color: "#22c55e" },
  { emoji: "🚤", color: "#eab308" },
  { emoji: "🐉", color: "#a855f7" },
  { emoji: "🎩", color: "#f97316" },
];
/** What a player may pick with `{ type: "pick", emoji, color }` — nobody else at the table may hold the same emoji or colour. */
export const PIECE_EMOJIS = ["🛵", "🐃", "🚲", "🚤", "🐉", "🎩", "🚗", "🐘", "🦅", "🐅", "🚁", "🐒", "🐱", "🐈", "🐈‍⬛", "😺", "😻", "😼", "🙀", "🦁", "🐆"];
export const PIECE_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];

export interface TPSeatView {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  inGame: boolean;
  kicked: boolean;
  points: number;
  games: number;
  wins: number;
  /** Token colour index (stable per seat) — the starting piece is DEFAULT_PIECES[color]. */
  color: number;
  /** The piece this player plays with (their pick, else a starting piece nobody else holds). */
  piece: TPPiece;
}

export interface TPPlayerView {
  id: string;
  pos: number;
  cash: number;
  jail: number;
  jailCards: number;
  bankrupt: boolean;
  netWorth: number;
}

export interface TPGameView {
  status: "playing" | "ended";
  /** Map this game is played on (missing = standard). */
  map?: MapSize;
  players: TPPlayerView[];
  deeds: Record<number, Deed>;
  turn: string | null;
  phase: Phase;
  deadline: number | null;
  dice: [number, number] | null;
  rollAgain: boolean;
  debt: { amount: number; to: string | null; reason: string } | null;
  trade: { from: string; to: string; give: TradeSide; get: TradeSide; deadline: number } | null;
  /** Pending request to borrow money, and the loans in force. */
  loan: LoanOffer | null;
  loans: Loan[];
  lastCard: { deck: "chance" | "chest"; text: string; player: string; at: number } | null;
  finished: string[];
  endsAt: number | null;
  /** Nghỉ chân pot (null when the rule is off). */
  pot: number | null;
  log: LogEntry[];
  /** The viewer's own lots: why they can't build / sell a house / sell the land (null = allowed), and the land's sale price. */
  manage?: Record<number, { build: string | null; sell: string | null; sellLand: string | null; landPrice: number }>;
}

export interface TPRoomView {
  game: "typhu";
  code: string;
  meId: string;
  role: "player" | "spectator";
  /** Only in your own view: your auto-play (Ctrl+Shift+Y) is on and the server plays your turns. */
  auto?: boolean;
  serverTime: number;
  settings: TPSettings;
  seats: (TPSeatView | null)[];
  current: TPGameView | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat: ChatMessage[];
}

export interface TPRoomSummary {
  code: string;
  status: "waiting" | "playing";
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/**
 * Cờ Tỷ Phú commands (acked like the other games):
 *   { type: "start" } · { type: "settings", startCash, timeLimit } · { type: "kick", playerId }
 *   { type: "roll" } · { type: "buy" } · { type: "skip" } · { type: "end" }
 *   { type: "payjail" } · { type: "jailcard" } · { type: "paydebt" } · { type: "bankrupt" }
 *   { type: "build" | "sell" | "mortgage" | "unmortgage", pos }
 *   { type: "trade", to, give: {props, cash}, get: {props, cash} }
 *   { type: "loan", to, amount, rate: 10 | 20 }  // ask `to` to lend `amount`; repaid + rate% after 5 of your turns
 *   { type: "loananswer", accept }   // the lender answers; the borrower can withdraw with accept: false
 *   { type: "tradeanswer", accept }   // the receiver answers; the proposer can withdraw with accept: false
 *   { type: "auto", on }   // your own auto-play: the server plays your turns (buys squares under AUTO_BUY_BELOW, builds), keeping AUTO_KEEP_CASH
 */
export type TPCommand =
  | { type: "start" }
  | {
      type: "settings";
      startCash?: number;
      timeLimit?: number;
      stepSeconds?: number;
      doubleGo?: boolean;
      parkingPot?: boolean;
      map?: MapSize;
      first?: number;
      second?: number;
      buildRule?: "even" | "chain";
      needGroup?: boolean;
      sellLand?: boolean;
      bankruptTo?: "bank" | "creditor";
      goSalary?: number;
      risingCost?: boolean;
      unmortgageFee?: number;
      landSalePct?: number;
      jailRent?: boolean;
      doubleRoll?: boolean;
    }
  | { type: "pick"; emoji: string; color: string }
  | { type: "kick"; playerId: string }
  | { type: "roll" | "buy" | "skip" | "end" | "payjail" | "jailcard" | "paydebt" | "bankrupt" }
  | { type: "build" | "sell" | "sellland" | "mortgage" | "unmortgage"; pos: number }
  | { type: "trade"; to: string; give: TradeSide; get: TradeSide }
  | { type: "loan"; to: string; amount: number; rate: number }
  | { type: "loananswer"; accept: boolean }
  | { type: "tradeanswer"; accept: boolean }
  | { type: "auto"; on: boolean };
