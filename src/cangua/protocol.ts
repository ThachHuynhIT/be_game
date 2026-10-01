import type { ChatMessage, GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";

export type { ChatMessage, GameRecord, LeaderboardEntry, Reaction };
export { CHAT_MAX_LENGTH, EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Cờ Cá Ngựa. */
export const CANGUA_WS_PATH = "/api/cangua/ws";

export interface CNSettings {
  /** A 1 can also bring a horse out (otherwise only a 6). */
  exitOn1: boolean;
  /** Horses cannot jump over another horse on the way. */
  noJump: boolean;
  /** Home column: enter step 1 by exact count, then step n → n+1 needs exactly n+1. */
  ladder: boolean;
  /** Three 6s in a row lose the turn. */
  threeSixes: boolean;
  /** Keep playing after the first finisher until everyone is ranked. */
  rankAll: boolean;
  turnSeconds: number;
  first: number;
  second: number;
}

export interface CNSeatView {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  inGame: boolean;
  kicked: boolean;
  points: number;
  games: number;
  wins: number;
}

export interface CNPlayerView {
  id: string;
  /** 0 đỏ · 1 xanh dương · 2 vàng · 3 xanh lá. */
  color: number;
  /** Progress per horse: -1 stable, 0..55 track, 56..61 home steps 1..6. */
  horses: number[];
  done: boolean;
  forfeited: boolean;
}

export interface CNMove {
  seq: number;
  player: string;
  horse: number;
  from: number;
  to: number;
  kicked: { player: string; horse: number; from: number } | null;
}

export interface CNGameView {
  status: "playing" | "ended";
  turn: string | null;
  phase: "roll" | "move";
  deadline: number | null;
  /** The die of the current turn while choosing a horse. */
  die: number | null;
  /** 6s rolled in a row this turn. */
  sixes: number;
  /** Horses (indices) the current player may move. */
  legal: number[];
  players: CNPlayerView[];
  /** Players home in order (while playing); the full ranking once ended. */
  finished: string[];
  roll: { seq: number; player: string; value: number } | null;
  last: CNMove | null;
  log: { id: number; at: number; text: string; tone?: string }[];
}

export interface CNRoomView {
  game: "cangua";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  settings: CNSettings;
  seats: (CNSeatView | null)[];
  current: CNGameView | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat: ChatMessage[];
}

export interface CNRoomSummary {
  code: string;
  status: "waiting" | "playing";
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/**
 * Cờ Cá Ngựa commands (acked like the other games):
 *   { type: "start" } · { type: "kick", playerId }
 *   { type: "settings", exitOn1?, noJump?, ladder?, threeSixes?, rankAll?, turnSeconds?, first?, second? }
 *   { type: "roll" }                 // roll the die
 *   { type: "move", horse: 0-3 }     // move one of the legal horses
 */
export type CNCommand =
  | { type: "start" }
  | {
      type: "settings";
      exitOn1?: boolean;
      noJump?: boolean;
      ladder?: boolean;
      threeSixes?: boolean;
      rankAll?: boolean;
      turnSeconds?: number;
      first?: number;
      second?: number;
    }
  | { type: "kick"; playerId: string }
  | { type: "roll" }
  | { type: "move"; horse: number };
