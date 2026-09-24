import { EventEmitter } from "node:events";
import type { RoomState } from "../game/room";

/**
 * Where rooms live. On Vercel a room must be shared by every function instance
 * its players' WebSockets land on, so it goes in Redis with optimistic
 * versioning and a pub/sub notification on every change. Without Redis
 * (self-hosting on one machine) an in-memory store does the same job.
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
}

/** Rooms expire after this long without any change. */
const ROOM_TTL_SECONDS = 12 * 60 * 60;

const roomKey = (code: string) => `tienlen:room:${code}`;
const roomChannel = (code: string) => `tienlen:room:${code}:changed`;

class MemoryRoomStore implements RoomStore {
  readonly kind = "memory" as const;
  private rooms = new Map<string, { json: string; version: number; expires: number }>();
  private events = new EventEmitter().setMaxListeners(0);

  private live(code: string) {
    const r = this.rooms.get(code);
    if (r && r.expires < Date.now()) {
      this.rooms.delete(code);
      return undefined;
    }
    return r;
  }

  async create(state: RoomState) {
    if (this.live(state.code)) return false;
    this.rooms.set(state.code, { json: JSON.stringify(state), version: 1, expires: Date.now() + ROOM_TTL_SECONDS * 1000 });
    return true;
  }

  async load(code: string) {
    const r = this.live(code);
    return r ? { state: JSON.parse(r.json) as RoomState, version: r.version } : null;
  }

  async save(state: RoomState, expectedVersion: number) {
    const r = this.live(state.code);
    if (!r || r.version !== expectedVersion) return false;
    this.rooms.set(state.code, {
      json: JSON.stringify(state),
      version: expectedVersion + 1,
      expires: Date.now() + ROOM_TTL_SECONDS * 1000,
    });
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
}

// Lua keeps check-and-set atomic; the channel travels in ARGV (it is not a key).
const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'version', 1)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

const SAVE_SCRIPT = `
local v = redis.call('HGET', KEYS[1], 'version')
if not v or tonumber(v) ~= tonumber(ARGV[1]) then return 0 end
local nv = tonumber(ARGV[1]) + 1
redis.call('HSET', KEYS[1], 'state', ARGV[2], 'version', nv)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('PUBLISH', ARGV[4], nv)
return nv`;

type Redis = import("ioredis").Redis;

class RedisRoomStore implements RoomStore {
  readonly kind = "redis" as const;
  private sub: Redis | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(private redis: Redis) {}

  async create(state: RoomState) {
    const res = await this.redis.eval(CREATE_SCRIPT, 1, roomKey(state.code), JSON.stringify(state), ROOM_TTL_SECONDS);
    return res === 1;
  }

  async load(code: string) {
    const [json, version] = await this.redis.hmget(roomKey(code), "state", "version");
    return json && version ? { state: JSON.parse(json) as RoomState, version: Number(version) } : null;
  }

  async save(state: RoomState, expectedVersion: number) {
    const res = await this.redis.eval(
      SAVE_SCRIPT,
      1,
      roomKey(state.code),
      expectedVersion,
      JSON.stringify(state),
      ROOM_TTL_SECONDS,
      roomChannel(state.code),
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
