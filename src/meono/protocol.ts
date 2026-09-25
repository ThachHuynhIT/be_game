import type { CardType, Expansion, MCard } from "./cards";
import type { ChatMessage, GameRecord, LeaderboardEntry, Reaction } from "../game/protocol";

export type { ChatMessage, CardType, Expansion, MCard, GameRecord, LeaderboardEntry, Reaction };
export { CHAT_MAX_LENGTH, EMOJIS, EMOJI_COOLDOWN_MS, MAX_NAME_LENGTH, PING_INTERVAL_MS } from "../game/protocol";

/** WebSocket endpoint for Mèo Nổ. */
export const MEONO_WS_PATH = "/api/meono/ws";

export interface MeoSeatView {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  inGame: boolean;
  /** Eliminated (exploded or kicked) in the current game. */
  out: boolean;
  kicked: boolean;
  cardCount: number;
  points: number;
  games: number;
  wins: number;
}

export interface MeoGameView {
  status: "playing" | "ended";
  turn: string | null;
  turnsLeft: number;
  /** 1 = seat order, −1 = reversed. */
  dir: 1 | -1;
  expansions: Expansion[];
  /** Face-up Mèo Tự Huỷ position in the deck (0 = top), public. */
  implodingAt: number | null;
  /** Epoch ms (server clock). */
  turnDeadline: number | null;
  deckCount: number;
  /** Discard pile, bottom first (public in the real game too). */
  discard: CardType[];
  pending: {
    kind: string;
    by: string;
    target: string | null;
    named: CardType | null;
    cards: CardType[];
    nopes: number;
    deadline: number;
  } | null;
  choice:
    | { kind: "defuse" | "implode" | "alter"; player: string; deadline: number }
    | { kind: "favor"; from: string; to: string; deadline: number }
    | null;
  finished: string[];
  log: { id: number; at: number; text: string; tone?: string }[];
}

export interface MeoRoomView {
  game: "meono";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  /** Packs enabled for the next game (host setting). */
  expansions: Expansion[];
  /** Other host settings. */
  settings: { turnSeconds: number; nopeSeconds: number; first: number; second: number };
  maxPlayers: number;
  seats: (MeoSeatView | null)[];
  current: MeoGameView | null;
  hand: MCard[];
  /** Top of the deck, if you just played See the Future (index 0 = next card). */
  future: CardType[] | null;
  /** Sửa tương lai: the cards you are reordering (send their ids back, first = top). */
  alter: MCard[] | null;
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat: ChatMessage[];
}

export interface MeoRoomSummary {
  code: string;
  status: "waiting" | "playing";
  expansions: Expansion[];
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/**
 * Mèo Nổ commands (sent with an `id`, acked like the Tiến Lên protocol):
 *   { type: "start" }
 *   { type: "mplay", cards: number[], target?: seatId, named?: CardType }
 *   { type: "nope", card: number }
 *   { type: "draw" }
 *   { type: "insert", position: number }   // after defusing, 0 = top of deck
 *   { type: "give", card: number }          // answering a Favor
 *   { type: "alter", order: number[] }      // Sửa tương lai: new order, first = top
 *   { type: "settings", expansions }        // host, between games
 *   { type: "kick", playerId }
 * plus the shared create / join / watch / leave / emoji / ping.
 */
export type MeoCommand =
  | { type: "start" }
  | { type: "mplay"; cards: number[]; target?: string; named?: CardType }
  | { type: "nope"; card: number }
  | { type: "draw" }
  | { type: "insert"; position: number }
  | { type: "give"; card: number }
  | { type: "alter"; order: number[] }
  | { type: "settings"; expansions?: Expansion[]; turnSeconds?: number; nopeSeconds?: number; first?: number; second?: number }
  | { type: "kick"; playerId: string };
