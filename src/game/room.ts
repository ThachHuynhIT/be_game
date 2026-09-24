import type { Card } from "./cards";
import {
  type ActionResult,
  type GameState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  autoAction,
  newGame,
  pass,
  play,
} from "./game";
import { MAX_NAME_LENGTH, type RoomView, TURN_SECONDS } from "./protocol";

/**
 * Room lifecycle as pure functions over JSON-serialisable state, so a room can
 * live in Redis and be updated by whichever function instance a player's
 * WebSocket landed on. There are no timers: time is passed in as `now` and
 * `tick()` resolves whatever has expired.
 */

/** A player with no heartbeat for this long is shown as disconnected (and auto-played on their turn). */
export const PRESENCE_TIMEOUT_MS = 25_000;
/** A disconnected player keeps their seat for this long (between games). */
export const SEAT_GRACE_MS = 60_000;
/** Only persist a heartbeat when the previous one is older than this. */
export const HEARTBEAT_WRITE_MS = 8_000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  lastSeen: number;
  /** Explicitly left (closed the tab / navigated away) — treated as offline immediately. */
  left?: boolean;
  wins: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  seats: (RoomPlayer | null)[];
  game: GameState | null;
  turnDeadline: number | null;
  /** Winner of the last finished game leads the next one. */
  lastWinner: string | null;
}

export function randomCode(length = 5, random: () => number = Math.random) {
  return Array.from({ length }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join("");
}

export const cleanName = (name: unknown) =>
  (typeof name === "string" ? name : "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) || "Người chơi";

export function newRoom(code: string): RoomState {
  return { code, hostId: "", seats: [null, null, null, null], game: null, turnDeadline: null, lastWinner: null };
}

export const isOnline = (p: RoomPlayer, now: number) => !p.left && now - p.lastSeen < PRESENCE_TIMEOUT_MS;

export const findByToken = (room: RoomState, token: string) => room.seats.find((p) => p?.token === token) ?? null;
export const findById = (room: RoomState, id: string) => room.seats.find((p) => p?.id === id) ?? null;

const inPlayingGame = (room: RoomState, id: string) =>
  room.game?.status === "playing" && room.game.players.includes(id);

const freshTurnTimer = (room: RoomState, now: number) => {
  room.turnDeadline = now + TURN_SECONDS * 1000;
};

/** Seat a player, or re-attach a returning one by token. */
export function joinRoom(
  room: RoomState,
  token: string,
  name: string,
  now: number,
  newId: () => string,
): { ok: true; player: RoomPlayer } | { ok: false; error: string } {
  if (typeof token !== "string" || token.length < 8 || token.length > 128) {
    return { ok: false, error: "Phiên không hợp lệ" };
  }
  let player = findByToken(room, token);
  if (player) {
    if (!inPlayingGame(room, player.id)) player.name = cleanName(name);
    // Coming back to your own turn after being away gets a fresh timer.
    if (!isOnline(player, now) && room.game?.turn === player.id) freshTurnTimer(room, now);
  } else {
    dropGoneSeats(room, now);
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: "Phòng đã đủ 4 người" };
    player = { id: newId(), token, name: cleanName(name), lastSeen: now, wins: 0 };
    room.seats[free] = player;
  }
  player.lastSeen = now;
  delete player.left;
  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) room.hostId = player.id;
  return { ok: true, player };
}

/** Record a heartbeat. Returns true if the state needs saving. */
export function heartbeat(room: RoomState, player: RoomPlayer, now: number): boolean {
  if (now - player.lastSeen < HEARTBEAT_WRITE_MS && !player.left) return false;
  if (!isOnline(player, now) && room.game?.turn === player.id) freshTurnTimer(room, now);
  player.lastSeen = now;
  delete player.left;
  return true;
}

/** The player closed the page. Mid-game they stay seated and are auto-played. */
export function leaveRoom(room: RoomState, player: RoomPlayer, now: number) {
  player.left = true;
  if (!inPlayingGame(room, player.id)) {
    const idx = room.seats.indexOf(player);
    if (idx >= 0) room.seats[idx] = null;
  }
  tick(room, now);
}

export function startGame(room: RoomState, player: RoomPlayer, now: number): ActionResult {
  if (room.hostId !== player.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.game?.status === "playing") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is RoomPlayer => !!p).map((p) => p.id);
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần ít nhất ${MIN_PLAYERS} người` };
  if (players.length > MAX_PLAYERS) return { ok: false, error: "Quá nhiều người" };
  const starter = room.lastWinner && players.includes(room.lastWinner) ? room.lastWinner : undefined;
  room.game = newGame(players, { starter });
  afterAction(room, now);
  return { ok: true };
}

export function playCards(room: RoomState, player: RoomPlayer, cards: unknown, now: number): ActionResult {
  if (!room.game) return { ok: false, error: "Chưa bắt đầu ván" };
  const clean: Card[] = Array.isArray(cards)
    ? cards.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < 52)
    : [];
  const res = play(room.game, player.id, clean);
  if (res.ok) afterAction(room, now);
  return res;
}

export function passTurn(room: RoomState, player: RoomPlayer, now: number): ActionResult {
  if (!room.game) return { ok: false, error: "Chưa bắt đầu ván" };
  const res = pass(room.game, player.id);
  if (res.ok) afterAction(room, now);
  return res;
}

/**
 * Resolve everything that is due at `now`:
 *  - an expired turn timer → auto pass / lead the lowest card
 *  - the turn player is offline → auto-play straight away
 *  - host gone → hand host to someone online
 *  - between games, free seats of players gone past the grace period
 * Returns true if the state changed.
 */
export function tick(room: RoomState, now: number): boolean {
  let changed = false;
  // Several absent players in a row can each be auto-played in one tick.
  for (let guard = 0; guard < 16; guard++) {
    const g = room.game;
    if (!g || g.status !== "playing" || !g.turn) break;
    const turnPlayer = findById(room, g.turn);
    const expired = room.turnDeadline !== null && now >= room.turnDeadline;
    const absent = !turnPlayer || !isOnline(turnPlayer, now);
    if (!expired && !absent) break;
    autoAction(g, g.turn);
    afterAction(room, now);
    changed = true;
  }

  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) {
    const next = room.seats.find((p) => p && isOnline(p, now));
    if (next && next.id !== room.hostId) {
      room.hostId = next.id;
      changed = true;
    }
  }

  if (room.game?.status !== "playing" && dropGoneSeats(room, now)) changed = true;
  return changed;
}

/** When `tick` next has something to do (ms epoch), or null if nothing is scheduled. */
export function nextTickAt(room: RoomState, now: number): number | null {
  const times: number[] = [];
  if (room.game?.status === "playing" && room.turnDeadline) times.push(room.turnDeadline);
  for (const p of room.seats) {
    if (!p || p.left) continue;
    // Moment a player would flip to offline (matters on their turn / for host handover / seat drop).
    if (isOnline(p, now)) times.push(p.lastSeen + PRESENCE_TIMEOUT_MS);
    else times.push(p.lastSeen + SEAT_GRACE_MS + 1);
  }
  return times.length ? Math.min(...times) : null;
}

function afterAction(room: RoomState, now: number) {
  const g = room.game;
  if (g?.status === "ended") {
    room.turnDeadline = null;
    room.lastWinner = g.finished[0] ?? null;
    const winner = room.lastWinner ? findById(room, room.lastWinner) : null;
    if (winner) winner.wins++;
    return;
  }
  if (g?.turn) freshTurnTimer(room, now);
  else room.turnDeadline = null;
}

/** Free seats of players who have been gone longer than the grace period (never mid-game). */
function dropGoneSeats(room: RoomState, now: number): boolean {
  let dropped = false;
  room.seats = room.seats.map((p) => {
    if (p && (p.left || now - p.lastSeen > SEAT_GRACE_MS) && !inPlayingGame(room, p.id)) {
      dropped = true;
      return null;
    }
    return p;
  });
  return dropped;
}

export function roomView(room: RoomState, player: RoomPlayer, now: number): RoomView {
  const g = room.game;
  return {
    code: room.code,
    meId: player.id,
    serverTime: now,
    seats: room.seats.map((p) =>
      p
        ? {
            id: p.id,
            name: p.name,
            connected: isOnline(p, now),
            isHost: room.hostId === p.id,
            inGame: !!g?.players.includes(p.id),
            cardCount: g?.hands[p.id]?.length ?? 0,
            passed: !!g?.passed.includes(p.id),
            wins: p.wins,
          }
        : null,
    ),
    game: g
      ? {
          status: g.status,
          turn: g.turn,
          turnDeadline: room.turnDeadline,
          lastPlay: g.lastPlay,
          finished: g.finished,
          mustInclude: g.mustInclude,
          instantWin: g.instantWin,
        }
      : null,
    hand: g?.hands[player.id] ?? [],
  };
}
