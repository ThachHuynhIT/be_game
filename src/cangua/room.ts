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
import { type CNState, DEFAULT_RULES, type Random, type Result, forfeitPlayer, moveHorse, newCNGame, nextGameTickAt, rollDie, tickGame } from "./game";
import type { CNCommand, CNRoomSummary, CNRoomView, CNSettings } from "./protocol";

/** Room lifecycle for Cờ Cá Ngựa — same presence / spectator / scoring rules as the other games. */

export interface CNPlayer {
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

export interface CNRoom {
  game: "cangua";
  code: string;
  hostId: string;
  seats: (CNPlayer | null)[];
  /** Seats freed while their player was away (see `rememberGone` in game/room.ts). */
  gone?: GoneSeat[];
  current: CNState | null;
  settings?: CNSettings;
  history?: GameRecord[];
  gameSeq?: number;
  spectators?: Spectator[];
  reactions?: Reaction[];
  chat?: ChatMessage[];
}

export const DEFAULT_CN_SETTINGS: CNSettings = { ...DEFAULT_RULES, turnSeconds: DEFAULT_TURN_SECONDS, ...DEFAULT_RANK_POINTS };
export const cnSettingsOf = (room: CNRoom): CNSettings => ({ ...DEFAULT_CN_SETTINGS, ...room.settings });

export function newCNRoom(code: string): CNRoom {
  return { game: "cangua", code, hostId: "", seats: Array.from({ length: MAX_PLAYERS }, () => null), current: null };
}

export const isOnline = (p: CNPlayer, now: number) => !p.left && now - p.lastSeen < PRESENCE_TIMEOUT_MS;
export const findByToken = (room: CNRoom, token: string) => room.seats.find((p) => p?.token === token) ?? null;
const findById = (room: CNRoom, id: string) => room.seats.find((p) => p?.id === id) ?? null;
const inPlayingGame = (room: CNRoom, id: string) => room.current?.status === "playing" && room.current.players.includes(id);
const nameOf = (room: CNRoom) => (id: string) =>
  findById(room, id)?.name ?? room.history?.flatMap((h) => h.results).find((r) => r.id === id)?.name ?? "?";

export function joinCN(
  room: CNRoom,
  token: string,
  name: string,
  now: number,
  newId: () => string,
): { ok: true; player: CNPlayer } | { ok: false; error: string } {
  if (typeof token !== "string" || token.length < 8 || token.length > 128) return { ok: false, error: "Phiên không hợp lệ" };
  let player = findReturning(room, token, name, now);
  if (player?.kicked) return { ok: false, error: "Bạn đã bị chủ phòng mời ra khỏi ván này" };
  if (player) {
    if (!inPlayingGame(room, player.id)) player.name = cleanName(name);
  } else {
    dropGoneSeats(room, now);
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: `Phòng đã đủ ${MAX_PLAYERS} người` };
    player = seatFor(takeGone(room, token, name, now), token, name, now, newId);
    room.seats[free] = player;
  }
  player.lastSeen = now;
  delete player.left;
  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) room.hostId = player.id;
  return { ok: true, player };
}

export function cnHeartbeat(room: CNRoom, token: string, now: number) {
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

export function leaveCN(room: CNRoom, token: string, now: number) {
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
  tickCN(room, now);
}

function startCN(room: CNRoom, host: CNPlayer, now: number): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.current?.status === "playing") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is CNPlayer => !!p).map((p) => p.id);
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần ít nhất ${MIN_PLAYERS} người` };
  const st = cnSettingsOf(room);
  room.current = newCNGame(players, now, {
    rules: { exitOn1: st.exitOn1, noJump: st.noJump, ladder: st.ladder, threeSixes: st.threeSixes, rankAll: st.rankAll },
    turnMs: st.turnSeconds * 1000,
  });
  return { ok: true };
}

const FLAGS = ["exitOn1", "noJump", "ladder", "threeSixes", "rankAll"] as const;

function setSettings(room: CNRoom, host: CNPlayer, msg: Record<string, unknown>): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới đổi luật" };
  if (room.current?.status === "playing") return { ok: false, error: "Đổi luật khi ván đã kết thúc" };
  const next = cnSettingsOf(room);
  for (const f of FLAGS) {
    if (msg[f] === undefined) continue;
    if (typeof msg[f] !== "boolean") return { ok: false, error: "Luật không hợp lệ" };
    next[f] = msg[f] as boolean;
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

function kickCN(room: CNRoom, host: CNPlayer, targetId: unknown, now: number): Result {
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

export function cnCommand(room: CNRoom, token: string, msg: CNCommand, now: number, random: Random = Math.random): Result {
  const p = findByToken(room, token);
  if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
  if (msg.type === "start") return startCN(room, p, now);
  if (msg.type === "kick") return kickCN(room, p, msg.playerId, now);
  if (msg.type === "settings") return setSettings(room, p, msg as unknown as Record<string, unknown>);
  const g = room.current;
  if (!g) return { ok: false, error: "Chưa bắt đầu ván" };
  if (!g.players.includes(p.id)) return { ok: false, error: "Bạn không chơi ván này" };
  const names = nameOf(room);
  let res: Result;
  switch (msg.type) {
    case "roll":
      res = rollDie(g, p.id, now, names, random);
      break;
    case "move":
      res = moveHorse(g, p.id, msg.horse, now, names);
      break;
    default:
      return { ok: false, error: "Lệnh không hợp lệ" };
  }
  if (res.ok) afterChange(room, now);
  return res;
}

/** Record a game that just ended (points, history). */
function afterChange(room: CNRoom, now: number) {
  const g = room.current;
  if (!g || g.status !== "ended" || g.recorded) return;
  g.recorded = true;
  const deltas = scoreByRank(g.finished, cnSettingsOf(room));
  room.gameSeq = (room.gameSeq ?? 0) + 1;
  const record: GameRecord = {
    id: `${room.code}-${room.gameSeq}-${now}`, // `now` keeps ids unique when a room code is reused later
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

export function tickCN(room: CNRoom, now: number, random: Random = Math.random): boolean {
  let changed = false;
  const g = room.current;
  if (g?.status === "playing") {
    const absent = (id: string) => {
      const p = findById(room, id);
      return !p || !isOnline(p, now);
    };
    if (tickGame(g, now, nameOf(room), absent, random)) {
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

export function nextCNTickAt(room: CNRoom, now: number): number | null {
  const times: number[] = [];
  const g = room.current ? nextGameTickAt(room.current, now) : null;
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

function dropGoneSeats(room: CNRoom, now: number): boolean {
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

export function cnView(room: CNRoom, player: CNPlayer | null, now: number): CNRoomView {
  const g = room.current;
  const all = g ? [...g.players, ...(g.forfeited ?? [])] : [];
  return {
    game: "cangua",
    code: room.code,
    meId: player?.id ?? "",
    role: player ? "player" : "spectator",
    serverTime: now,
    settings: cnSettingsOf(room),
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
          phase: g.phase,
          deadline: g.deadline,
          die: g.die,
          sixes: g.sixes,
          legal: g.legal,
          players: all.map((id) => ({
            id,
            color: g.colors[id],
            horses: g.horses[id],
            done: g.done.includes(id),
            forfeited: !!g.forfeited?.includes(id),
          })),
          finished: g.status === "ended" ? g.finished : g.done,
          roll: g.roll,
          last: g.last,
          log: g.log,
        }
      : null,
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
    chat: room.chat ?? [],
  };
}

export function cnSummary(room: CNRoom, now: number): CNRoomSummary {
  const seated = room.seats.filter((p): p is CNPlayer => !!p);
  return {
    code: room.code,
    status: room.current?.status === "playing" ? "playing" : "waiting",
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

export const isCNActive = (room: CNRoom, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
