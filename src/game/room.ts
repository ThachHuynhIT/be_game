import type { Card } from "./cards";
import {
  type ActionResult,
  type GameState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  autoAction,
  forfeit,
  newGame,
  pass,
  play,
} from "./game";
import {
  EMOJIS,
  type GameRecord,
  MAX_NAME_LENGTH,
  type Reaction,
  type RoomSummary,
  type RoomView,
  TURN_SECONDS,
} from "./protocol";
import { scoreGame } from "./scoring";

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
  /** Kicked by the host mid-game; the seat is freed once the game ends. */
  kicked?: boolean;
  wins: number;
  /** Cumulative points in this room (see scoring.ts). Optional for rooms saved before scoring existed. */
  points?: number;
  games?: number;
}

/** How many finished games a room remembers. */
export const HISTORY_LIMIT = 20;

export interface RoomState {
  code: string;
  hostId: string;
  seats: (RoomPlayer | null)[];
  game: GameState | null;
  turnDeadline: number | null;
  /** Winner of the last finished game leads the next one. */
  lastWinner: string | null;
  /** Finished games, newest last. */
  history?: GameRecord[];
  /** Games finished in this room so far (used for record ids). */
  gameSeq?: number;
  /** People watching without a seat. */
  spectators?: Spectator[];
  /** Recent emoji reactions (short-lived). */
  reactions?: Reaction[];
}

export interface Spectator {
  token: string;
  name: string;
  lastSeen: number;
}

/** The part of a room that spectators and emoji need — shared by every game. */
export interface SocialRoom {
  seats: ({ id: string; token: string; name: string } | null)[];
  spectators?: Spectator[];
  reactions?: Reaction[];
}

export const MAX_SPECTATORS = 30;
/** Reactions older than this are dropped from the room state. */
export const REACTION_TTL_MS = 6_000;
const MAX_REACTIONS = 12;

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
  if (player?.kicked) return { ok: false, error: "Bạn đã bị chủ phòng mời ra khỏi ván này" };
  if (player) {
    if (!inPlayingGame(room, player.id)) player.name = cleanName(name);
    // Coming back to your own turn after being away gets a fresh timer.
    if (!isOnline(player, now) && room.game?.turn === player.id) freshTurnTimer(room, now);
  } else {
    dropGoneSeats(room, now);
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: "Phòng đã đủ 4 người" };
    player = { id: newId(), token, name: cleanName(name), lastSeen: now, wins: 0, points: 0, games: 0 };
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
  if (player.kicked) return false;
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

export const findSpectator = (room: SocialRoom, token: string) => room.spectators?.find((x) => x.token === token) ?? null;

/** Watch a room without a seat. */
export function watchRoom(room: SocialRoom, token: string, name: string, now: number): { ok: true } | { ok: false; error: string } {
  if (typeof token !== "string" || token.length < 8 || token.length > 128) return { ok: false, error: "Phiên không hợp lệ" };
  pruneSpectators(room, now);
  const existing = findSpectator(room, token);
  if (existing) {
    existing.lastSeen = now;
    existing.name = cleanName(name);
    return { ok: true };
  }
  if ((room.spectators?.length ?? 0) >= MAX_SPECTATORS) return { ok: false, error: "Phòng đã đủ khán giả" };
  room.spectators = [...(room.spectators ?? []), { token, name: cleanName(name), lastSeen: now }];
  return { ok: true };
}

export function spectatorHeartbeat(spectator: Spectator, now: number): boolean {
  if (now - spectator.lastSeen < HEARTBEAT_WRITE_MS) return false;
  spectator.lastSeen = now;
  return true;
}

export function unwatch(room: SocialRoom, token: string) {
  room.spectators = (room.spectators ?? []).filter((x) => x.token !== token);
}

export function pruneSpectators(room: SocialRoom, now: number): boolean {
  const before = room.spectators?.length ?? 0;
  if (!before) return false;
  room.spectators = room.spectators!.filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
  return room.spectators.length !== before;
}

export function pruneReactions(room: SocialRoom, now: number): boolean {
  const before = room.reactions?.length ?? 0;
  if (!before) return false;
  room.reactions = room.reactions!.filter((r) => now - r.at < REACTION_TTL_MS);
  return room.reactions.length !== before;
}

/** Send an emoji to everyone in the room (players and spectators). */
export function react(room: SocialRoom, token: string, emoji: unknown, now: number): { ok: true } | { ok: false; error: string } {
  if (typeof emoji !== "string" || !(EMOJIS as readonly string[]).includes(emoji)) return { ok: false, error: "Emoji không hợp lệ" };
  const player = room.seats.find((p) => p?.token === token) ?? null;
  const spectator = player ? null : findSpectator(room, token);
  if (!player && !spectator) return { ok: false, error: "Bạn chưa vào phòng" };
  pruneReactions(room, now);
  const reaction: Reaction = {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: now,
    emoji,
    name: player?.name ?? spectator!.name,
    playerId: player?.id ?? null,
  };
  room.reactions = [...(room.reactions ?? []), reaction].slice(-MAX_REACTIONS);
  return { ok: true };
}

/** Host removes a disconnected player. Mid-game they forfeit (rank last); otherwise the seat is freed. */
export function kickPlayer(room: RoomState, host: RoomPlayer, targetId: unknown, now: number): ActionResult {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới kích được người chơi" };
  const target = typeof targetId === "string" ? findById(room, targetId) : null;
  if (!target || target.kicked) return { ok: false, error: "Không tìm thấy người chơi" };
  if (target.id === host.id) return { ok: false, error: "Không thể tự kích mình" };
  if (isOnline(target, now)) return { ok: false, error: "Chỉ kích được người đã mất kết nối" };

  const g = room.game;
  if (g && inPlayingGame(room, target.id)) {
    const turnBefore = g.turn;
    const res = forfeit(g, target.id);
    if (!res.ok) return res;
    target.kicked = true;
    target.left = true;
    if (g.status === "ended") afterAction(room, now);
    else if (g.turn !== turnBefore) freshTurnTimer(room, now);
    return { ok: true };
  }
  const idx = room.seats.indexOf(target);
  if (idx >= 0) room.seats[idx] = null;
  return { ok: true };
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
  if (pruneSpectators(room, now)) changed = true;
  if (pruneReactions(room, now)) changed = true;
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
  for (const x of room.spectators ?? []) times.push(x.lastSeen + PRESENCE_TIMEOUT_MS);
  for (const r of room.reactions ?? []) times.push(r.at + REACTION_TTL_MS);
  return times.length ? Math.min(...times) : null;
}

function afterAction(room: RoomState, now: number) {
  const g = room.game;
  if (g?.status === "ended") {
    room.turnDeadline = null;
    room.lastWinner = g.finished[0] ?? null;
    const winner = room.lastWinner ? findById(room, room.lastWinner) : null;
    if (winner) winner.wins++;
    recordGame(room, now);
    return;
  }
  if (g?.turn) freshTurnTimer(room, now);
  else room.turnDeadline = null;
}

/** Apply the game's points to the players and append it to the room history. */
function recordGame(room: RoomState, now: number) {
  const g = room.game;
  if (!g) return;
  const deltas = scoreGame(g.finished, g.instantWin?.playerId ?? null);
  room.gameSeq = (room.gameSeq ?? 0) + 1;
  const record: GameRecord = {
    id: `${room.code}-${room.gameSeq}`,
    at: now,
    instantWin: g.instantWin?.reason ?? null,
    results: g.finished.map((id, rank) => {
      const p = findById(room, id);
      if (p) {
        p.points = (p.points ?? 0) + deltas[id];
        p.games = (p.games ?? 0) + 1;
      }
      return { id, name: p?.name ?? "?", rank, delta: deltas[id] };
    }),
  };
  room.history = [...(room.history ?? []), record].slice(-HISTORY_LIMIT);
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

/** What one client sees. `player` null = spectator (no hand). */
export function roomView(room: RoomState, player: RoomPlayer | null, now: number): RoomView {
  const g = room.game;
  return {
    code: room.code,
    meId: player?.id ?? "",
    role: player ? "player" : "spectator",
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
            points: p.points ?? 0,
            kicked: !!p.kicked,
            games: p.games ?? 0,
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
    hand: player ? (g?.hands[player.id] ?? []) : [],
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
  };
}

/** Public lobby listing: no hands, no tokens. */
export function roomSummary(room: RoomState, now: number): RoomSummary {
  const seated = room.seats.filter((p): p is RoomPlayer => !!p);
  return {
    code: room.code,
    status: room.game?.status === "playing" ? "playing" : "waiting",
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points ?? 0 })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

/** A room is worth listing while someone is still around. */
export const isRoomActive = (room: RoomState, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
