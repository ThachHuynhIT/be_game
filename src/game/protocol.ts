import type { Card } from "./cards";
import type { LastPlay } from "./game";
import type { InstantWinReason } from "./rules";

export const MAX_NAME_LENGTH = 16;
export const TURN_SECONDS = 30;
/** Path of the WebSocket endpoint (Vercel function `api/ws.ts`, and the local dev server). */
export const WS_PATH = "/api/ws";
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
  wins: number;
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
}

/** The full snapshot sent to one client after every change. */
export interface RoomView {
  code: string;
  meId: string;
  /** Server clock when the view was built — lets clients correct for clock skew. */
  serverTime: number;
  /** Up to 4 seats in turn order; null = empty seat. */
  seats: (SeatView | null)[];
  game: GameView | null;
  hand: Card[];
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
  | { type: "ping" };

/** Server → client. */
export type ServerMessage =
  | ({ type: "ack"; id: number } & AckResult<{ code?: string }>)
  | { type: "state"; view: RoomView }
  /** This connection is about to hit the platform time limit — open a new one now. */
  | { type: "reconnect" }
  | { type: "pong" };
