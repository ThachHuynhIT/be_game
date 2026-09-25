import type { GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";
import type { Deed, LogEntry, Phase, TradeSide } from "./game";

export type { Deed, GameRecord, LeaderboardEntry, LogEntry, Phase, Reaction, TradeSide };
export { EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Cờ Tỷ Phú. */
export const TYPHU_WS_PATH = "/api/typhu/ws";

export interface TPSettings {
  startCash: number;
  /** Minutes, 0 = no limit. */
  timeLimit: number;
}

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
  /** Token colour index (stable per seat). */
  color: number;
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
  players: TPPlayerView[];
  deeds: Record<number, Deed>;
  turn: string | null;
  phase: Phase;
  deadline: number | null;
  dice: [number, number] | null;
  rollAgain: boolean;
  debt: { amount: number; to: string | null; reason: string } | null;
  trade: { from: string; to: string; give: TradeSide; get: TradeSide; deadline: number } | null;
  lastCard: { deck: "chance" | "chest"; text: string; player: string; at: number } | null;
  finished: string[];
  endsAt: number | null;
  log: LogEntry[];
}

export interface TPRoomView {
  game: "typhu";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  settings: TPSettings;
  seats: (TPSeatView | null)[];
  current: TPGameView | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
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
 *   { type: "tradeanswer", accept }   // the receiver answers; the proposer can withdraw with accept: false
 */
export type TPCommand =
  | { type: "start" }
  | { type: "settings"; startCash?: number; timeLimit?: number }
  | { type: "kick"; playerId: string }
  | { type: "roll" | "buy" | "skip" | "end" | "payjail" | "jailcard" | "paydebt" | "bankrupt" }
  | { type: "build" | "sell" | "mortgage" | "unmortgage"; pos: number }
  | { type: "trade"; to: string; give: TradeSide; get: TradeSide }
  | { type: "tradeanswer"; accept: boolean };
