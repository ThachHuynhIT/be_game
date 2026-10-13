import type { GameRecord } from "../game/protocol";
import {
  type RoomState,
  findByToken,
  findSpectator,
  heartbeat,
  isRoomActive,
  joinRoom,
  kickPlayer,
  leaveRoom,
  newRoom,
  nextTickAt,
  passTurn,
  playCards,
  react,
  roomSummary,
  roomView,
  spectatorHeartbeat,
  startGame,
  tick,
  unwatch,
  updateSettings,
  watchRoom,
} from "../game/room";
import {
  type MeoRoom,
  findByToken as findMeoByToken,
  isMeoActive,
  joinMeo,
  leaveMeo,
  meoCommand,
  meoHeartbeat,
  meoSummary,
  meoView,
  newMeoRoom,
  nextMeoTickAt,
  tickMeo,
} from "../meono/room";
import type { MeoCommand } from "../meono/protocol";
import {
  type TPRoom,
  findByToken as findTPByToken,
  isTPActive,
  joinTP,
  leaveTP,
  newTPRoom,
  nextTPTickAt,
  tickTP,
  tpCommand,
  tpHeartbeat,
  tpSummary,
  tpView,
} from "../typhu/room";
import type { TPCommand } from "../typhu/protocol";
import {
  type SPRoom,
  findByToken as findSPByToken,
  isSPActive,
  joinSP,
  leaveSP,
  newSPRoom,
  nextSPTickAt,
  spCommand,
  spHeartbeat,
  spSummary,
  spView,
  tickSP,
} from "../splendor/room";
import type { SPCommand } from "../splendor/protocol";
import {
  type BangRoom,
  bangCommand,
  bangHeartbeat,
  bangSummary,
  bangView,
  findByToken as findBangByToken,
  isBangActive,
  joinBang,
  leaveBang,
  newBangRoom,
  nextBangTickAt,
  tickBang,
} from "../bang/room";
import type { BangCommand } from "../bang/protocol";
import {
  type CNRoom,
  cnCommand,
  cnHeartbeat,
  cnSummary,
  cnView,
  findByToken as findCNByToken,
  isCNActive,
  joinCN,
  leaveCN,
  newCNRoom,
  nextCNTickAt,
  tickCN,
} from "../cangua/room";
import type { CNCommand } from "../cangua/protocol";
import {
  type OQRoom,
  findByToken as findOQByToken,
  isOQActive,
  joinOQ,
  leaveOQ,
  newOQRoom,
  nextOQTickAt,
  oqCommand,
  oqHeartbeat,
  oqSummary,
  oqView,
  tickOQ,
} from "../oanquan/room";
import type { OQCommand } from "../oanquan/protocol";
import type { CodedRoom, GameKind } from "./store";

export type Result = { ok: true } | { ok: false; error: string };

/**
 * Everything the WebSocket hub needs to know about one game. The hub owns
 * connections, storage, fan-out and timers; the adapter owns the rules.
 * All functions mutate `room` in place and take the current time.
 */
export interface GameAdapter<S extends CodedRoom = CodedRoom> {
  game: GameKind;
  newRoom(code: string): S;
  join(room: S, token: string, name: string, now: number, newId: () => string): Result;
  watch(room: S, token: string, name: string, now: number): Result;
  heartbeat(room: S, token: string, now: number): void;
  leave(room: S, token: string, now: number): void;
  react(room: S, token: string, emoji: unknown, now: number): Result;
  /** Game commands from a seated player (start, moves, kick…). */
  command(room: S, token: string, msg: Record<string, unknown>, now: number): Result;
  /** This client's personalised view, or null if the token is not in the room. */
  view(room: S, token: string, role: "player" | "spectator", now: number): unknown | null;
  tick(room: S, now: number): boolean;
  nextTickAt(room: S, now: number): number | null;
  summary(room: S, now: number): unknown;
  isActive(room: S, now: number): boolean;
  lastRecord(room: S): GameRecord | undefined;
}

export const tienlenAdapter: GameAdapter<RoomState> = {
  game: "tienlen",
  newRoom,
  join: (room, token, name, now, newId) => joinRoom(room, token, name, now, newId),
  watch: watchRoom,
  heartbeat(room, token, now) {
    const p = findByToken(room, token);
    if (p) heartbeat(room, p, now);
    else {
      const s = findSpectator(room, token);
      if (s) spectatorHeartbeat(s, now);
    }
  },
  leave(room, token, now) {
    const p = findByToken(room, token);
    if (p) leaveRoom(room, p, now);
    else unwatch(room, token);
  },
  react,
  command(room, token, msg, now) {
    const p = findByToken(room, token);
    if (!p) return { ok: false, error: "Bạn không còn trong phòng" };
    if (msg.type === "start") return startGame(room, p, now);
    if (msg.type === "play") return playCards(room, p, msg.cards, now);
    if (msg.type === "pass") return passTurn(room, p, now);
    if (msg.type === "kick") return kickPlayer(room, p, msg.playerId, now);
    if (msg.type === "settings") return updateSettings(room, p, msg);
    return { ok: false, error: "Lệnh không hợp lệ" };
  },
  view(room, token, role, now) {
    if (role === "player") {
      const p = findByToken(room, token);
      return p ? roomView(room, p, now) : null;
    }
    return findSpectator(room, token) ? roomView(room, null, now) : null;
  },
  tick,
  nextTickAt,
  summary: roomSummary,
  isActive: isRoomActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const meonoAdapter: GameAdapter<MeoRoom> = {
  game: "meono",
  newRoom: newMeoRoom,
  join: (room, token, name, now, newId) => joinMeo(room, token, name, now, newId),
  watch: (room, token, name, now) => watchRoom(room, token, name, now),
  heartbeat: meoHeartbeat,
  leave: leaveMeo,
  react: (room, token, emoji, now) => react(room, token, emoji, now),
  command: (room, token, msg, now) => meoCommand(room, token, msg as unknown as MeoCommand, now),
  view(room, token, role, now) {
    if (role === "player") {
      const p = findMeoByToken(room, token);
      return p ? meoView(room, p, now) : null;
    }
    return findSpectator(room, token) ? meoView(room, null, now) : null;
  },
  tick: tickMeo,
  nextTickAt: nextMeoTickAt,
  summary: meoSummary,
  isActive: isMeoActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const typhuAdapter: GameAdapter<TPRoom> = {
  game: "typhu",
  newRoom: newTPRoom,
  join: (room, token, name, now, newId) => joinTP(room, token, name, now, newId),
  watch: (room, token, name, now) => watchRoom(room, token, name, now),
  heartbeat: tpHeartbeat,
  leave: leaveTP,
  react: (room, token, emoji, now) => react(room, token, emoji, now),
  command: (room, token, msg, now) => tpCommand(room, token, msg as unknown as TPCommand, now),
  view(room, token, role, now) {
    if (role === "player") {
      const p = findTPByToken(room, token);
      return p ? tpView(room, p, now) : null;
    }
    return findSpectator(room, token) ? tpView(room, null, now) : null;
  },
  tick: tickTP,
  nextTickAt: nextTPTickAt,
  summary: tpSummary,
  isActive: isTPActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const splendorAdapter: GameAdapter<SPRoom> = {
  game: "splendor",
  newRoom: newSPRoom,
  join: (room, token, name, now, newId) => joinSP(room, token, name, now, newId),
  watch: (room, token, name, now) => watchRoom(room, token, name, now),
  heartbeat: spHeartbeat,
  leave: leaveSP,
  react: (room, token, emoji, now) => react(room, token, emoji, now),
  command: (room, token, msg, now) => spCommand(room, token, msg as unknown as SPCommand, now),
  view(room, token, role, now) {
    if (role === "player") {
      const p = findSPByToken(room, token);
      return p ? spView(room, p, now) : null;
    }
    return findSpectator(room, token) ? spView(room, null, now) : null;
  },
  tick: tickSP,
  nextTickAt: nextSPTickAt,
  summary: spSummary,
  isActive: isSPActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const bangAdapter: GameAdapter<BangRoom> = {
  game: "bang",
  newRoom: newBangRoom,
  join: (room, token, name, now, newId) => joinBang(room, token, name, now, newId),
  watch: (room, token, name, now) => watchRoom(room, token, name, now),
  heartbeat: bangHeartbeat,
  leave: leaveBang,
  react: (room, token, emoji, now) => react(room, token, emoji, now),
  command: (room, token, msg, now) => bangCommand(room, token, msg as unknown as BangCommand, now),
  view(room, token, role, now) {
    if (role === "player") {
      const p = findBangByToken(room, token);
      return p ? bangView(room, p, now) : null;
    }
    return findSpectator(room, token) ? bangView(room, null, now) : null;
  },
  tick: tickBang,
  nextTickAt: nextBangTickAt,
  summary: bangSummary,
  isActive: isBangActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const oanquanAdapter: GameAdapter<OQRoom> = {
  game: "oanquan",
  newRoom: newOQRoom,
  join: (room, token, name, now, newId) => joinOQ(room, token, name, now, newId),
  watch: (room, token, name, now) => watchRoom(room, token, name, now),
  heartbeat: oqHeartbeat,
  leave: leaveOQ,
  react: (room, token, emoji, now) => react(room, token, emoji, now),
  command: (room, token, msg, now) => oqCommand(room, token, msg as unknown as OQCommand, now),
  view(room, token, role, now) {
    if (role === "player") {
      const p = findOQByToken(room, token);
      return p ? oqView(room, p, now) : null;
    }
    return findSpectator(room, token) ? oqView(room, null, now) : null;
  },
  tick: (room, now) => tickOQ(room, now),
  nextTickAt: nextOQTickAt,
  summary: oqSummary,
  isActive: isOQActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const canguaAdapter: GameAdapter<CNRoom> = {
  game: "cangua",
  newRoom: newCNRoom,
  join: (room, token, name, now, newId) => joinCN(room, token, name, now, newId),
  watch: (room, token, name, now) => watchRoom(room, token, name, now),
  heartbeat: cnHeartbeat,
  leave: leaveCN,
  react: (room, token, emoji, now) => react(room, token, emoji, now),
  command: (room, token, msg, now) => cnCommand(room, token, msg as unknown as CNCommand, now),
  view(room, token, role, now) {
    if (role === "player") {
      const p = findCNByToken(room, token);
      return p ? cnView(room, p, now) : null;
    }
    return findSpectator(room, token) ? cnView(room, null, now) : null;
  },
  tick: (room, now) => tickCN(room, now),
  nextTickAt: nextCNTickAt,
  summary: cnSummary,
  isActive: isCNActive,
  lastRecord: (room) => room.history?.[room.history.length - 1],
};

export const ADAPTERS: Record<GameKind, GameAdapter> = {
  tienlen: tienlenAdapter as unknown as GameAdapter,
  meono: meonoAdapter as unknown as GameAdapter,
  typhu: typhuAdapter as unknown as GameAdapter,
  splendor: splendorAdapter as unknown as GameAdapter,
  bang: bangAdapter as unknown as GameAdapter,
  cangua: canguaAdapter as unknown as GameAdapter,
  oanquan: oanquanAdapter as unknown as GameAdapter,
};
