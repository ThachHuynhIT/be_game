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
  /** When the move was made — with `seq` it identifies a move across games (seq restarts every game). */
  at?: number;
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
  /** Dân taken from other players' piles (debt), in total. */
  borrowed: number;
  /** Who lent how much (absent when nothing was borrowed). */
  lenders?: { id: string; n: number }[];
}

export interface OQPlayerView {
  id: string;
  /** Segment index: owns squares 6·side+1 … 6·side+5; its ô quan is square 6·side. Also the turn order. */
  side: number;
  captured: { dan: number; quan: number };
  /** Dân borrowed from other players to reseed (subtracted from the score, credited to the lenders). */
  borrowed: number;
  /** Dân other players still owe this player (added to the score). */
  lent: number;
  /** Could not reseed (or was kicked): skips turns; their cells stay on the board. */
  out: boolean;
  /** Final rank once ended (0 = first, ties share), else null. */
  rank: number | null;
  /** Score right now: dân + quan × value − borrowed + lent (+ own row once the game ends). */
  score: number;
}

export interface OQGameView {
  status: "playing" | "ended";
  turn: string | null;
  deadline: number | null;
  /** Dân per square, 6 × players squares (12 for two players; see board.ts for the layout). */
  dan: number[];
  /** Whether the quan piece is still on square 0, 6, 12, 18 (one entry per player). */
  quan: boolean[];
  quanValue: number;
  quanNon: boolean;
  players: OQPlayerView[];
  moves: number;
  /** Final order, best first (ties keep a stable order; see players[].rank). */
  finished: string[];
  /** null = shared first place (or not ended). */
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
 *   { type: "move", cell: 6·side+1 … 6·side+5, dir: 1 | -1 }   // pick up a non-empty ô dân on your row and sow
 */
export type OQCommand =
  | { type: "start" }
  | { type: "settings"; quanValue?: number; quanNon?: boolean; turnSeconds?: number; first?: number; second?: number }
  | { type: "kick"; playerId: string }
  | { type: "move"; cell: number; dir: 1 | -1 };
