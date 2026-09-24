import { randomBytes } from "node:crypto";
import { EMOJI_COOLDOWN_MS, type GameRecord } from "../game/protocol";
import { randomCode } from "../game/room";
import { ADAPTERS, type GameAdapter, type Result, tienlenAdapter } from "./adapters";
import { type CodedRoom, type GameKind, type RoomStore, getRoomStore } from "./store";

/**
 * Transport- and game-agnostic WebSocket handling for the Vercel functions and the local server.
 *
 * Every change goes through `mutate()` (load → apply → compare-and-swap save).
 * A successful save notifies every instance subscribed to the room, and each
 * instance then pushes a personalised view to the sockets it holds, so the
 * players of one room may sit on different function instances.
 * Game rules live behind a `GameAdapter`.
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
  /** Defaults to the process-wide hub for `game` (Tiến Lên if omitted). */
  hub?: RoomHub;
  game?: GameKind;
}

export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Ask clients to move to a fresh connection this long before the platform deadline. */
const RECONNECT_LEAD_MS = 25_000;
/** Messages allowed per connection per second before it is dropped. */
const MAX_MESSAGES_PER_SECOND = 20;

type Ack = { ok: true; code?: string } | { ok: false; error: string };
type OutMessage = ({ type: "ack"; id: number } & Ack) | { type: "state"; view: unknown } | { type: "reconnect" } | { type: "pong" };

interface Conn {
  socket: HubSocket;
  code: string | null;
  token: string | null;
  role: "player" | "spectator";
}

interface LocalRoom {
  conns: Set<Conn>;
  unsubscribe: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<void> | null;
  dirty: boolean;
}

const newId = (len = 8) => randomBytes(len).toString("base64url").slice(0, len);

export class RoomHub<S extends CodedRoom = CodedRoom> {
  private rooms = new Map<string, LocalRoom>();

  constructor(
    readonly store: RoomStore<S>,
    readonly adapter: GameAdapter<S>,
  ) {}

  /**
   * Load → apply → compare-and-swap, retrying on conflicts. `fn` mutates the draft in place.
   * A game that finished in the committed change is added to the leaderboard.
   */
  async mutate<T>(code: string, fn: (room: S, now: number) => T): Promise<{ found: false } | { found: true; result: T }> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const cur = await this.store.load(code);
      if (!cur) return { found: false };
      const before = JSON.stringify(cur.state);
      const draft = JSON.parse(before) as S;
      const result = fn(draft, Date.now());
      if (JSON.stringify(draft) === before) return { found: true, result };
      if (await this.store.save(draft, cur.version)) {
        const rec: GameRecord | undefined = this.adapter.lastRecord(draft);
        if (rec && rec.id !== this.adapter.lastRecord(cur.state)?.id) {
          await this.store.recordGame(rec).catch((err) => console.error("[be_game] leaderboard:", err));
        }
        return { found: true, result };
      }
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
    }
    throw new Error("Phòng đang bận, thử lại");
  }

  async createRoom(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      if (await this.store.create(this.adapter.newRoom(code))) return code;
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

  add(conn: Conn, code: string) {
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
          if (!conn.token) continue;
          const view = this.adapter.view(cur.state, conn.token, conn.role, now);
          if (view) send(conn.socket, { type: "state", view });
        }
        this.arm(code, r, cur.state, now);
      } while (r.dirty);
    })().finally(() => {
      r.refreshing = null;
    });
    return r.refreshing;
  }

  /** Schedule the next `tick` for this room on this instance (every instance holding a socket does; CAS dedupes). */
  private arm(code: string, r: LocalRoom, state: S, now: number) {
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    const at = this.adapter.nextTickAt(state, now);
    if (at === null) return;
    const delay = Math.min(Math.max(at - now + 50, 100), 30_000);
    r.timer = setTimeout(() => {
      r.timer = null;
      void this.mutate(code, (room, t) => this.adapter.tick(room, t))
        .then(() => this.refresh(code))
        .catch((err) => console.error("[be_game] tick:", err));
    }, delay);
  }
}

type HubGlobal = typeof globalThis & { __gameHubs?: Map<GameKind, Promise<RoomHub>> };

/** A hub over a given store — one per game per process normally; tests create several to mimic instances. */
export function createRoomHub<S extends CodedRoom>(store: RoomStore<S>, adapter?: GameAdapter<S>): RoomHub<S> {
  return new RoomHub(store, adapter ?? (tienlenAdapter as unknown as GameAdapter<S>));
}

export function getHub(game: GameKind = "tienlen"): Promise<RoomHub> {
  const g = globalThis as HubGlobal;
  g.__gameHubs ??= new Map();
  let hub = g.__gameHubs.get(game);
  if (!hub) {
    hub = getRoomStore(game).then((store) => new RoomHub(store, ADAPTERS[game]));
    g.__gameHubs.set(game, hub);
  }
  return hub;
}

function send(socket: HubSocket, msg: OutMessage) {
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
  if (data && typeof (data as { toString?: unknown }).toString === "function") return String(data);
  return null;
};

type InMessage = Record<string, unknown> & { type: string };

function parse(data: unknown): InMessage | null {
  const text = toText(data);
  if (!text || text.length > MAX_MESSAGE_BYTES) return null;
  try {
    const msg = JSON.parse(text);
    return msg && typeof msg === "object" && typeof msg.type === "string" ? (msg as InMessage) : null;
  } catch {
    return null;
  }
}

const cleanCode = (code: unknown) => String(code ?? "").toUpperCase().slice(0, 8);

/** Wire a freshly upgraded WebSocket into a game. */
export function attachConnection(socket: HubSocket, opts: AttachOptions = {}) {
  const conn: Conn = { socket, code: null, token: null, role: "player" };
  const hubPromise: Promise<RoomHub> = opts.hub ? Promise.resolve(opts.hub) : getHub(opts.game ?? "tienlen");
  let closed = false;
  let windowStart = Date.now();
  let messagesInWindow = 0;
  let lastEmojiAt = 0;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  if (opts.deadline) {
    const ms = opts.deadline.getTime() - Date.now() - RECONNECT_LEAD_MS;
    reconnectTimer = setTimeout(() => send(socket, { type: "reconnect" }), Math.max(ms, 5_000));
  }

  const ack = (id: number, res: Ack | Result) => send(socket, { type: "ack", id, ...res });

  const handle = async (hub: RoomHub, msg: InMessage) => {
    const adapter = hub.adapter;
    if (msg.type === "ping") {
      send(socket, { type: "pong" });
      if (conn.code && conn.token) {
        const { token } = conn;
        await hub.mutate(conn.code, (room, now) => adapter.heartbeat(room, token, now));
      }
      return;
    }

    const id = Number(msg.id) || 0;
    if (msg.type === "create") return ack(id, { ok: true, code: await hub.createRoom() });

    if (msg.type === "join" || msg.type === "watch") {
      const code = cleanCode(msg.code);
      const token = String(msg.token ?? "");
      const name = String(msg.name ?? "");
      const res = await hub.mutate(code, (room, now) =>
        msg.type === "join" ? adapter.join(room, token, name, now, newId) : adapter.watch(room, token, name, now),
      );
      if (!res.found) return ack(id, { ok: false, error: "Không tìm thấy phòng" });
      if (!res.result.ok) return ack(id, res.result);
      if (conn.code && conn.code !== code) hub.remove(conn);
      conn.code = code;
      conn.token = token;
      conn.role = msg.type === "join" ? "player" : "spectator";
      hub.add(conn, code);
      ack(id, { ok: true });
      // The save above already notified subscribers, but this socket may have registered after it.
      return hub.refresh(code);
    }

    if (!conn.code || !conn.token) return ack(id, { ok: false, error: "Bạn chưa vào phòng" });
    const { code, token } = conn;

    if (msg.type === "leave") {
      await hub.mutate(code, (room, now) => adapter.leave(room, token, now));
      hub.remove(conn);
      conn.code = conn.token = null;
      return ack(id, { ok: true });
    }

    if (msg.type === "emoji") {
      const now = Date.now();
      if (now - lastEmojiAt < EMOJI_COOLDOWN_MS) return ack(id, { ok: false, error: "Chậm lại một chút" });
      lastEmojiAt = now;
      const res = await hub.mutate(code, (room, t) => adapter.react(room, token, msg.emoji, t));
      return ack(id, res.found ? res.result : { ok: false, error: "Không tìm thấy phòng" });
    }

    if (conn.role === "spectator") return ack(id, { ok: false, error: "Khán giả không thể thao tác" });
    const res = await hub.mutate(code, (room, now) => adapter.command(room, token, msg, now));
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
        console.error("[be_game]", err);
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
