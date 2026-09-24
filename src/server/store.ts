import { EventEmitter } from "node:events";
import type { GameRecord, LeaderboardEntry } from "../game/protocol";
import type { RoomState } from "../game/room";

/**
 * Where rooms live. On Vercel a room must be shared by every function instance
 * its players' WebSockets land on, so it goes in Redis with optimistic
 * versioning and a pub/sub notification on every change. Without Redis
 * (a single local process) an in-memory store does the same job.
 *
 * The store also keeps the all-time leaderboard and an index of recently
 * active rooms for the lobby.
 */
export interface StoredRoom {
  state: RoomState;
  version: number;
}

export interface RoomStore {
  readonly kind: "redis" | "memory";
  /** Create a room; false if the code is taken. */
  create(state: RoomState): Promise<boolean>;
  load(code: string): Promise<StoredRoom | null>;
  /** Compare-and-swap: saves only if the stored version still equals `expectedVersion`, then notifies subscribers. */
  save(state: RoomState, expectedVersion: number): Promise<boolean>;
  /** Called after every successful save of this room (from any instance). Returns an unsubscribe function. */
  subscribe(code: string, listener: () => void): Promise<() => void>;
  /** Add a finished game to the leaderboard. Idempotent per `record.id`. */
  recordGame(record: GameRecord): Promise<void>;
  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
  /** Most recently updated rooms, newest first. */
  recentRooms(limit: number): Promise<RoomState[]>;
}

/** Rooms expire after this long without any change. */
const ROOM_TTL_SECONDS = 12 * 60 * 60;
/** Only rooms touched this recently show up in the lobby index. */
const ROOM_INDEX_WINDOW_MS = 60 * 60 * 1000;
/** How long a recorded game id is remembered (dedupes retries). */
const RECORD_DEDUPE_SECONDS = 30 * 24 * 60 * 60;

const roomKey = (code: string) => `tienlen:room:${code}`;
const roomChannel = (code: string) => `tienlen:room:${code}:changed`;
const ROOM_INDEX = "tienlen:rooms";
const LB_POINTS = "tienlen:lb:points";
const lbPlayerKey = (key: string) => `tienlen:lb:p:${key}`;
const recordKey = (id: string) => `tienlen:lb:done:${id}`;

/** Leaderboard identity: the display name, case/space-insensitive (there are no accounts). */
export const nameKey = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

interface LbRow {
  key: string;
  name: string;
  delta: number;
  win: number;
}

const toRows = (record: GameRecord): LbRow[] =>
  record.results.map((r) => ({ key: nameKey(r.name), name: r.name, delta: r.delta, win: r.rank === 0 ? 1 : 0 }));

class MemoryRoomStore implements RoomStore {
  readonly kind = "memory" as const;
  private rooms = new Map<string, { json: string; version: number; expires: number; touched: number }>();
  private events = new EventEmitter().setMaxListeners(0);
  private board = new Map<string, LeaderboardEntry>();
  private recorded = new Set<string>();

  private live(code: string) {
    const r = this.rooms.get(code);
    if (r && r.expires < Date.now()) {
      this.rooms.delete(code);
      return undefined;
    }
    return r;
  }

  private put(state: RoomState, version: number) {
    const now = Date.now();
    this.rooms.set(state.code, { json: JSON.stringify(state), version, expires: now + ROOM_TTL_SECONDS * 1000, touched: now });
  }

  async create(state: RoomState) {
    if (this.live(state.code)) return false;
    this.put(state, 1);
    return true;
  }

  async load(code: string) {
    const r = this.live(code);
    return r ? { state: JSON.parse(r.json) as RoomState, version: r.version } : null;
  }

  async save(state: RoomState, expectedVersion: number) {
    const r = this.live(state.code);
    if (!r || r.version !== expectedVersion) return false;
    this.put(state, expectedVersion + 1);
    // Async like Redis pub/sub, so callers never depend on synchronous delivery.
    setImmediate(() => this.events.emit(state.code));
    return true;
  }

  async subscribe(code: string, listener: () => void) {
    this.events.on(code, listener);
    return () => {
      this.events.off(code, listener);
    };
  }

  async recordGame(record: GameRecord) {
    if (this.recorded.has(record.id)) return;
    this.recorded.add(record.id);
    for (const row of toRows(record)) {
      const cur = this.board.get(row.key) ?? { name: row.name, points: 0, games: 0, wins: 0, lastPlayed: 0 };
      this.board.set(row.key, {
        name: row.name,
        points: cur.points + row.delta,
        games: cur.games + 1,
        wins: cur.wins + row.win,
        lastPlayed: record.at,
      });
    }
  }

  async leaderboard(limit: number) {
    return [...this.board.values()].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, limit);
  }

  async recentRooms(limit: number) {
    const since = Date.now() - ROOM_INDEX_WINDOW_MS;
    return [...this.rooms.entries()]
      .filter(([code, r]) => r.touched >= since && this.live(code))
      .sort((a, b) => b[1].touched - a[1].touched)
      .slice(0, limit)
      .map(([, r]) => JSON.parse(r.json) as RoomState);
  }
}

// Lua keeps check-and-set atomic. KEYS: room hash, room index. ARGV carries the pub/sub channel.
const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'version', 1)
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1`;

const SAVE_SCRIPT = `
local v = redis.call('HGET', KEYS[1], 'version')
if not v or tonumber(v) ~= tonumber(ARGV[1]) then return 0 end
local nv = tonumber(ARGV[1]) + 1
redis.call('HSET', KEYS[1], 'state', ARGV[2], 'version', nv)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[6])
redis.call('PUBLISH', ARGV[4], nv)
return nv`;

// KEYS: dedupe key, points zset. ARGV: rows JSON, timestamp, dedupe ttl, player-hash prefix.
const RECORD_SCRIPT = `
if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[3]) then return 0 end
local rows = cjson.decode(ARGV[1])
for _, r in ipairs(rows) do
  redis.call('ZINCRBY', KEYS[2], r.delta, r.key)
  local h = ARGV[4] .. r.key
  redis.call('HINCRBY', h, 'points', r.delta)
  redis.call('HINCRBY', h, 'games', 1)
  redis.call('HINCRBY', h, 'wins', r.win)
  redis.call('HSET', h, 'name', r.name, 'last', ARGV[2])
end
return 1`;

type Redis = import("ioredis").Redis;

class RedisRoomStore implements RoomStore {
  readonly kind = "redis" as const;
  private sub: Redis | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(private redis: Redis) {}

  async create(state: RoomState) {
    const res = await this.redis.eval(
      CREATE_SCRIPT,
      2,
      roomKey(state.code),
      ROOM_INDEX,
      JSON.stringify(state),
      ROOM_TTL_SECONDS,
      Date.now(),
      state.code,
    );
    return res === 1;
  }

  async load(code: string) {
    const [json, version] = await this.redis.hmget(roomKey(code), "state", "version");
    return json && version ? { state: JSON.parse(json) as RoomState, version: Number(version) } : null;
  }

  async save(state: RoomState, expectedVersion: number) {
    const res = await this.redis.eval(
      SAVE_SCRIPT,
      2,
      roomKey(state.code),
      ROOM_INDEX,
      expectedVersion,
      JSON.stringify(state),
      ROOM_TTL_SECONDS,
      roomChannel(state.code),
      Date.now(),
      state.code,
    );
    return Number(res) > 0;
  }

  async subscribe(code: string, listener: () => void) {
    if (!this.sub) {
      // A connection in subscriber mode cannot run other commands, so use a dedicated one.
      this.sub = this.redis.duplicate();
      this.sub.on("message", (channel: string) => {
        const c = channel.slice("tienlen:room:".length, -":changed".length);
        this.listeners.get(c)?.forEach((fn) => fn());
      });
    }
    let set = this.listeners.get(code);
    if (!set) {
      set = new Set();
      this.listeners.set(code, set);
      await this.sub.subscribe(roomChannel(code));
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(code) === set) {
        this.listeners.delete(code);
        void this.sub?.unsubscribe(roomChannel(code));
      }
    };
  }

  async recordGame(record: GameRecord) {
    await this.redis.eval(
      RECORD_SCRIPT,
      2,
      recordKey(record.id),
      LB_POINTS,
      JSON.stringify(toRows(record)),
      record.at,
      RECORD_DEDUPE_SECONDS,
      lbPlayerKey(""),
    );
  }

  async leaderboard(limit: number) {
    const keys = await this.redis.zrevrange(LB_POINTS, 0, limit - 1);
    if (!keys.length) return [];
    const pipe = this.redis.pipeline();
    for (const k of keys) pipe.hmget(lbPlayerKey(k), "name", "points", "games", "wins", "last");
    const rows = (await pipe.exec()) ?? [];
    return rows
      .map(([, v]) => v as (string | null)[])
      .filter((v) => v?.[0])
      .map(([name, points, games, wins, last]) => ({
        name: name!,
        points: Number(points),
        games: Number(games),
        wins: Number(wins),
        lastPlayed: Number(last),
      }));
  }

  async recentRooms(limit: number) {
    const now = Date.now();
    // Drop index entries for rooms that have certainly expired.
    await this.redis.zremrangebyscore(ROOM_INDEX, 0, now - ROOM_TTL_SECONDS * 1000);
    const codes = await this.redis.zrevrangebyscore(ROOM_INDEX, "+inf", now - ROOM_INDEX_WINDOW_MS, "LIMIT", 0, limit);
    if (!codes.length) return [];
    const pipe = this.redis.pipeline();
    for (const c of codes) pipe.hget(roomKey(c), "state");
    const rows = (await pipe.exec()) ?? [];
    return rows.map(([, v]) => v as string | null).filter((v): v is string => !!v).map((v) => JSON.parse(v) as RoomState);
  }
}

/** Redis URL from the usual Vercel Marketplace / Upstash variable names. */
export const redisUrl = () => process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL || "";

type StoreGlobal = typeof globalThis & { __tienlenStore?: Promise<RoomStore> };

/** Process-wide store singleton (Redis when configured, memory otherwise). */
export function getRoomStore(): Promise<RoomStore> {
  const g = globalThis as StoreGlobal;
  g.__tienlenStore ??= (async () => {
    const url = redisUrl();
    if (!url) {
      if (process.env.VERCEL) {
        console.error("[tienlen] REDIS_URL is not set — rooms will not be shared between function instances.");
      }
      return new MemoryRoomStore();
    }
    const { default: IORedis } = await import("ioredis");
    const redis = new IORedis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
    redis.on("error", (err) => console.error("[tienlen] redis:", err.message));
    return new RedisRoomStore(redis);
  })();
  return g.__tienlenStore;
}

/** For tests. */
export const createMemoryRoomStore = (): RoomStore => new MemoryRoomStore();
