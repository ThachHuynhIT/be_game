import {
  HEARTBEAT_WRITE_MS,
  HISTORY_LIMIT,
  PRESENCE_TIMEOUT_MS,
  REACTION_TTL_MS,
  SEAT_GRACE_MS,
  type Spectator,
  cleanName,
  pruneReactions,
  pruneSpectators,
} from "../game/room";
import type { ChatMessage, GameRecord, Reaction } from "../game/protocol";
import { DEFAULT_RANK_POINTS, type RankPointsSetting, checkRankPoints, scoreByRank } from "../game/scoring";
import { type Expansion, MAX_SEATS, MIN_PLAYERS, cleanExpansions, maxPlayers } from "./cards";
import {
  type MeoState,
  type Result,
  alterFuture,
  drawCard,
  forfeitPlayer,
  giveCard,
  implodingAt,
  insertKitten,
  newMeoGame,
  nextGameTickAt,
  playCards,
  playNope,
  tickGame,
} from "./game";
import type { MeoCommand, MeoRoomSummary, MeoRoomView } from "./protocol";

/** Room lifecycle for Mèo Nổ — same presence / spectator / scoring rules as Tiến Lên. */

export interface MeoPlayer {
  id: string;
  token: string;
  name: string;
  lastSeen: number;
  left?: boolean;
  kicked?: boolean;
  wins: number;
  points: number;
  games: number;
}

export interface MeoRoom {
  game: "meono";
  code: string;
  hostId: string;
  seats: (MeoPlayer | null)[];
  current: MeoState | null;
  /** Packs the host enabled for the next game. */
  expansions?: Expansion[];
  /** Other host settings; missing on older rooms. */
  settings?: MeoSettings;
  history?: GameRecord[];
  gameSeq?: number;
  spectators?: Spectator[];
  reactions?: Reaction[];
  chat?: ChatMessage[];
}

export interface MeoSettings extends RankPointsSetting {
  /** Seconds per turn before the server draws for you. */
  turnSeconds: number;
  /** Seconds everyone gets to answer an action with “Không!”. */
  nopeSeconds: number;
}

export const TURN_SECONDS_OPTIONS = [15, 20, 30, 45, 60];
export const NOPE_SECONDS_OPTIONS = [3.5, 5, 7, 10];
export const DEFAULT_MEO_SETTINGS: MeoSettings = { turnSeconds: 30, nopeSeconds: 7, ...DEFAULT_RANK_POINTS };
export const meoSettingsOf = (room: MeoRoom): MeoSettings => ({ ...DEFAULT_MEO_SETTINGS, ...room.settings });

export function newMeoRoom(code: string): MeoRoom {
  return { game: "meono", code, hostId: "", seats: Array.from({ length: MAX_SEATS }, () => null), current: null, expansions: [] };
}

export const isOnline = (p: MeoPlayer, now: number) => !p.left && now - p.lastSeen < PRESENCE_TIMEOUT_MS;
export const findByToken = (room: MeoRoom, token: string) => room.seats.find((p) => p?.token === token) ?? null;
const findById = (room: MeoRoom, id: string) => room.seats.find((p) => p?.id === id) ?? null;
const inPlayingGame = (room: MeoRoom, id: string) => room.current?.status === "playing" && room.current.players.includes(id);
const nameOf = (room: MeoRoom) => (id: string) => findById(room, id)?.name ?? "?";

export function joinMeo(
  room: MeoRoom,
  token: string,
  name: string,
  now: number,
  newId: () => string,
): { ok: true; player: MeoPlayer } | { ok: false; error: string } {
  if (typeof token !== "string" || token.length < 8 || token.length > 128) return { ok: false, error: "Phiên không hợp lệ" };
  let player = findByToken(room, token);
  if (player?.kicked) return { ok: false, error: "Bạn đã bị chủ phòng mời ra khỏi ván này" };
  if (player) {
    if (!inPlayingGame(room, player.id)) player.name = cleanName(name);
  } else {
    dropGoneSeats(room, now);
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: `Phòng đã đủ ${MAX_SEATS} người` };
    player = { id: newId(), token, name: cleanName(name), lastSeen: now, wins: 0, points: 0, games: 0 };
    room.seats[free] = player;
  }
  player.lastSeen = now;
  delete player.left;
  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) room.hostId = player.id;
  return { ok: true, player };
}

export function meoHeartbeat(room: MeoRoom, token: string, now: number) {
  const p = findByToken(room, token);
  if (p) {
    if (p.kicked || (now - p.lastSeen < HEARTBEAT_WRITE_MS && !p.left)) return;
    p.lastSeen = now;
    delete p.left;
    return;
  }
  const s = room.spectators?.find((x) => x.token === token);
  if (s && now - s.lastSeen >= HEARTBEAT_WRITE_MS) s.lastSeen = now;
}

export function leaveMeo(room: MeoRoom, token: string, now: number) {
  const p = findByToken(room, token);
  if (!p) {
    room.spectators = (room.spectators ?? []).filter((x) => x.token !== token);
    return;
  }
  p.left = true;
  if (!inPlayingGame(room, p.id)) {
    const idx = room.seats.indexOf(p);
    if (idx >= 0) room.seats[idx] = null;
  }
  tickMeo(room, now);
}

function startMeo(room: MeoRoom, host: MeoPlayer, now: number): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.current?.status === "playing") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is MeoPlayer => !!p).map((p) => p.id);
  const expansions = room.expansions ?? [];
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần ít nhất ${MIN_PLAYERS} người` };
  if (players.length > maxPlayers(expansions)) {
    return { ok: false, error: `Bàn cơ bản tối đa ${maxPlayers(expansions)} người — bật gói Mèo Tự Huỷ để chơi 6 người` };
  }
  const settings = meoSettingsOf(room);
  room.current = newMeoGame(players, now, expansions, Math.random, {
    turnMs: settings.turnSeconds * 1000,
    nopeMs: settings.nopeSeconds * 1000,
  });
  return { ok: true };
}

/** Host changes packs / timers / points between games. Only the fields sent are changed. */
function setMeoSettings(room: MeoRoom, host: MeoPlayer, msg: Record<string, unknown>): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới đổi luật" };
  if (room.current?.status === "playing") return { ok: false, error: "Đổi luật khi ván đã kết thúc" };
  const next = meoSettingsOf(room);
  if (msg.turnSeconds !== undefined) {
    if (!TURN_SECONDS_OPTIONS.includes(msg.turnSeconds as number)) return { ok: false, error: "Thời gian lượt không hợp lệ" };
    next.turnSeconds = msg.turnSeconds as number;
  }
  if (msg.nopeSeconds !== undefined) {
    if (!NOPE_SECONDS_OPTIONS.includes(msg.nopeSeconds as number)) return { ok: false, error: "Thời gian “Không!” không hợp lệ" };
    next.nopeSeconds = msg.nopeSeconds as number;
  }
  if (msg.first !== undefined) next.first = msg.first as number;
  if (msg.second !== undefined) next.second = msg.second as number;
  const err = checkRankPoints(next.first, next.second);
  if (err) return { ok: false, error: err };
  if (msg.expansions !== undefined) room.expansions = cleanExpansions(msg.expansions);
  room.settings = next;
  return { ok: true };
}

function kickMeo(room: MeoRoom, host: MeoPlayer, targetId: unknown, now: number): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới kích được người chơi" };
  const target = typeof targetId === "string" ? findById(room, targetId) : null;
  if (!target || target.kicked) return { ok: false, error: "Không tìm thấy người chơi" };
  if (target.id === host.id) return { ok: false, error: "Không thể tự kích mình" };
  if (isOnline(target, now)) return { ok: false, error: "Chỉ kích được người đã mất kết nối" };
  if (room.current && inPlayingGame(room, target.id)) {
    const res = forfeitPlayer(room.current, target.id, now, nameOf(room));
    if (!res.ok) return res;
    target.kicked = true;
    target.left = true;
    afterChange(room, now);
    return { ok: true };
  }
  const idx = room.seats.indexOf(target);
  if (idx >= 0) room.seats[idx] = null;
  return { ok: true };
}

/** Game-specific commands from a seated player. */
export function meoCommand(room: MeoRoom, token: string, msg: MeoCommand, now: number): Result {
  const p = findByToken(room, token);
  if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
  if (msg.type === "start") return startMeo(room, p, now);
  if (msg.type === "kick") return kickMeo(room, p, msg.playerId, now);
  if (msg.type === "settings") return setMeoSettings(room, p, msg as unknown as Record<string, unknown>);
  const g = room.current;
  if (!g) return { ok: false, error: "Chưa bắt đầu ván" };
  const names = nameOf(room);
  let res: Result;
  switch (msg.type) {
    case "mplay":
      res = playCards(g, p.id, msg.cards, { target: msg.target, named: msg.named }, now, names);
      break;
    case "nope":
      res = playNope(g, p.id, msg.card, now, names);
      break;
    case "draw":
      res = drawCard(g, p.id, now, names);
      break;
    case "insert":
      res = insertKitten(g, p.id, msg.position, now, names);
      break;
    case "give":
      res = giveCard(g, p.id, msg.card, now, names);
      break;
    case "alter":
      res = alterFuture(g, p.id, msg.order, now, names);
      break;
    default:
      return { ok: false, error: "Lệnh không hợp lệ" };
  }
  if (res.ok) afterChange(room, now);
  return res;
}

/** Record a game that just ended (points, history). */
function afterChange(room: MeoRoom, now: number) {
  const g = room.current;
  if (!g || g.status !== "ended") return;
  if (g.recorded) return;
  g.recorded = true;
  const settings = meoSettingsOf(room);
  const deltas = scoreByRank(g.finished, settings);
  room.gameSeq = (room.gameSeq ?? 0) + 1;
  const record: GameRecord = {
    id: `${room.code}-${room.gameSeq}`,
    at: now,
    instantWin: null,
    results: g.finished.map((id, rank) => {
      const p = findById(room, id);
      if (p) {
        p.points += deltas[id];
        p.games += 1;
        if (rank === 0) p.wins += 1;
      }
      return { id, name: p?.name ?? "?", rank, delta: deltas[id] };
    }),
  };
  room.history = [...(room.history ?? []), record].slice(-HISTORY_LIMIT);
}

export function tickMeo(room: MeoRoom, now: number): boolean {
  let changed = false;
  const g = room.current;
  if (g?.status === "playing") {
    const absent = (id: string) => {
      const p = findById(room, id);
      return !p || !isOnline(p, now);
    };
    if (tickGame(g, now, nameOf(room), absent)) {
      changed = true;
      afterChange(room, now);
    }
  }
  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) {
    const next = room.seats.find((p) => p && isOnline(p, now));
    if (next && next.id !== room.hostId) {
      room.hostId = next.id;
      changed = true;
    }
  }
  if (room.current?.status !== "playing" && dropGoneSeats(room, now)) changed = true;
  if (pruneSpectators(room, now)) changed = true;
  if (pruneReactions(room, now)) changed = true;
  return changed;
}

export function nextMeoTickAt(room: MeoRoom, now: number): number | null {
  const times: number[] = [];
  const g = room.current ? nextGameTickAt(room.current) : null;
  if (g) times.push(g);
  for (const p of room.seats) {
    if (!p || p.left) continue;
    times.push(isOnline(p, now) ? p.lastSeen + PRESENCE_TIMEOUT_MS : p.lastSeen + SEAT_GRACE_MS + 1);
  }
  for (const x of room.spectators ?? []) times.push(x.lastSeen + PRESENCE_TIMEOUT_MS);
  for (const r of room.reactions ?? []) times.push(r.at + REACTION_TTL_MS);
  return times.length ? Math.min(...times) : null;
}

function dropGoneSeats(room: MeoRoom, now: number): boolean {
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

export function meoView(room: MeoRoom, player: MeoPlayer | null, now: number): MeoRoomView {
  const g = room.current;
  return {
    game: "meono",
    code: room.code,
    meId: player?.id ?? "",
    role: player ? "player" : "spectator",
    serverTime: now,
    expansions: room.expansions ?? [],
    settings: meoSettingsOf(room),
    maxPlayers: maxPlayers(room.expansions ?? []),
    seats: room.seats.map((p) =>
      p
        ? {
            id: p.id,
            name: p.name,
            connected: isOnline(p, now),
            isHost: room.hostId === p.id,
            inGame: !!g?.players.includes(p.id),
            out: !!g?.out.includes(p.id),
            kicked: !!p.kicked,
            cardCount: g?.hands[p.id]?.length ?? 0,
            points: p.points,
            games: p.games,
            wins: p.wins,
          }
        : null,
    ),
    current: g
      ? {
          status: g.status,
          turn: g.turn,
          turnsLeft: g.turnsLeft,
          dir: g.dir ?? 1,
          expansions: g.expansions ?? [],
          implodingAt: implodingAt(g),
          turnDeadline: g.turnDeadline,
          deckCount: g.deck.length,
          discard: g.discard.map((c) => c.type),
          pending: g.pending
            ? { ...g.pending, cards: g.pending.cards.map((c) => c.type) }
            : null,
          choice: g.choice
            ? g.choice.kind === "favor"
              ? { kind: "favor", from: g.choice.from, to: g.choice.to, deadline: g.choice.deadline }
              : { kind: g.choice.kind, player: g.choice.player, deadline: g.choice.deadline }
            : null,
          finished: g.finished,
          log: g.log,
        }
      : null,
    hand: player && g ? (g.hands[player.id] ?? []) : [],
    future: player && g?.future?.player === player.id ? g.future.cards.map((c) => c.type) : null,
    alter: player && g?.choice?.kind === "alter" && g.choice.player === player.id ? g.choice.cards : null,
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
    chat: room.chat ?? [],
  };
}

export function meoSummary(room: MeoRoom, now: number): MeoRoomSummary {
  const seated = room.seats.filter((p): p is MeoPlayer => !!p);
  return {
    code: room.code,
    status: room.current?.status === "playing" ? "playing" : "waiting",
    expansions: room.expansions ?? [],
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

export const isMeoActive = (room: MeoRoom, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
