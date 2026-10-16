import type { Card } from "./cards";
import type { LastPlay } from "./game";
import type { InstantWinReason } from "./rules";

export const MAX_NAME_LENGTH = 20;
export const TURN_SECONDS = 30;
/** Path of the WebSocket endpoint (Vercel function `api/ws.ts`, and the local dev server). */
export const WS_PATH = "/api/ws";
/** Emoji anyone in a room (players and spectators) can send. */
export const EMOJIS = ["👍", "😂", "😮", "😭", "😡", "🔥", "👏", "🤔", "😎", "💩", "🐷", "🐔", "🎉"] as const;
/** Minimum gap between two emoji from one connection. */
export const EMOJI_COOLDOWN_MS = 1_200;

/** Clients ping this often; the ping doubles as the presence heartbeat. */
export const PING_INTERVAL_MS = 10_000;

export interface SeatView {
  /** Public id — safe to show to everyone (the secret reconnect token never leaves the server). */
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  /** Seat is in the current game (players who join mid-game wait for the next one). */
  inGame: boolean;
  cardCount: number;
  passed: boolean;
  /** The server passed for them: nothing in hand could beat the table. */
  autoPassed?: boolean;
  wins: number;
  /** Cumulative points in this room. */
  points: number;
  /** Kicked by the host mid-game (forfeits the game). */
  kicked: boolean;
  games: number;
}

/** One finished game. `rank` 0 = Nhất; `delta` is the point change (see scoring.ts). */
export interface GameRecord {
  id: string;
  at: number;
  instantWin: InstantWinReason | null;
  /** `burned` = chết cháy (lost double). */
  results: { id: string; name: string; rank: number; delta: number; burned?: boolean }[];
}

/** Free-text chat, shared by players and spectators. */
export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY = 40;
export const CHAT_COOLDOWN_MS = 600;

export interface ChatMessage {
  id: string;
  at: number;
  name: string;
  /** Seat id when a player sent it; null for spectators. */
  playerId: string | null;
  text: string;
}

export interface Reaction {
  id: string;
  at: number;
  emoji: string;
  name: string;
  /** Seat id when a player sent it; null for spectators. */
  playerId: string | null;
}

/** One room in the lobby list. */
export interface RoomSummary {
  code: string;
  status: "waiting" | "playing";
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/** A row of the all-time leaderboard (keyed by player name). */
export interface LeaderboardEntry {
  name: string;
  points: number;
  games: number;
  /** Games finished first. */
  wins: number;
  lastPlayed: number;
}

/** One line of a game's move history (Lịch sử ván). */
export interface TLMove {
  id: number;
  /** play · pass (auto = the server passed) · round = new round, `player` leads · out = went out (`rank` 0 = Nhất) · burned = chết cháy · forfeit = kicked */
  kind: "play" | "pass" | "round" | "out" | "burned" | "forfeit";
  player: string;
  cards?: Card[];
  auto?: boolean;
  chop?: boolean;
  chopPoints?: number;
  rank?: number;
}

export interface GameView {
  status: "playing" | "ended";
  turn: string | null;
  /** Epoch ms (server clock) when the current turn auto-resolves. */
  turnDeadline: number | null;
  lastPlay: LastPlay | null;
  finished: string[];
  mustInclude: Card | null;
  instantWin: { playerId: string; reason: InstantWinReason } | null;
  /** Chết cháy players (still holding all 13 cards when the first player finished). */
  burned: string[];
  /** Everything that happened this game, oldest first (missing on games saved before it existed). */
  moves?: TLMove[];
}

/** The full snapshot sent to one client after every change. */
export interface RoomView {
  code: string;
  /** Your seat id; empty for spectators. */
  meId: string;
  role: "player" | "spectator";
  /** Server clock when the view was built — lets clients correct for clock skew. */
  serverTime: number;
  /** Up to 4 seats in turn order; null = empty seat. */
  seats: (SeatView | null)[];
  game: GameView | null;
  hand: Card[];
  /** Recent finished games in this room, newest last. */
  history: GameRecord[];
  /** Names of people watching. */
  spectators: string[];
  /** Emoji sent in the last few seconds. */
  reactions: Reaction[];
  chat: ChatMessage[];
  /** Host settings: auto-pass and Nhất / Nhì points. */
  settings: { autoPass: boolean; first: number; second: number };
}

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Client → server. Every message except `ping` carries an `id` that the server acks. */
export type ClientMessage =
  | { type: "create"; id: number }
  | { type: "join"; id: number; code: string; name: string; token: string }
  | { type: "start"; id: number }
  | { type: "play"; id: number; cards: Card[] }
  | { type: "pass"; id: number }
  | { type: "leave"; id: number }
  | { type: "watch"; id: number; code: string; name: string; token: string }
  | { type: "emoji"; id: number; emoji: string }
  /** Host only: remove a disconnected player (they forfeit a running game). */
  | { type: "kick"; id: number; playerId: string }
  | { type: "ping" };

/** Server → client. */
export type ServerMessage =
  | ({ type: "ack"; id: number } & AckResult<{ code?: string }>)
  | { type: "state"; view: RoomView }
  /** This connection is about to hit the platform time limit — open a new one now. */
  | { type: "reconnect" }
  | { type: "pong" };
