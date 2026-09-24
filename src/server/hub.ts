import { randomBytes } from "node:crypto";
import type { AckResult, ClientMessage, ServerMessage } from "../game/protocol";
import {
  type RoomState,
  findByToken,
  heartbeat,
  joinRoom,
  leaveRoom,
  newRoom,
  nextTickAt,
  passTurn,
  playCards,
  randomCode,
  roomView,
  startGame,
  tick,
} from "../game/room";
import { type RoomStore, getRoomStore } from "./store";

/**
 * Transport-agnostic WebSocket handling, shared by the Vercel route handler
 * (`experimental_upgradeWebSocket`) and the self-hosted Node server.
 *
 * Every change goes through `mutate()` (load → apply → compare-and-swap save).
 * A successful save notifies every instance subscribed to the room, and each
 * instance then pushes a personalised view to the sockets it holds, so the
 * players of one room may sit on different function instances.
 */

/** The subset of a `ws` WebSocket the hub needs. */
export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface AttachOptions {
  /** When the platform will kill this connection; the client is told to reconnect shortly before. */
  deadline?: Date;
  /** Defaults to the process-wide hub over `getRoomStore()`. */
  hub?: RoomHub;
}

export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Ask clients to move to a fresh connection this long before the platform deadline. */
const RECONNECT_LEAD_MS = 25_000;
/** Messages allowed per connection per second before it is dropped. */
const MAX_MESSAGES_PER_SECOND = 20;

interface Conn {
  socket: HubSocket;
  code: string | null;
  token: string | null;
}

interface LocalRoom {
  conns: Set<Conn>;
  unsubscribe: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<void> | null;
  dirty: boolean;
}

const newId = (len = 8) => randomBytes(len).toString("base64url").slice(0, len);

export class RoomHub {
  private rooms = new Map<string, LocalRoom>();

  constructor(private store: RoomStore) {}

  /** Load → apply → compare-and-swap, retrying on conflicts. `fn` mutates the draft in place. */
  async mutate<T>(code: string, fn: (room: RoomState, now: number) => T): Promise<{ found: false } | { found: true; result: T }> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const cur = await this.store.load(code);
      if (!cur) return { found: false };
      const before = JSON.stringify(cur.state);
      const draft = JSON.parse(before) as RoomState;
      const result = fn(draft, Date.now());
      if (JSON.stringify(draft) === before) return { found: true, result };
      if (await this.store.save(draft, cur.version)) return { found: true, result };
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
    }
    throw new Error("Phòng đang bận, thử lại");
  }

  async createRoom(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      if (await this.store.create(newRoom(code))) return code;
    }
    throw new Error("Không tạo được phòng");
  }

  private local(code: string): LocalRoom {
    let r = this.rooms.get(code);
    if (!r) {
      r = { conns: new Set(), unsubscribe: null, timer: null, refreshing: null, dirty: false };
      this.rooms.set(code, r);
      const room = r;
      void this.store.subscribe(code, () => this.refresh(code)).then((unsub) => {
        if (this.rooms.get(code) === room) room.unsubscribe = unsub;
        else unsub();
      });
    }
    return r;
  }

  async add(conn: Conn, code: string) {
    this.local(code).conns.add(conn);
  }

  remove(conn: Conn) {
    if (!conn.code) return;
    const r = this.rooms.get(conn.code);
    if (!r) return;
    r.conns.delete(conn);
    if (r.conns.size === 0) {
      r.unsubscribe?.();
      if (r.timer) clearTimeout(r.timer);
      this.rooms.delete(conn.code);
    }
  }

  /** Push fresh views to this instance's sockets in the room and re-arm its timer. Coalesces bursts. */
  refresh(code: string): Promise<void> {
    const r = this.rooms.get(code);
    if (!r) return Promise.resolve();
    if (r.refreshing) {
      r.dirty = true;
      return r.refreshing;
    }
    r.refreshing = (async () => {
      do {
        r.dirty = false;
        const cur = await this.store.load(code).catch(() => null);
        if (!cur) break;
        const now = Date.now();
        for (const conn of r.conns) {
          const player = conn.token ? findByToken(cur.state, conn.token) : null;
          if (player) send(conn.socket, { type: "state", view: roomView(cur.state, player, now) });
        }
        this.arm(code, r, cur.state, now);
      } while (r.dirty);
    })().finally(() => {
      r.refreshing = null;
    });
    return r.refreshing;
  }

  /** Schedule the next `tick` for this room on this instance (every instance holding a player does; CAS dedupes). */
  private arm(code: string, r: LocalRoom, state: RoomState, now: number) {
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    const at = nextTickAt(state, now);
    if (at === null) return;
    const delay = Math.min(Math.max(at - now + 50, 100), 30_000);
    r.timer = setTimeout(() => {
      r.timer = null;
      void this.mutate(code, (room, t) => tick(room, t))
        .then(() => this.refresh(code))
        .catch((err) => console.error("[tienlen] tick:", err));
    }, delay);
  }
}

type HubGlobal = typeof globalThis & { __tienlenHub?: Promise<RoomHub> };

/** A hub over a given store — one per process normally; tests create several to mimic instances. */
export const createRoomHub = (store: RoomStore) => new RoomHub(store);

function getHub(): Promise<RoomHub> {
  const g = globalThis as HubGlobal;
  g.__tienlenHub ??= getRoomStore().then((s) => new RoomHub(s));
  return g.__tienlenHub;
}

function send(socket: HubSocket, msg: ServerMessage) {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* socket already closing */
  }
}

const toText = (data: unknown): string | null => {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  return null;
};

function parse(data: unknown): ClientMessage | null {
  const text = toText(data);
  if (!text || text.length > MAX_MESSAGE_BYTES) return null;
  try {
    const msg = JSON.parse(text);
    return msg && typeof msg === "object" && typeof msg.type === "string" ? (msg as ClientMessage) : null;
  } catch {
    return null;
  }
}

/** Wire a freshly upgraded WebSocket into the game. */
export function attachConnection(socket: HubSocket, opts: AttachOptions = {}) {
  const conn: Conn = { socket, code: null, token: null };
  const hubPromise = opts.hub ? Promise.resolve(opts.hub) : getHub();
  let closed = false;
  let windowStart = Date.now();
  let messagesInWindow = 0;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  if (opts.deadline) {
    const ms = opts.deadline.getTime() - Date.now() - RECONNECT_LEAD_MS;
    reconnectTimer = setTimeout(() => send(socket, { type: "reconnect" }), Math.max(ms, 5_000));
  }

  const ack = (id: number, res: AckResult<{ code?: string }>) => send(socket, { type: "ack", id, ...res });

  const handle = async (hub: RoomHub, msg: ClientMessage) => {
    if (msg.type === "ping") {
      send(socket, { type: "pong" });
      if (conn.code && conn.token) {
        const { code, token } = conn;
        await hub.mutate(code, (room, now) => {
          const p = findByToken(room, token);
          if (p) heartbeat(room, p, now);
        });
      }
      return;
    }

    const id = Number(msg.id) || 0;
    if (msg.type === "create") {
      return ack(id, { ok: true, code: await hub.createRoom() });
    }

    if (msg.type === "join") {
      const code = String(msg.code ?? "").toUpperCase().slice(0, 8);
      const token = String(msg.token ?? "");
      const res = await hub.mutate(code, (room, now) => joinRoom(room, token, String(msg.name ?? ""), now, newId));
      if (!res.found) return ack(id, { ok: false, error: "Không tìm thấy phòng" });
      if (!res.result.ok) return ack(id, res.result);
      if (conn.code && conn.code !== code) hub.remove(conn);
      conn.code = code;
      conn.token = token;
      await hub.add(conn, code);
      ack(id, { ok: true });
      // The save above already notified subscribers, but this socket may have registered after it.
      return hub.refresh(code);
    }

    if (!conn.code || !conn.token) return ack(id, { ok: false, error: "Bạn chưa vào phòng" });
    const { code, token } = conn;

    if (msg.type === "leave") {
      await hub.mutate(code, (room, now) => {
        const p = findByToken(room, token);
        if (p) leaveRoom(room, p, now);
      });
      hub.remove(conn);
      conn.code = conn.token = null;
      return ack(id, { ok: true });
    }

    const res = await hub.mutate(code, (room, now) => {
      const p = findByToken(room, token);
      if (!p) return { ok: false as const, error: "Bạn không còn trong phòng" };
      if (msg.type === "start") return startGame(room, p, now);
      if (msg.type === "play") return playCards(room, p, msg.cards, now);
      if (msg.type === "pass") return passTurn(room, p, now);
      return { ok: false as const, error: "Lệnh không hợp lệ" };
    });
    ack(id, res.found ? res.result : { ok: false, error: "Không tìm thấy phòng" });
  };

  // Process messages one at a time per connection so acks keep their order.
  let queue = Promise.resolve();
  socket.on("message", (data) => {
    if (closed) return;
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      messagesInWindow = 0;
    }
    if (++messagesInWindow > MAX_MESSAGES_PER_SECOND) {
      socket.close(1008, "rate limit");
      return;
    }
    const msg = parse(data);
    if (!msg) return;
    queue = queue.then(async () => {
      try {
        await handle(await hubPromise, msg);
      } catch (err) {
        console.error("[tienlen]", err);
        if ("id" in msg) ack(Number(msg.id) || 0, { ok: false, error: err instanceof Error ? err.message : "Lỗi máy chủ" });
      }
    });
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    // Presence expires on its own (heartbeats stop); we only drop the local fan-out.
    void hubPromise.then((hub) => hub.remove(conn));
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

/**
 * Origin check for the WebSocket upgrade. The web app lives on another origin
 * than this backend, so with ALLOWED_ORIGIN unset every origin is accepted.
 * Set it (comma-separated, `*` wildcards, e.g. "https://my-site.com,https://*.vercel.app")
 * to lock the backend to your frontends.
 */
export function isAllowedOrigin(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return true; // non-browser clients
  const allowed = (process.env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0 || allowed.includes("*")) return true;
  try {
    if (host && new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return allowed.some((pattern) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-.]+")}$`, "i").test(origin),
  );
}
