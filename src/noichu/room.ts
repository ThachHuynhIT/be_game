import {
  HEARTBEAT_WRITE_MS,
  HISTORY_LIMIT,
  PRESENCE_TIMEOUT_MS,
  REACTION_TTL_MS,
  SEAT_GRACE_MS,
  type GoneSeat,
  type Spectator,
  cleanName,
  findReturning,
  pruneReactions,
  pruneSpectators,
  rememberGone,
  seatFor,
  takeGone,
} from "../game/room";
import type { ChatMessage, GameRecord, Reaction } from "../game/protocol";
import { DEFAULT_RANK_POINTS, checkRankPoints, scoreByRank } from "../game/scoring";
import { DEFAULT_TURN_SECONDS, MAX_PLAYERS, MIN_PLAYERS, TURN_SECONDS_OPTIONS } from "./board";
import { type NCState, type Random, type Result, forfeitPlayer, needOf, newNCGame, nextGameTickAt, playWord, tickGame } from "./game";
import { CHAIN_VIEW_LIMIT, type NCCommand, type NCRoomSummary, type NCRoomView, type NCSettings } from "./protocol";

/** Room lifecycle for Nối Chữ — same presence / spectator / scoring rules as the other games. */

export interface NCPlayer {
  id: string;
  token: string;
  uid?: string;
  name: string;
  lastSeen: number;
  left?: boolean;
  kicked?: boolean;
  wins: number;
  points: number;
  games: number;
}

export interface NCRoom {
  game: "noichu";
  code: string;
  hostId: string;
  seats: (NCPlayer | null)[];
  /** Seats freed while their player was away (see `rememberGone` in game/room.ts). */
  gone?: GoneSeat[];
  current: NCState | null;
  settings?: NCSettings;
  history?: GameRecord[];
  gameSeq?: number;
  spectators?: Spectator[];
  reactions?: Reaction[];
  chat?: ChatMessage[];
}

export const DEFAULT_NC_SETTINGS: NCSettings = {
  turnSeconds: DEFAULT_TURN_SECONDS,
  dictionary: true,
  ...DEFAULT_RANK_POINTS,
};
export const ncSettingsOf = (room: NCRoom): NCSettings => ({ ...DEFAULT_NC_SETTINGS, ...room.settings });

export function newNCRoom(code: string): NCRoom {
  return { game: "noichu", code, hostId: "", seats: Array.from({ length: MAX_PLAYERS }, () => null), current: null };
}

export const isOnline = (p: NCPlayer, now: number) => !p.left && now - p.lastSeen < PRESENCE_TIMEOUT_MS;
export const findByToken = (room: NCRoom, token: string) => room.seats.find((p) => p?.token === token) ?? null;
const findById = (room: NCRoom, id: string) => room.seats.find((p) => p?.id === id) ?? null;
const inPlayingGame = (room: NCRoom, id: string) => room.current?.status === "playing" && room.current.players.includes(id);
const nameOf = (room: NCRoom) => (id: string) =>
  findById(room, id)?.name ?? room.history?.flatMap((h) => h.results).find((r) => r.id === id)?.name ?? "?";

export function joinNC(
  room: NCRoom,
  token: string,
  name: string,
  now: number,
  newId: () => string,
  uid: string,
): { ok: true; player: NCPlayer } | { ok: false; error: string } {
  if (typeof token !== "string" || token.length < 8 || token.length > 128) return { ok: false, error: "Phiên không hợp lệ" };
  let player = findReturning(room, token, name, now, uid);
  if (player?.kicked) return { ok: false, error: "Bạn đã bị chủ phòng mời ra khỏi ván này" };
  if (player) {
    if (!inPlayingGame(room, player.id)) { player.name = cleanName(name); player.uid = uid; }
  } else {
    dropGoneSeats(room, now);
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: `Phòng đã đủ ${MAX_PLAYERS} người` };
    player = seatFor(takeGone(room, token, name, now, uid), token, name, now, newId, uid);
    room.seats[free] = player;
  }
  player.lastSeen = now;
  delete player.left;
  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) room.hostId = player.id;
  return { ok: true, player };
}

export function ncHeartbeat(room: NCRoom, token: string, now: number) {
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

export function leaveNC(room: NCRoom, token: string, now: number) {
  const p = findByToken(room, token);
  if (!p) {
    room.spectators = (room.spectators ?? []).filter((x) => x.token !== token);
    return;
  }
  p.left = true;
  if (!inPlayingGame(room, p.id)) {
    const idx = room.seats.indexOf(p);
    if (idx >= 0) room.seats[idx] = null;
    rememberGone(room, p, now);
  }
  tickNC(room, now);
}

function startNC(room: NCRoom, host: NCPlayer, now: number, random: Random): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.current?.status === "playing") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is NCPlayer => !!p).map((p) => p.id);
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần đủ ${MIN_PLAYERS} người` };
  const st = ncSettingsOf(room);
  room.current = newNCGame(players, now, { turnMs: st.turnSeconds * 1000, dictionary: st.dictionary }, random);
  return { ok: true };
}

function setSettings(room: NCRoom, host: NCPlayer, msg: Record<string, unknown>): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới đổi luật" };
  if (room.current?.status === "playing") return { ok: false, error: "Đổi luật khi ván đã kết thúc" };
  const next = ncSettingsOf(room);
  if (msg.dictionary !== undefined) {
    if (typeof msg.dictionary !== "boolean") return { ok: false, error: "Luật từ điển không hợp lệ" };
    next.dictionary = msg.dictionary;
  }
  if (msg.turnSeconds !== undefined) {
    if (!TURN_SECONDS_OPTIONS.includes(msg.turnSeconds as number)) return { ok: false, error: "Thời gian lượt không hợp lệ" };
    next.turnSeconds = msg.turnSeconds as number;
  }
  if (msg.first !== undefined) next.first = msg.first as number;
  if (msg.second !== undefined) next.second = msg.second as number;
  const err = checkRankPoints(next.first, next.second);
  if (err) return { ok: false, error: err };
  room.settings = next;
  return { ok: true };
}

function kickNC(room: NCRoom, host: NCPlayer, targetId: unknown, now: number): Result {
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

export function ncCommand(room: NCRoom, token: string, msg: NCCommand, now: number, random: Random = Math.random): Result {
  const p = findByToken(room, token);
  if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
  if (msg.type === "start") return startNC(room, p, now, random);
  if (msg.type === "kick") return kickNC(room, p, msg.playerId, now);
  if (msg.type === "settings") return setSettings(room, p, msg as unknown as Record<string, unknown>);
  const g = room.current;
  if (!g) return { ok: false, error: "Chưa bắt đầu ván" };
  if (!g.players.includes(p.id)) return { ok: false, error: "Bạn không chơi ván này" };
  if (msg.type !== "word") return { ok: false, error: "Lệnh không hợp lệ" };
  const res = playWord(g, p.id, msg.text, now, nameOf(room));
  if (res.ok) afterChange(room, now);
  return res;
}

/**
 * Rank points by finishing order (`scoreByRank`); players tied on a rank share the average of the points of the
 * places they occupy, rounded down, so a two-player draw scores 0 for both and rounding never creates points
 * (truncating toward zero would: two tied last places worth −1 and −2 would each pay only 1).
 */
export function ncDeltas(finished: string[], ranks: Record<string, number>, settings: NCSettings): Record<string, number> {
  const table = scoreByRank(finished, settings);
  const deltas: Record<string, number> = {};
  for (const id of finished) {
    const group = finished.filter((x) => ranks[x] === ranks[id]);
    deltas[id] = group.length === 1 ? table[id] : Math.floor(group.reduce((t, x) => t + table[x], 0) / group.length) || 0;
  }
  return deltas;
}

/** Record a game that just ended (points, history). */
function afterChange(room: NCRoom, now: number) {
  const g = room.current;
  if (!g || g.status !== "ended" || g.recorded) return;
  g.recorded = true;
  const deltas = ncDeltas(g.finished, g.ranks, ncSettingsOf(room));
  const firsts = g.finished.filter((id) => g.ranks[id] === 0).length;
  room.gameSeq = (room.gameSeq ?? 0) + 1;
  const record: GameRecord = {
    id: `${room.code}-${room.gameSeq}-${now}`, // `now` keeps ids unique when a room code is reused later
    at: now,
    instantWin: null,
    results: g.finished.map((id) => {
      const p = findById(room, id);
      const rank = g.ranks[id] ?? 0;
      if (p) {
        p.points += deltas[id];
        p.games += 1;
        if (rank === 0 && firsts === 1) p.wins += 1;
      }
      return { id, name: p?.name ?? "?", rank, delta: deltas[id] };
    }),
  };
  room.history = [...(room.history ?? []), record].slice(-HISTORY_LIMIT);
}

export function tickNC(room: NCRoom, now: number): boolean {
  let changed = false;
  const g = room.current;
  if (g?.status === "playing") {
    if (tickGame(g, now, nameOf(room))) {
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

export function nextNCTickAt(room: NCRoom, now: number): number | null {
  const times: number[] = [];
  const g = room.current ? nextGameTickAt(room.current) : null;
  if (g) times.push(g);
  for (const p of room.seats) {
    if (!p || p.left) continue;
    if (isOnline(p, now)) times.push(p.lastSeen + PRESENCE_TIMEOUT_MS);
    // Past the grace period an offline seat is only freed between games; mid-game there is nothing to wake up
    // for, and a time already past would re-run `tick` every 100 ms and re-send every view.
    else if (p.lastSeen + SEAT_GRACE_MS + 1 > now || room.current?.status !== "playing") times.push(p.lastSeen + SEAT_GRACE_MS + 1);
  }
  for (const x of room.spectators ?? []) times.push(x.lastSeen + PRESENCE_TIMEOUT_MS);
  for (const r of room.reactions ?? []) times.push(r.at + REACTION_TTL_MS);
  return times.length ? Math.min(...times) : null;
}

function dropGoneSeats(room: NCRoom, now: number): boolean {
  let dropped = false;
  room.seats = room.seats.map((p) => {
    if (p && (p.left || now - p.lastSeen > SEAT_GRACE_MS) && !inPlayingGame(room, p.id)) {
      dropped = true;
      rememberGone(room, p, now);
      return null;
    }
    return p;
  });
  return dropped;
}

export function ncView(room: NCRoom, player: NCPlayer | null, now: number): NCRoomView {
  const g = room.current;
  return {
    game: "noichu",
    code: room.code,
    meId: player?.id ?? "",
    role: player ? "player" : "spectator",
    serverTime: now,
    settings: ncSettingsOf(room),
    seats: room.seats.map((p) =>
      p
        ? {
            id: p.id,
            name: p.name,
            connected: isOnline(p, now),
            isHost: room.hostId === p.id,
            inGame: !!g?.players.includes(p.id),
            kicked: !!p.kicked,
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
          deadline: g.deadline,
          need: g.status === "playing" ? needOf(g) : null,
          dictionary: g.dictionary !== false,
          players: g.players.map((id, seat) => ({
            id,
            seat,
            words: g.counts[id] ?? 0,
            out: g.out.includes(id),
            rank: g.status === "ended" ? (g.ranks[id] ?? null) : null,
          })),
          chain: g.chain.slice(-CHAIN_VIEW_LIMIT),
          chainLength: g.chain.length,
          finished: g.finished,
          winner: g.winner,
          endReason: g.endReason,
          log: g.log,
        }
      : null,
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
    chat: room.chat ?? [],
  };
}

export function ncSummary(room: NCRoom, now: number): NCRoomSummary {
  const seated = room.seats.filter((p): p is NCPlayer => !!p);
  return {
    code: room.code,
    status: room.current?.status === "playing" ? "playing" : "waiting",
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

export const isNCActive = (room: NCRoom, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
