import type { ChatMessage, GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";
import type { DictionaryMode } from "./board";

export type { ChatMessage, GameRecord, LeaderboardEntry, Reaction, DictionaryMode };
export { CHAT_MAX_LENGTH, EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Nối Chữ. */
export const NOICHU_WS_PATH = "/api/noichu/ws";

export interface NCSettings {
  turnSeconds: number;
  /** How words are checked: strict = in the dictionary, loose = dictionary or two real syllables, off = any two syllables. */
  dictionary: DictionaryMode;
  first: number;
  second: number;
}

export interface NCSeatView {
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

export interface NCWordView {
  /** Player id, or null for the opening word the server picked. */
  by: string | null;
  word: string;
  at: number;
}

export interface NCPlayerView {
  id: string;
  /** Turn order. */
  seat: number;
  /** Words this player added to the chain. */
  words: number;
  out: boolean;
  /** Final rank once ended (0 = first, ties share), else null. */
  rank: number | null;
}

export interface NCGameView {
  status: "playing" | "ended";
  turn: string | null;
  deadline: number | null;
  /** Syllable the next word must start with (the last syllable of the last word). */
  need: string | null;
  dictionary: DictionaryMode;
  players: NCPlayerView[];
  /** The last CHAIN_VIEW_LIMIT words, oldest first; `chainLength` counts them all. */
  chain: NCWordView[];
  chainLength: number;
  /** Final order, best first. */
  finished: string[];
  /** null = shared first place (or not ended). */
  winner: string | null;
  endReason: "last" | "forfeit" | "limit" | null;
  log: { id: number; at: number; text: string; tone?: string }[];
}

export const CHAIN_VIEW_LIMIT = 40;

export interface NCRoomView {
  game: "noichu";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  settings: NCSettings;
  seats: (NCSeatView | null)[];
  current: NCGameView | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat: ChatMessage[];
}

export interface NCRoomSummary {
  code: string;
  status: "waiting" | "playing";
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/**
 * Nối Chữ commands (acked like the other games):
 *   { type: "start" } · { type: "settings", turnSeconds?, dictionary?: "strict" | "loose" | "off", first?, second? } · { type: "kick", playerId }
 *   { type: "word", text }   // a two-syllable word that starts with the last syllable of the previous word
 */
export type NCCommand =
  | { type: "start" }
  | { type: "settings"; turnSeconds?: number; dictionary?: DictionaryMode; first?: number; second?: number }
  | { type: "kick"; playerId: string }
  | { type: "word"; text: string };
