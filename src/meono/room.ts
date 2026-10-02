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
import { type Expansion, type MCard, MAX_SEATS, MIN_PLAYERS, PRESET_BY_ID, cleanExpansions, maxPlayers } from "./cards";
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
  digCard,
  digDeeper,
  playClairvoyance,
  playNope,
  syncCurse,
  tickGame,
  unblind,
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
  /** A PRESETS id, or "custom" to play the packs the host ticked. */
  preset: string;
  /** Seconds per turn before the server draws for you. */
  turnSeconds: number;
  /** Seconds everyone gets to answer an action with “Không!”. */
  nopeSeconds: number;
}

export const TURN_SECONDS_OPTIONS = [15, 20, 30, 45, 60];
export const NOPE_SECONDS_OPTIONS = [3.5, 5, 7, 10];
export const DEFAULT_MEO_SETTINGS: MeoSettings = { preset: "classic", turnSeconds: 30, nopeSeconds: 7, ...DEFAULT_RANK_POINTS };
/** Packs actually dealt: the preset's, or the ticked ones for "custom". */
export const packsInPlay = (room: MeoRoom): Expansion[] => {
  const preset = PRESET_BY_ID[meoSettingsOf(room).preset];
  return preset ? preset.packs : cleanExpansions(room.expansions ?? []);
};
/** Player counts the chosen preset suits (custom: 2 up to what the packs allow). */
export const playerRange = (room: MeoRoom): [number, number] => {
  const preset = PRESET_BY_ID[meoSettingsOf(room).preset];
  return preset ? [preset.minPlayers, preset.maxPlayers] : [MIN_PLAYERS, maxPlayers(packsInPlay(room))];
};
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
  const expansions = packsInPlay(room);
  const [min, max] = playerRange(room);
  const preset = PRESET_BY_ID[meoSettingsOf(room).preset];
  const label = preset ? `Chế độ ${preset.name}` : "Bộ gói đã chọn";
  if (players.length < min) return { ok: false, error: `${label} cần ít nhất ${min} người` };
  if (players.length > max) return { ok: false, error: `${label} chỉ dành cho tối đa ${max} người` };
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
  if (msg.preset !== undefined) {
    if (msg.preset !== "custom" && !PRESET_BY_ID[msg.preset as string]) return { ok: false, error: "Chế độ không hợp lệ" };
    next.preset = msg.preset as string;
  }
  if (msg.first !== undefined) next.first = msg.first as number;
  if (msg.second !== undefined) next.second = msg.second as number;
  const err = checkRankPoints(next.first, next.second);
  if (err) return { ok: false, error: err };
  if (msg.expansions !== undefined) {
    room.expansions = cleanExpansions(msg.expansions);
    // Ticking packs by hand means a custom mix.
    if (msg.preset === undefined) next.preset = "custom";
  }
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
    case "mplay": {
      // Cursed players pick blind positions; map them back to real card ids.
      const cards = Array.isArray(msg.cards) ? msg.cards.map((c) => unblind(g, p.id, c)) : msg.cards;
      res = playCards(g, p.id, cards, { target: msg.target, named: msg.named }, now, names);
      break;
    }
    case "nope":
      res = playNope(g, p.id, unblind(g, p.id, msg.card), now, names);
      break;
    case "draw":
      res = drawCard(g, p.id, now, names);
      break;
    case "insert":
      res = insertKitten(g, p.id, msg.position, now, names);
      break;
    case "give":
      res = giveCard(g, p.id, unblind(g, p.id, msg.card), now, names);
      break;
    case "dig":
      res = digDeeper(g, p.id, msg.keep === true, now, names);
      break;
    case "see":
      res = playClairvoyance(g, p.id, unblind(g, p.id, msg.card), now, names);
      break;
    case "alter":
      res = alterFuture(g, p.id, msg.order, now, names);
      break;
    default:
      return { ok: false, error: "Lệnh không hợp lệ" };
  }
  syncCurse(g);
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

export function tickMeo(room: MeoRoom, now: number): boolean {
  let changed = false;
  const g = room.current;
  if (g?.status === "playing") {
    const absent = (id: string) => {
      const p = findById(room, id);
      return !p || !isOnline(p, now);
    };
    if (tickGame(g, now, nameOf(room), absent)) {
      syncCurse(g);
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

/** Your hand — face down (blind positions) while you are cursed. */
function handFor(g: MeoState, id: string): MCard[] {
  const annoyed = new Set((g.annoyed ?? []).map((a) => a.card));
  const hand = (g.hands[id] ?? []).map((c) => (annoyed.has(c.id) ? { ...c, annoyed: true } : c));
  if (!g.cursed?.includes(id)) return hand;
  const order = g.curseOrder?.[id] ?? hand.map((c) => c.id);
  return order.map((_, i) => ({ id: -(i + 1), type: "hidden" as unknown as MCard["type"] }));
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
    maxPlayers: playerRange(room)[1],
    minPlayers: playerRange(room)[0],
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
            // Đánh dấu: marked cards are public.
            marked: (g?.hands[p.id] ?? []).filter((c) => c.marked).map((c) => c.type),
            cursed: !!g?.cursed?.includes(p.id),
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
              : g.choice.kind === "offer"
                ? { kind: "offer", mode: g.choice.mode, player: g.choice.player, deadline: g.choice.deadline }
                : { kind: g.choice.kind, player: g.choice.player, deadline: g.choice.deadline, ...(g.choice.kind === "alter" && g.choice.share ? { share: true } : {}) }
            : null,
          claims: g.claims ?? [],
          shuffleLocked: !!g.noShuffle,
          finished: g.finished,
          log: g.log,
          plays: g.plays ?? [],
        }
      : null,
    hand: player && g ? handFor(g, player.id) : [],
    future:
      player && g?.future?.player === player.id
        ? g.future.cards.map((c) => c.type)
        : player && g?.shared?.player === player.id
          ? g.shared.cards.map((c) => c.type)
          : null,
    dig: player && g ? digCard(g, player.id) : null,
    vision: player && g?.visions?.[player.id] && now - g.visions[player.id].at < 90_000 ? g.visions[player.id].text : null,
    sharedBy: player && g?.shared?.player === player.id && !(g.future?.player === player.id) ? "shared" : null,
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
    expansions: packsInPlay(room),
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

export const isMeoActive = (room: MeoRoom, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
