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
  DEFAULT_START_CASH,
  DEFAULT_TIME_LIMIT,
  GO_SALARY_OPTIONS,
  LAND_SALE_OPTIONS,
  MAP_SIZES,
  MAX_SEATS,
  type MapSize,
  MIN_PLAYERS,
  START_CASH_OPTIONS,
  TIME_LIMIT_OPTIONS,
  UNMORTGAGE_FEE_OPTIONS,
} from "./board";
import {
  type Random,
  type Result,
  type TPState,
  answerLoan,
  answerTrade,
  DEFAULT_TP_RULES,
  build,
  buildBlocker,
  buySquare,
  declareBankrupt,
  endTurn,
  forfeitPlayer,
  mortgage,
  netWorth,
  newTPGame,
  nextGameTickAt,
  payDebt,
  rulesOf,
  payJail,
  proposeLoan,
  proposeTrade,
  rollDice,
  landSalePrice,
  sellBlocker,
  sellHouse,
  sellLand,
  sellLandBlocker,
  skipBuy,
  tickGame,
  unmortgage,
} from "./game";
import { DEFAULT_PIECES, PIECE_COLORS, PIECE_EMOJIS, type TPCommand, type TPRoomSummary, type TPRoomView, type TPSettings } from "./protocol";

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
  /** Picked token (emoji + colour); unset = the seat's starting piece. */
  piece?: { emoji: string; color: string };
  /** Auto-play switched on by the player (Ctrl+Shift+Y): the server plays their turns. Only shown to them. */
  auto?: boolean;
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
  chat?: ChatMessage[];
}

export const STEP_SECONDS_OPTIONS = [15, 20, 30, 45, 60];
export const DEFAULT_TP_SETTINGS: TPSettings = {
  startCash: DEFAULT_START_CASH,
  timeLimit: DEFAULT_TIME_LIMIT,
  stepSeconds: 30,
  doubleGo: false,
  parkingPot: false,
  map: "std",
  ...DEFAULT_RANK_POINTS,
  ...DEFAULT_TP_RULES,
};
/** Rooms saved before a setting existed get its default. */
export const tpSettingsOf = (room: TPRoom): TPSettings => ({ ...DEFAULT_TP_SETTINGS, ...room.settings });

export function newTPRoom(code: string): TPRoom {
  return {
    game: "typhu",
    code,
    hostId: "",
    seats: Array.from({ length: MAX_SEATS }, () => null),
    current: null,
    settings: { ...DEFAULT_TP_SETTINGS },
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
  random: Random = Math.random,
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
  ensureUniquePieces(room, random);
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

export function leaveTP(room: TPRoom, token: string, now: number, random: Random = Math.random) {
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
  tickTP(room, now, random);
}

function startTP(room: TPRoom, host: TPPlayer, now: number, random: Random): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới bắt đầu được" };
  if (room.current?.status === "playing") return { ok: false, error: "Ván đang diễn ra" };
  dropGoneSeats(room, now);
  const players = room.seats.filter((p): p is TPPlayer => !!p).map((p) => p.id);
  if (players.length < MIN_PLAYERS) return { ok: false, error: `Cần ít nhất ${MIN_PLAYERS} người` };
  const st = tpSettingsOf(room);
  room.current = newTPGame(players, now, {
    startCash: st.startCash,
    timeLimitMin: st.timeLimit,
    stepMs: st.stepSeconds * 1000,
    doubleGo: st.doubleGo,
    parkingPot: st.parkingPot,
    map: st.map,
    rules: {
      buildRule: st.buildRule,
      needGroup: st.needGroup,
      sellLand: st.sellLand,
      bankruptTo: st.bankruptTo,
      goSalary: st.goSalary,
      risingCost: st.risingCost,
      unmortgageFee: st.unmortgageFee,
      landSalePct: st.landSalePct,
      jailRent: st.jailRent,
      doubleRoll: st.doubleRoll,
    },
  }, random);
  return { ok: true };
}

function setSettings(room: TPRoom, host: TPPlayer, msg: Record<string, unknown>): Result {
  if (room.hostId !== host.id) return { ok: false, error: "Chỉ chủ phòng mới đổi luật" };
  if (room.current?.status === "playing") return { ok: false, error: "Đổi luật khi ván đã kết thúc" };
  const next = tpSettingsOf(room);
  if (msg.startCash !== undefined) {
    if (!START_CASH_OPTIONS.includes(msg.startCash as number)) return { ok: false, error: "Tiền khởi đầu không hợp lệ" };
    next.startCash = msg.startCash as number;
  }
  if (msg.timeLimit !== undefined) {
    if (!TIME_LIMIT_OPTIONS.includes(msg.timeLimit as number)) return { ok: false, error: "Thời gian không hợp lệ" };
    next.timeLimit = msg.timeLimit as number;
  }
  if (msg.stepSeconds !== undefined) {
    if (!STEP_SECONDS_OPTIONS.includes(msg.stepSeconds as number)) return { ok: false, error: "Thời gian mỗi bước không hợp lệ" };
    next.stepSeconds = msg.stepSeconds as number;
  }
  if (msg.doubleGo !== undefined) next.doubleGo = msg.doubleGo === true;
  if (msg.parkingPot !== undefined) next.parkingPot = msg.parkingPot === true;
  if (msg.map !== undefined) {
    if (!MAP_SIZES.includes(msg.map as MapSize)) return { ok: false, error: "Bản đồ không hợp lệ" };
    next.map = msg.map as MapSize;
  }
  if (msg.buildRule !== undefined) {
    if (msg.buildRule !== "even" && msg.buildRule !== "chain") return { ok: false, error: "Luật xây nhà không hợp lệ" };
    next.buildRule = msg.buildRule;
  }
  if (msg.needGroup !== undefined) next.needGroup = msg.needGroup === true;
  if (msg.goSalary !== undefined) {
    if (!GO_SALARY_OPTIONS.includes(msg.goSalary as number)) return { ok: false, error: "Tiền qua Khởi hành không hợp lệ" };
    next.goSalary = msg.goSalary as number;
  }
  if (msg.unmortgageFee !== undefined) {
    if (!UNMORTGAGE_FEE_OPTIONS.includes(msg.unmortgageFee as number)) return { ok: false, error: "Phí chuộc không hợp lệ" };
    next.unmortgageFee = msg.unmortgageFee as number;
  }
  if (msg.landSalePct !== undefined) {
    if (!LAND_SALE_OPTIONS.includes(msg.landSalePct as number)) return { ok: false, error: "Giá bán đất không hợp lệ" };
    next.landSalePct = msg.landSalePct as number;
  }
  if (msg.risingCost !== undefined) next.risingCost = msg.risingCost === true;
  if (msg.jailRent !== undefined) next.jailRent = msg.jailRent === true;
  if (msg.doubleRoll !== undefined) next.doubleRoll = msg.doubleRoll === true;
  if (msg.sellLand !== undefined) next.sellLand = msg.sellLand === true;
  if (msg.bankruptTo !== undefined) {
    if (msg.bankruptTo !== "bank" && msg.bankruptTo !== "creditor") return { ok: false, error: "Luật phá sản không hợp lệ" };
    next.bankruptTo = msg.bankruptTo;
  }
  if (msg.first !== undefined) next.first = msg.first as number;
  if (msg.second !== undefined) next.second = msg.second as number;
  const err = checkRankPoints(next.first, next.second);
  if (err) return { ok: false, error: err };
  room.settings = next;
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

/** The piece a seat plays with: its pick, or the starting piece of its seat. */
export function pieceOf(room: TPRoom, p: TPPlayer): { emoji: string; color: string } {
  if (p.piece) return p.piece;
  const picked = room.seats.flatMap((o) => (o && o !== p && o.piece ? [o.piece] : []));
  const start = Math.max(0, room.seats.indexOf(p));
  // Own seat's starting piece unless someone picked its emoji or colour; then the next free one.
  for (let k = 0; k < DEFAULT_PIECES.length; k++) {
    const d = DEFAULT_PIECES[(start + k) % DEFAULT_PIECES.length];
    if (!picked.some((x) => x.emoji === d.emoji || x.color === d.color)) return d;
  }
  return DEFAULT_PIECES[start % DEFAULT_PIECES.length];
}

/** Everyone must hold a different emoji and colour: a player who collides with an earlier seat gets a random free piece. */
export function ensureUniquePieces(room: TPRoom, random: Random = Math.random) {
  const taken: { emoji: string; color: string }[] = [];
  for (const p of room.seats) {
    if (!p) continue;
    let piece = pieceOf(room, p);
    if (taken.some((t) => t.emoji === piece.emoji || t.color === piece.color)) {
      const emojis = PIECE_EMOJIS.filter((e) => !taken.some((t) => t.emoji === e));
      const colors = PIECE_COLORS.filter((c) => !taken.some((t) => t.color === c));
      if (emojis.length && colors.length) {
        piece = { emoji: emojis[Math.floor(random() * emojis.length)], color: colors[Math.floor(random() * colors.length)] };
        p.piece = piece;
      }
    }
    taken.push(piece);
  }
}

/** Change my token's emoji and colour; both must be unused by everyone else at the table. */
function pickPiece(room: TPRoom, p: TPPlayer, emoji: unknown, color: unknown): Result {
  if (typeof emoji !== "string" || !PIECE_EMOJIS.includes(emoji) || typeof color !== "string" || !PIECE_COLORS.includes(color)) {
    return { ok: false, error: "Quân cờ hoặc màu không hợp lệ" };
  }
  for (const o of room.seats) {
    if (!o || o === p) continue;
    const used = pieceOf(room, o);
    if (used.emoji === emoji) return { ok: false, error: "Quân này đã có người dùng" };
    if (used.color === color) return { ok: false, error: "Màu này đã có người dùng" };
  }
  p.piece = { emoji, color };
  return { ok: true };
}

const posOf = (msg: TPCommand) => ("pos" in msg && Number.isInteger(msg.pos) ? msg.pos : -1);

export function tpCommand(room: TPRoom, token: string, msg: TPCommand, now: number, random: Random = Math.random): Result {
  const p = findByToken(room, token);
  if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
  if (msg.type === "start") return startTP(room, p, now, random);
  if (msg.type === "kick") return kickTP(room, p, msg.playerId, now);
  if (msg.type === "pick") return pickPiece(room, p, msg.emoji, msg.color);
  if (msg.type === "settings") return setSettings(room, p, msg as unknown as Record<string, unknown>);
  if (msg.type === "auto") {
    if (msg.on === true) p.auto = true;
    else delete p.auto;
    // A step that is already due (its phase started over ABSENT_MS ago) is played right away.
    tickTP(room, now, random);
    return { ok: true };
  }
  const g = room.current;
  if (!g) return { ok: false, error: "Chưa bắt đầu ván" };
  if (!g.ps[p.id]) return { ok: false, error: "Bạn không chơi ván này" };
  const names = nameOf(room);
  let res: Result;
  switch (msg.type) {
    case "roll":
      res = rollDice(g, p.id, now, names, random);
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
      res = payDebt(g, p.id, now, names, random);
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
    case "sellland":
      res = sellLand(g, p.id, posOf(msg), now, names);
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
    case "loan":
      res = proposeLoan(g, p.id, msg, now, names);
      break;
    case "loananswer":
      res = answerLoan(g, p.id, msg.accept === true, now, names);
      break;
    case "tradeanswer":
      res = answerTrade(g, p.id, msg.accept === true, now, names);
      break;
    default:
      return { ok: false, error: "Lệnh không hợp lệ" };
  }
  if (!res.ok) return res;
  // Raised enough while in debt → settle it straight away.
  if ((msg.type === "sell" || msg.type === "mortgage" || msg.type === "sellland") && g.phase === "debt" && g.debt && g.ps[p.id].cash >= g.debt.amount) {
    payDebt(g, p.id, now, names, random);
  }
  afterChange(room, now);
  return res;
}

/** Record a game that just ended (points, history). */
function afterChange(room: TPRoom, now: number) {
  const g = room.current;
  if (!g || g.status !== "ended" || g.recorded) return;
  g.recorded = true;
  const deltas = scoreByRank(g.finished, tpSettingsOf(room));
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

export function tickTP(room: TPRoom, now: number, random: Random = Math.random): boolean {
  let changed = false;
  const g = room.current;
  if (g?.status === "playing") {
    const absent = (id: string) => {
      const p = findById(room, id);
      return !p || !isOnline(p, now);
    };
    const auto = (id: string) => !!findById(room, id)?.auto;
    if (tickGame(g, now, nameOf(room), absent, random, auto)) {
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
    if (isOnline(p, now)) times.push(p.lastSeen + PRESENCE_TIMEOUT_MS);
    // Past the grace period an offline seat is only freed between games; mid-game there is nothing to wake up
    // for, and a time already past would re-run `tick` every 100 ms and re-send every view.
    else if (p.lastSeen + SEAT_GRACE_MS + 1 > now || room.current?.status !== "playing") times.push(p.lastSeen + SEAT_GRACE_MS + 1);
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
    ...(player?.auto ? { auto: true } : {}),
    serverTime: now,
    // While a game runs, show the rules it actually plays with (older saved games may differ from the room settings).
    settings: room.current?.status === "playing" ? { ...tpSettingsOf(room), ...rulesOf(room.current), map: room.current.map ?? "std" } : tpSettingsOf(room),
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
            piece: pieceOf(room, p),
          }
        : null,
    ),
    current: g
      ? {
          status: g.status,
          map: g.map ?? "std",
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
          loan: g.loan ?? null,
          loans: g.loans ?? [],
          lastCard: g.lastCard,
          finished: g.finished,
          endsAt: g.endsAt,
          pot: g.pot ?? null,
          log: g.log,
          // What the viewer may do with each of their own lots (reason when not), so the UI never guesses the rules.
          ...(player && g.ps[player.id]
            ? {
                manage: Object.fromEntries(
                  Object.entries(g.deeds)
                    .filter(([, d]) => d.owner === player.id)
                    .map(([pos]) => {
                      const n = Number(pos);
                      return [n, { build: buildBlocker(g, player.id, n), sell: sellBlocker(g, player.id, n), sellLand: sellLandBlocker(g, player.id, n), landPrice: landSalePrice(g, n) }];
                    }),
                ),
              }
            : {}),
        }
      : null,
    history: (room.history ?? []).slice(-10),
    spectators: (room.spectators ?? []).filter((x) => now - x.lastSeen < PRESENCE_TIMEOUT_MS).map((x) => x.name),
    reactions: (room.reactions ?? []).filter((r) => now - r.at < REACTION_TTL_MS),
    chat: room.chat ?? [],
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
