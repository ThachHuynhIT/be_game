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
import type { GameRecord, Reaction } from "../game/protocol";
import { scoreGame } from "../game/scoring";
import { DEFAULT_START_CASH, DEFAULT_TIME_LIMIT, MAX_SEATS, MIN_PLAYERS, START_CASH_OPTIONS, TIME_LIMIT_OPTIONS } from "./board";
import {
  type Result,
  type TPState,
  answerTrade,
  build,
  buySquare,
  declareBankrupt,
  endTurn,
  forfeitPlayer,
  mortgage,
  netWorth,
  newTPGame,
  nextGameTickAt,
  payDebt,
  payJail,
  proposeTrade,
  rollDice,
  sellHouse,
  skipBuy,
  tickGame,
  unmortgage,
} from "./game";
import type { TPCommand, TPRoomSummary, TPRoomView, TPSettings } from "./protocol";

/** Room lifecycle for Cờ Tỷ Phú — same presence / spectator / scoring rules as the other games. */

export interface TPPlayer {
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

export interface TPRoom {
  game: "typhu";
  code: string;
  hostId: string;
  seats: (TPPlayer | null)[];
  current: TPState | null;
  settings: TPSettings;
  history?: GameRecord[];
  gameSeq?: number;
  spectators?: Spectator[];
  reactions?: Reaction[];
}

export function newTPRoom(code: string): TPRoom {
  return {
    game: "typhu",
    code,
    hostId: "",
    seats: Array.from({ length: MAX_SEATS }, () => null),
    current: null,
    settings: { startCash: DEFAULT_START_CASH, timeLimit: DEFAULT_TIME_LIMIT },
  };
}

export const isOnline = (p: TPPlayer, now: number) => !p.left && now - p.lastSeen < PRESENCE_TIMEOUT_MS;
export const findByToken = (room: TPRoom, token: string) => room.seats.find((p) => p?.token === token) ?? null;
const findById = (room: TPRoom, id: string) => room.seats.find((p) => p?.id === id) ?? null;
const inPlayingGame = (room: TPRoom, id: string) =>
  room.current?.status === "playing" && !!room.current.ps[id] && !room.current.ps[id].bankrupt;
const nameOf = (room: TPRoom) => (id: string) =>
  findById(room, id)?.name ?? room.history?.flatMap((h) => h.results).find((r) => r.id === id)?.name ?? "?";

export function joinTP(
  room: TPRoom,
  token: string,
  name: string,
  now: number,
  newId: () => string,
): { ok: true; player: TPPlayer } | { ok: false; error: string } {
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

export function tpHeartbeat(room: TPRoom, token: string, now: number) {
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

export function leaveTP(room: TPRoom, token: string, now: number) {
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
  tickTP(room, now);
}

function startTP(room: TPRoom, host: TPPlayer, now: number): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.current?.status === "playing") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is TPPlayer => !!p).map((p) => p.id);
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần ít nhất ${MIN_PLAYERS} người` };
  room.current = newTPGame(players, now, { startCash: room.settings.startCash, timeLimitMin: room.settings.timeLimit });
  return { ok: true };
}

function setSettings(room: TPRoom, host: TPPlayer, msg: { startCash?: unknown; timeLimit?: unknown }): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới đổi luật" };
  if (room.current?.status === "playing") return { ok: false, error: "Đổi luật khi ván đã kết thúc" };
  if (msg.startCash !== undefined) {
    if (!START_CASH_OPTIONS.includes(msg.startCash as number)) return { ok: false, error: "Tiền khởi đầu không hợp lệ" };
    room.settings.startCash = msg.startCash as number;
  }
  if (msg.timeLimit !== undefined) {
    if (!TIME_LIMIT_OPTIONS.includes(msg.timeLimit as number)) return { ok: false, error: "Thời gian không hợp lệ" };
    room.settings.timeLimit = msg.timeLimit as number;
  }
  return { ok: true };
}

function kickTP(room: TPRoom, host: TPPlayer, targetId: unknown, now: number): Result {
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

const posOf = (msg: TPCommand) => ("pos" in msg && Number.isInteger(msg.pos) ? msg.pos : -1);

export function tpCommand(room: TPRoom, token: string, msg: TPCommand, now: number): Result {
  const p = findByToken(room, token);
  if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
  if (msg.type === "start") return startTP(room, p, now);
  if (msg.type === "kick") return kickTP(room, p, msg.playerId, now);
  if (msg.type === "settings") return setSettings(room, p, msg);
  const g = room.current;
  if (!g) return { ok: false, error: "Chưa bắt đầu ván" };
  if (!g.ps[p.id]) return { ok: false, error: "Bạn không chơi ván này" };
  const names = nameOf(room);
  let res: Result;
  switch (msg.type) {
    case "roll":
      res = rollDice(g, p.id, now, names);
      break;
    case "buy":
      res = buySquare(g, p.id, now, names);
      break;
    case "skip":
      res = skipBuy(g, p.id, now, names);
      break;
    case "end":
      res = endTurn(g, p.id, now, names);
      break;
    case "payjail":
      res = payJail(g, p.id, false, now, names);
      break;
    case "jailcard":
      res = payJail(g, p.id, true, now, names);
      break;
    case "paydebt":
      res = payDebt(g, p.id, now, names);
      break;
    case "bankrupt":
      res = declareBankrupt(g, p.id, now, names);
      break;
    case "build":
      res = build(g, p.id, posOf(msg), now, names);
      break;
    case "sell":
      res = sellHouse(g, p.id, posOf(msg), now, names);
      break;
    case "mortgage":
      res = mortgage(g, p.id, posOf(msg), now, names);
      break;
    case "unmortgage":
      res = unmortgage(g, p.id, posOf(msg), now, names);
      break;
    case "trade":
      res = proposeTrade(g, p.id, msg, now, names);
      break;
    case "tradeanswer":
      res = answerTrade(g, p.id, msg.accept === true, now, names);
      break;
    default:
      return { ok: false, error: "Lệnh không hợp lệ" };
  }
  if (!res.ok) return res;
  // Raised enough while in debt → settle it straight away.
  if ((msg.type === "sell" || msg.type === "mortgage") && g.phase === "debt" && g.debt && g.ps[p.id].cash >= g.debt.amount) {
    payDebt(g, p.id, now, names);
  }
  afterChange(room, now);
  return res;
}

/** Record a game that just ended (points, history). */
function afterChange(room: TPRoom, now: number) {
  const g = room.current;
  if (!g || g.status !== "ended" || g.recorded) return;
  g.recorded = true;
  const deltas = scoreGame(g.finished, null);
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

export function tickTP(room: TPRoom, now: number): boolean {
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

export function nextTPTickAt(room: TPRoom, now: number): number | null {
  const times: number[] = [];
  const g = room.current ? nextGameTickAt(room.current, now) : null;
  if (g) times.push(g);
  for (const p of room.seats) {
    if (!p || p.left) continue;
    times.push(isOnline(p, now) ? p.lastSeen + PRESENCE_TIMEOUT_MS : p.lastSeen + SEAT_GRACE_MS + 1);
  }
  for (const x of room.spectators ?? []) times.push(x.lastSeen + PRESENCE_TIMEOUT_MS);
  for (const r of room.reactions ?? []) times.push(r.at + REACTION_TTL_MS);
  return times.length ? Math.min(...times) : null;
}

function dropGoneSeats(room: TPRoom, now: number): boolean {
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

export function tpView(room: TPRoom, player: TPPlayer | null, now: number): TPRoomView {
  const g = room.current;
  return {
    game: "typhu",
    code: room.code,
    meId: player?.id ?? "",
    role: player ? "player" : "spectator",
    serverTime: now,
    settings: room.settings,
    seats: room.seats.map((p, i) =>
      p
        ? {
            id: p.id,
            name: p.name,
            connected: isOnline(p, now),
            isHost: room.hostId === p.id,
            inGame: !!g?.ps[p.id],
            kicked: !!p.kicked,
            points: p.points,
            games: p.games,
            wins: p.wins,
            color: i,
          }
        : null,
    ),
    current: g
      ? {
          status: g.status,
          players: g.players.map((id) => ({
            id,
            pos: g.ps[id].pos,
            cash: g.ps[id].cash,
            jail: g.ps[id].jail,
            jailCards: g.ps[id].jailCards.length,
            bankrupt: g.ps[id].bankrupt,
            netWorth: netWorth(g, id),
          })),
          deeds: g.deeds,
          turn: g.turn,
          phase: g.phase,
          deadline: g.deadline,
          dice: g.dice,
          rollAgain: g.rollAgain,
          debt: g.debt ? { amount: g.debt.amount, to: g.debt.to, reason: g.debt.reason } : null,
          trade: g.trade,
          lastCard: g.lastCard,
          finished: g.finished,
          endsAt: g.endsAt,
          log: g.log,
        }
      : null,
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
  };
}

export function tpSummary(room: TPRoom, now: number): TPRoomSummary {
  const seated = room.seats.filter((p): p is TPPlayer => !!p);
  return {
    code: room.code,
    status: room.current?.status === "playing" ? "playing" : "waiting",
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

export const isTPActive = (room: TPRoom, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
