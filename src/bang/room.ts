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
import { DEFAULT_RANK_POINTS, checkRankPoints, scoreByRank } from "../game/scoring";
import {
  DEFAULT_RESPOND_SECONDS,
  DEFAULT_TURN_SECONDS,
  EXPANSIONS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RESPOND_SECONDS_OPTIONS,
  TURN_SECONDS_OPTIONS,
} from "./cards";
import { abilityList, bangsLeft, buyGear, drawCommand, endTurn, playCard, respond, useAbility, useCard } from "./actions";
import { type BangState, type Result, distance, forfeitPlayer, isInteractive, newBangGame, nextGameTickAt, pickCharacter, present, tickGame, weaponRange } from "./game";
import type { BangCommand, BangGameView, BangRoomSummary, BangRoomView, BangSettings, PromptView } from "./protocol";

/** Room lifecycle for Đấu Súng — same presence / spectator / scoring rules as the other games. */

export interface BangSeat {
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

export interface BangRoom {
  game: "bang";
  code: string;
  hostId: string;
  seats: (BangSeat | null)[];
  current: BangState | null;
  settings?: BangSettings;
  history?: GameRecord[];
  gameSeq?: number;
  spectators?: Spectator[];
  reactions?: Reaction[];
  chat?: ChatMessage[];
}

export const DEFAULT_BANG_SETTINGS: BangSettings = {
  packs: ["dodge"],
  turnSeconds: DEFAULT_TURN_SECONDS,
  respondSeconds: DEFAULT_RESPOND_SECONDS,
  ...DEFAULT_RANK_POINTS,
};
export const bangSettingsOf = (room: BangRoom): BangSettings => ({ ...DEFAULT_BANG_SETTINGS, ...room.settings });

export function newBangRoom(code: string): BangRoom {
  return { game: "bang", code, hostId: "", seats: Array.from({ length: MAX_PLAYERS }, () => null), current: null };
}

export const isOnline = (p: BangSeat, now: number) => !p.left && now - p.lastSeen < PRESENCE_TIMEOUT_MS;
export const findByToken = (room: BangRoom, token: string) => room.seats.find((p) => p?.token === token) ?? null;
const findById = (room: BangRoom, id: string) => room.seats.find((p) => p?.id === id) ?? null;
const inGame = (room: BangRoom, id: string) => room.current?.status !== "ended" && !!room.current?.ps[id];
const nameOf = (room: BangRoom) => (id: string) =>
  findById(room, id)?.name ?? room.history?.flatMap((h) => h.results).find((r) => r.id === id)?.name ?? "?";

export function joinBang(
  room: BangRoom,
  token: string,
  name: string,
  now: number,
  newId: () => string,
): { ok: true; player: BangSeat } | { ok: false; error: string } {
  if (typeof token !== "string" || token.length < 8 || token.length > 128) return { ok: false, error: "Phiên không hợp lệ" };
  let player = findByToken(room, token);
  if (player?.kicked) return { ok: false, error: "Bạn đã bị chủ phòng mời ra khỏi ván này" };
  if (player) {
    if (!inGame(room, player.id)) player.name = cleanName(name);
  } else {
    dropGoneSeats(room, now);
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: `Phòng đã đủ ${MAX_PLAYERS} người` };
    player = { id: newId(), token, name: cleanName(name), lastSeen: now, wins: 0, points: 0, games: 0 };
    room.seats[free] = player;
  }
  player.lastSeen = now;
  delete player.left;
  const host = findById(room, room.hostId);
  if (!host || !isOnline(host, now)) room.hostId = player.id;
  return { ok: true, player };
}

export function bangHeartbeat(room: BangRoom, token: string, now: number) {
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

export function leaveBang(room: BangRoom, token: string, now: number) {
  const p = findByToken(room, token);
  if (!p) {
    room.spectators = (room.spectators ?? []).filter((x) => x.token !== token);
    return;
  }
  p.left = true;
  if (!inGame(room, p.id)) {
    const idx = room.seats.indexOf(p);
    if (idx >= 0) room.seats[idx] = null;
  }
  tickBang(room, now);
}

function startBang(room: BangRoom, host: BangSeat, now: number): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.current && room.current.status !== "ended") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is BangSeat => !!p).map((p) => p.id);
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần ít nhất ${MIN_PLAYERS} người` };
  const st = bangSettingsOf(room);
  room.current = newBangGame(players, now, { packs: st.packs, turnMs: st.turnSeconds * 1000, respondMs: st.respondSeconds * 1000 });
  return { ok: true };
}

function setSettings(room: BangRoom, host: BangSeat, msg: Record<string, unknown>): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới đổi luật" };
  if (room.current && room.current.status !== "ended") return { ok: false, error: "Đổi luật khi ván đã kết thúc" };
  const next = bangSettingsOf(room);
  if (msg.packs !== undefined) {
    if (!Array.isArray(msg.packs) || !msg.packs.every((p) => (EXPANSIONS as string[]).includes(p as string))) return { ok: false, error: "Bộ mở rộng không hợp lệ" };
    next.packs = EXPANSIONS.filter((p) => (msg.packs as string[]).includes(p));
  }
  if (msg.turnSeconds !== undefined) {
    if (!TURN_SECONDS_OPTIONS.includes(msg.turnSeconds as number)) return { ok: false, error: "Thời gian lượt không hợp lệ" };
    next.turnSeconds = msg.turnSeconds as number;
  }
  if (msg.respondSeconds !== undefined) {
    if (!RESPOND_SECONDS_OPTIONS.includes(msg.respondSeconds as number)) return { ok: false, error: "Thời gian trả lời không hợp lệ" };
    next.respondSeconds = msg.respondSeconds as number;
  }
  if (msg.first !== undefined) next.first = msg.first as number;
  if (msg.second !== undefined) next.second = msg.second as number;
  if (next.second > next.first) next.second = next.first;
  const err = checkRankPoints(next.first, next.second);
  if (err) return { ok: false, error: err };
  room.settings = next;
  return { ok: true };
}

function kickBang(room: BangRoom, host: BangSeat, targetId: unknown, now: number): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới kích được người chơi" };
  const target = typeof targetId === "string" ? findById(room, targetId) : null;
  if (!target || target.kicked) return { ok: false, error: "Không tìm thấy người chơi" };
  if (target.id === host.id) return { ok: false, error: "Không thể tự kích mình" };
  if (isOnline(target, now)) return { ok: false, error: "Chỉ kích được người đã mất kết nối" };
  if (room.current && inGame(room, target.id)) {
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

const num = (x: unknown) => (typeof x === "number" && Number.isInteger(x) ? x : undefined);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const nums = (x: unknown) => (Array.isArray(x) && x.every((v) => Number.isInteger(v)) ? (x as number[]) : undefined);
const pickOf = (x: unknown) => {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  if (o.zone === "hand") return { zone: "hand" as const };
  if (o.zone === "play" && Number.isInteger(o.card)) return { zone: "play" as const, card: o.card as number };
  return undefined;
};

export function bangCommand(room: BangRoom, token: string, msg: BangCommand, now: number): Result {
  const p = findByToken(room, token);
  if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
  const m = msg as unknown as Record<string, unknown>;
  if (msg.type === "start") return startBang(room, p, now);
  if (msg.type === "kick") return kickBang(room, p, m.playerId, now);
  if (msg.type === "settings") return setSettings(room, p, m);
  const g = room.current;
  if (!g || g.status === "ended") return { ok: false, error: "Chưa bắt đầu ván" };
  if (!g.ps[p.id]) return { ok: false, error: "Bạn không chơi ván này" };
  const names = nameOf(room);
  let res: Result;
  switch (msg.type) {
    case "pick":
      res = pickCharacter(g, p.id, m.char, now, names);
      break;
    case "draw":
      res = drawCommand(g, p.id, str(m.mode) as never, { target: str(m.target), targets: Array.isArray(m.targets) ? (m.targets as unknown[]).filter((x): x is string => typeof x === "string") : undefined, card: num(m.card), color: m.color === "red" || m.color === "black" ? m.color : undefined, swap: m.swap === true, blood: str(m.blood) }, now, names);
      break;
    case "play": {
      const card = num(m.card);
      if (card === undefined) return { ok: false, error: "Lá không hợp lệ" };
      res = playCard(g, p.id, { card, target: str(m.target), target2: str(m.target2), pick: pickOf(m.pick), extra: nums(m.extra), as: m.as === "bang" ? "bang" : undefined, mode: str(m.mode) }, now, names);
      break;
    }
    case "use": {
      const card = num(m.card);
      if (card === undefined) return { ok: false, error: "Lá không hợp lệ" };
      res = useCard(g, p.id, { card, target: str(m.target), pick: pickOf(m.pick) }, now, names);
      break;
    }
    case "ability":
      res = useAbility(g, p.id, { name: str(m.name) ?? "", target: str(m.target), cards: nums(m.cards), card: num(m.card), pick: pickOf(m.pick) }, now, names);
      break;
    case "buy": {
      const slot = num(m.slot);
      if (slot === undefined) return { ok: false, error: "Món không hợp lệ" };
      res = buyGear(g, p.id, { slot, target: str(m.target), pick: pickOf(m.pick), mode: str(m.mode) }, now, names);
      break;
    }
    case "respond":
      res = respond(g, p.id, { cards: nums(m.cards), take: m.take === true, card: num(m.card), choice: str(m.choice) }, now, names);
      break;
    case "end":
      res = endTurn(g, p.id, { discard: nums(m.discard) }, now, names);
      break;
    default:
      return { ok: false, error: "Lệnh không hợp lệ" };
  }
  if (res.ok) afterChange(room, now);
  return res;
}

/** Record a game that just ended (points, history). */
function afterChange(room: BangRoom, now: number) {
  const g = room.current;
  if (!g || g.status !== "ended" || g.recorded) return;
  g.recorded = true;
  const deltas = scoreByRank(g.finished, bangSettingsOf(room));
  room.gameSeq = (room.gameSeq ?? 0) + 1;
  const record: GameRecord = {
    id: `${room.code}-${room.gameSeq}`,
    at: now,
    instantWin: null,
    results: g.finished.map((id, rank) => {
      const p = findById(room, id);
      const won = g.winners.includes(id);
      if (p) {
        p.points += deltas[id] ?? 0;
        p.games += 1;
        if (won) p.wins += 1;
      }
      return { id, name: p?.name ?? "?", rank, delta: deltas[id] ?? 0 };
    }),
  };
  room.history = [...(room.history ?? []), record].slice(-HISTORY_LIMIT);
}

export function tickBang(room: BangRoom, now: number): boolean {
  let changed = false;
  const g = room.current;
  if (g && g.status !== "ended") {
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
  if ((!room.current || room.current.status === "ended") && dropGoneSeats(room, now)) changed = true;
  if (pruneSpectators(room, now)) changed = true;
  if (pruneReactions(room, now)) changed = true;
  return changed;
}

export function nextBangTickAt(room: BangRoom, now: number): number | null {
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

function dropGoneSeats(room: BangRoom, now: number): boolean {
  let dropped = false;
  room.seats = room.seats.map((p) => {
    if (p && (p.left || now - p.lastSeen > SEAT_GRACE_MS) && !inGame(room, p.id)) {
      dropped = true;
      return null;
    }
    return p;
  });
  return dropped;
}

function promptView(g: BangState, me: string | null): PromptView | null {
  const q = g.queue[0];
  if (!q || !isInteractive(q)) return null;
  switch (q.kind) {
    case "react":
      return { kind: "react", to: q.to, from: q.from, answer: q.answer, cause: q.cause, need: q.need, dmg: q.dmg, deadline: q.deadline };
    case "save":
      return { kind: "save", to: q.to, target: q.target, amount: q.amount, deadline: q.deadline };
    case "store":
      return { kind: "store", to: q.to, cards: q.cards, deadline: q.deadline };
    case "pick":
      return { kind: "pick", to: q.to, from: q.from, mode: q.mode, cause: q.cause, deadline: q.deadline };
    case "keep":
      return { kind: "keep", to: q.to, keep: q.keep, count: q.cards.length, cause: q.cause, deadline: q.deadline, ...(me === q.to ? { cards: q.cards } : {}) };
    case "discard":
      return { kind: "discard", to: q.to, count: q.count, orLose: q.orLose, cause: q.cause, deadline: q.deadline };
    case "copy":
      return { kind: "copy", to: q.to, options: q.options, deadline: q.deadline };
    case "draw":
      return { kind: "draw", to: q.to, options: q.options, swap: q.swap, blood: q.blood, deadline: q.deadline };
  }
}

function gameView(g: BangState, me: string | null): BangGameView {
  const ended = g.status === "ended";
  const open = g.event === "sacagaway";
  const meIn = !!me && !!g.ps[me];
  return {
    status: g.status,
    picking: me && g.picks[me] ? g.picks[me] : [],
    picked: g.order.filter((id) => !g.picks[id]),
    players: g.order.map((id) => {
      const p = g.ps[id];
      const self = id === me;
      const roleKnown = ended || self || p.dead || p.role === "sheriff";
      const picking = g.status === "picking";
      return {
        id,
        char: picking && g.picks[id] ? null : p.char,
        life: p.life,
        max: p.max,
        role: roleKnown ? p.role : null,
        handCount: p.hand.length,
        hand: self || open || ended ? p.hand : null,
        play: p.play.map((c) => ({ id: c.id, ...(c.cubes ? { cubes: c.cubes } : {}), ...(c.fresh ? { fresh: true } : {}) })),
        gear: p.gear.map((x) => ({ key: x.key, ...(x.from ? { from: x.from } : {}) })),
        gold: p.gold,
        cubes: p.cubes,
        dead: p.dead,
        ghost: !!p.ghost || !!p.townGhost,
        borrowed: p.borrowed ?? [],
        dist: meIn && !self && present(g, id) && present(g, me!) && g.status === "playing" ? distance(g, me!, id) : null,
      };
    }),
    turn: g.turn?.player ?? null,
    step: g.turn?.step ?? null,
    bangsLeft: meIn ? bangsLeft(g, me!) : 0,
    range: meIn && g.status === "playing" ? weaponRange(g, me!) : 1,
    deadline: g.deadline,
    prompt: promptView(g, me),
    queued: Math.max(0, g.queue.filter(isInteractive).length - 1),
    deckCount: g.deck.length,
    discardTop: g.discard.length ? g.discard[g.discard.length - 1] : null,
    discardCount: g.discard.length,
    event: g.event,
    eventsLeft: g.events.length,
    shop: g.shop,
    shopDeck: g.shopDeck.length,
    winners: g.winners,
    finished: g.finished,
    last: g.last,
    log: g.log,
  };
}

export function bangView(room: BangRoom, player: BangSeat | null, now: number): BangRoomView {
  const g = room.current;
  return {
    game: "bang",
    code: room.code,
    meId: player?.id ?? "",
    role: player ? "player" : "spectator",
    serverTime: now,
    settings: bangSettingsOf(room),
    seats: room.seats.map((p) =>
      p
        ? {
            id: p.id,
            name: p.name,
            connected: isOnline(p, now),
            isHost: room.hostId === p.id,
            inGame: !!g?.ps[p.id] && g.status !== "ended",
            kicked: !!p.kicked,
            points: p.points,
            games: p.games,
            wins: p.wins,
          }
        : null,
    ),
    current: g ? gameView(g, player?.id ?? null) : null,
    ...(g && player && g.ps[player.id] ? { abilities: abilityList(g, player.id) } : {}),
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
    chat: room.chat ?? [],
  };
}

export function bangSummary(room: BangRoom, now: number): BangRoomSummary {
  const seated = room.seats.filter((p): p is BangSeat => !!p);
  return {
    code: room.code,
    status: room.current && room.current.status !== "ended" ? "playing" : "waiting",
    packs: bangSettingsOf(room).packs,
    players: seated.map((p) => ({ name: p.name, connected: isOnline(p, now), points: p.points })),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).length,
    games: room.gameSeq ?? 0,
  };
}

export const isBangActive = (room: BangRoom, now: number) =>
  room.seats.some((p) => !!p && isOnline(p, now)) || (room.spectators ?? []).some((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS);
