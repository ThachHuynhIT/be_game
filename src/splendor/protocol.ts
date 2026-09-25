import type { ChatMessage, GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";
import type { Gem, Token } from "./cards";

export type { ChatMessage, Gem, GameRecord, LeaderboardEntry, Reaction, Token };
export { CHAT_MAX_LENGTH, EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Đá Quý. */
export const SPLENDOR_WS_PATH = "/api/splendor/ws";

export interface SPSettings {
  /** Prestige points that trigger the last round. */
  target: number;
  turnSeconds: number;
  first: number;
  second: number;
}

export interface SPSeatView {
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

export interface SPPlayerView {
  id: string;
  tokens: Record<Token, number>;
  /** Owned card ids (public). */
  owned: number[];
  bonuses: Record<Gem, number>;
  nobles: number[];
  /** Your own reserved cards; for others only the count and the ones taken face-up. */
  reserved: (number | null)[];
  prestige: number;
}

export interface SPGameView {
  status: "playing" | "ended";
  turn: string | null;
  phase: "turn" | "discard";
  discardNeed: number;
  deadline: number | null;
  bank: Record<Token, number>;
  board: (number | null)[][];
  deckCounts: number[];
  nobleRow: number[];
  target: number;
  endTriggered: boolean;
  players: SPPlayerView[];
  finished: string[];
  last: { seq: number; player: string; kind: "take" | "reserve" | "buy" | "noble"; card?: number; noble?: number; gems?: Token[] } | null;
  log: { id: number; at: number; text: string; tone?: string }[];
}

export interface SPRoomView {
  game: "splendor";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  settings: SPSettings;
  seats: (SPSeatView | null)[];
  current: SPGameView | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat: ChatMessage[];
}

export interface SPRoomSummary {
  code: string;
  status: "waiting" | "playing";
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/**
 * Đá Quý commands (acked like the other games):
 *   { type: "start" } · { type: "settings", target?, turnSeconds?, first?, second? } · { type: "kick", playerId }
 *   { type: "take", gems: Gem[] }              // 3 different, or 2 of one colour (pile ≥ 4)
 *   { type: "reserve", card?: id, tier?: 1-3 } // face-up card, or blind from a deck; +1 gold if any
 *   { type: "buy", card: id }                  // from the board or your reserve
 *   { type: "discard", tokens: {gem: n} }      // back down to 10 tokens
 *   { type: "pass" }                           // only when nothing else is possible
 */
export type SPCommand =
  | { type: "start" }
  | { type: "settings"; target?: number; turnSeconds?: number; first?: number; second?: number }
  | { type: "kick"; playerId: string }
  | { type: "take"; gems: Gem[] }
  | { type: "reserve"; card?: number; tier?: number }
  | { type: "buy"; card: number }
  | { type: "discard"; tokens: Partial<Record<Token, number>> }
  | { type: "pass" };
