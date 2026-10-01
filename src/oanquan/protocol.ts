import type { ChatMessage, GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";

export type { ChatMessage, GameRecord, LeaderboardEntry, Reaction };
export { CHAT_MAX_LENGTH, EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Ô Ăn Quan. */
export const OANQUAN_WS_PATH = "/api/oanquan/ws";

export interface OQSettings {
  /** How many dân one quan is worth at the end: 5 or 10. */
  quanValue: number;
  /** Quan non: an ô quan with its quan can't be captured while it holds fewer than 5 dân. */
  quanNon: boolean;
  turnSeconds: number;
  first: number;
  second: number;
}

export interface OQSeatView {
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

/** One step of a move, in order, for the client to animate. */
export type OQStep =
  | { k: "pick"; cell: number; n: number }
  | { k: "sow"; cell: number }
  | { k: "capture"; cell: number; dan: number; quan: boolean };

export interface OQMove {
  seq: number;
  player: string;
  cell: number;
  /** +1 = toward higher square numbers ("phải" for the mover), −1 = "trái". */
  dir: 1 | -1;
  /** Board just before the move (after any reseeding at the start of the turn). */
  before: { dan: number[]; quan: boolean[] };
  steps: OQStep[];
  auto?: boolean;
}

export interface OQReseed {
  seq: number;
  player: string;
  /** Dân taken from the opponent's pile (debt). */
  borrowed: number;
}

export interface OQPlayerView {
  id: string;
  /** 0 = owns squares 1–5 (bottom row), 1 = owns 7–11. */
  side: 0 | 1;
  captured: { dan: number; quan: number };
  /** Dân borrowed from the opponent to reseed (subtracted from the score, given back to them). */
  borrowed: number;
  /** Score right now: dân + quan × value − borrowed + lent (+ own row once the game ends). */
  score: number;
}

export interface OQGameView {
  status: "playing" | "ended";
  turn: string | null;
  deadline: number | null;
  /** Dân per square, 12 squares (see board.ts for the layout). */
  dan: number[];
  /** Whether the quan piece is still on square 0 / square 6. */
  quan: boolean[];
  quanValue: number;
  quanNon: boolean;
  players: OQPlayerView[];
  moves: number;
  finished: string[];
  /** null = draw (or not ended). */
  winner: string | null;
  endReason: "board" | "stuck" | "forfeit" | "limit" | null;
  lastMove: OQMove | null;
  lastReseed: OQReseed | null;
  log: { id: number; at: number; text: string; tone?: string }[];
}

export interface OQRoomView {
  game: "oanquan";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  settings: OQSettings;
  seats: (OQSeatView | null)[];
  current: OQGameView | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat: ChatMessage[];
}

export interface OQRoomSummary {
  code: string;
  status: "waiting" | "playing";
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/**
 * Ô Ăn Quan commands (acked like the other games):
 *   { type: "start" } · { type: "settings", quanValue?, quanNon?, turnSeconds?, first?, second? } · { type: "kick", playerId }
 *   { type: "move", cell: 1–5 | 7–11, dir: 1 | -1 }   // pick up a non-empty ô dân on your row and sow
 */
export type OQCommand =
  | { type: "start" }
  | { type: "settings"; quanValue?: number; quanNon?: boolean; turnSeconds?: number; first?: number; second?: number }
  | { type: "kick"; playerId: string }
  | { type: "move"; cell: number; dir: 1 | -1 };
