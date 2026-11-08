import { randomBytes } from "node:crypto";
import { CHAT_COOLDOWN_MS, EMOJI_COOLDOWN_MS, type GameRecord } from "../game/protocol";
import { type SocialRoom, cleanName, randomCode, sendChat } from "../game/room";
import { ADAPTERS, type GameAdapter, type Result, tienlenAdapter } from "./adapters";
import type { RateLimiter } from "../accounts/rateLimit";
import { ACCOUNTS_UNCONFIGURED, type AccountService, accountsConfigError, getAccountService } from "../accounts/service";
import { type CodedRoom, type GameKind, type RoomStore, getRoomStore, nameKey } from "./store";

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
  now?: () => number;
  /** When the platform will kill this connection; the client is told to reconnect shortly before. */
  deadline?: Date;
  /** Defaults to the process-wide hub for `game` (Tiến Lên if omitted). */
  hub?: RoomHub;
  game?: GameKind;
  /** Client IP (`clientIp(req)`), the bucket for the room-create limit. */
  ip?: string;
  /** Limiter for room creation; defaults to the account service's (Redis when configured). */
  limiter?: RateLimiter;
}

export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Ask clients to move to a fresh connection this long before the platform deadline. */
const RECONNECT_LEAD_MS = 25_000;
/** Messages allowed per connection per second before it is dropped. */
const MAX_MESSAGES_PER_SECOND = 20;
/** Rooms one client IP may create per window (shared by every socket and both backends' Redis limiter). */
export const ROOM_CREATES_PER_IP = 20;
export const ROOM_CREATE_WINDOW_SEC = 10 * 60;
export const ROOM_CREATE_LIMITED = "Bạn tạo phòng quá nhanh, thử lại sau ít phút";

type Ack = { ok: true; code?: string } | { ok: false; error: string };
type OutMessage = ({ type: "ack"; id: number } & Ack) | { type: "state"; view: unknown } | { type: "reconnect" } | { type: "pong" } | { type: "signedOut"; reason: "replaced" | "revoked" };

interface Conn {
  socket: HubSocket;
  code: string | null;
  token: string | null;
  role: "player" | "spectator";
  /** Account that joined; the look is re-read from the store by this id (a later password change revokes the join token, not the seat). */
  userId: string | null;
  session: string | null;
  authCheckedAt: number;
}

interface LocalRoom {
  conns: Set<Conn>;
  unsubscribe: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<void> | null;
  dirty: boolean;
  /** Newest copy of the room this instance has seen (saved or loaded), as stored. Saves stay compare-and-swap. */
  latest: { json: string; version: number } | null;
  /** Highest version announced by the store's notifications; views older than this are reloaded. */
  want: number;
}

/** Icon + colour a player picked in the games top bar; shown next to their name at every table. */
export interface PlayerLook {
  icon: string;
  color: string;
}

/** Accepts only a short icon (emoji / letter, or none) and a #rrggbb colour; anything else is dropped. */
export function cleanLook(raw: unknown): PlayerLook | null {
  if (!raw || typeof raw !== "object") return null;
  const { icon, color } = raw as Record<string, unknown>;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const ic = typeof icon === "string" ? [...icon].slice(0, 4).join("") : "";
  return { icon: ic, color: color.toLowerCase() };
}

type LookRoom = { seats: ({ token: string; name: string; uid?: string } | null)[]; spectators?: { token: string; name: string }[]; looks?: Record<string, PlayerLook> };

/** Remember this token's look (dropping looks of tokens that left the room). */
function setLook(room: LookRoom, token: string, look: PlayerLook | null) {
  const present = new Set([...room.seats.flatMap((p) => (p ? [p.token] : [])), ...(room.spectators ?? []).map((x) => x.token)]);
  const looks: Record<string, PlayerLook> = {};
  for (const [t, l] of Object.entries(room.looks ?? {})) if (present.has(t) && t !== token) looks[t] = l;
  if (look && present.has(token)) looks[token] = look;
  if (JSON.stringify(looks) !== JSON.stringify(room.looks ?? {})) room.looks = looks;
}

/** Looks by player name for the views (tokens never leave the server). */
function looksByName(room: LookRoom): Record<string, PlayerLook> {
  const out: Record<string, PlayerLook> = {};
  for (const p of [...room.seats, ...(room.spectators ?? [])]) {
    const l = p && room.looks?.[p.token];
    if (p && l) out[p.name] = l;
  }
  return out;
}

/** Client device id (random, stored in the browser). */
export const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ACCOUNT_TIMEOUT_MS = 5000;
const SESSION_RECHECK_MS = 30_000;
const ACCOUNT_DOWN = "Máy chủ tài khoản đang lỗi, thử lại sau";
const NEED_LOGIN = "Cần đăng nhập";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error("timeout")), ms)))]).finally(() => clearTimeout(t));
}

const newId = (len = 8) => randomBytes(len).toString("base64url").slice(0, len);

export function replacedBy(state: LookRoom, conn: { role: string; userId: string | null; token: string | null }): boolean {
  return conn.role === "player" && !!conn.userId && state.seats.some((p) => p?.uid === conn.userId && p.token !== conn.token);
}

export class RoomHub<S extends CodedRoom = CodedRoom> {
  private rooms = new Map<string, LocalRoom>();

  constructor(
    readonly store: RoomStore<S>,
    readonly adapter: GameAdapter<S>,
  ) {}

  /**
   * Load → apply → compare-and-swap, retrying on conflicts. `fn` mutates the draft in place.
   * A game that finished in the committed change is added to the leaderboard.
   * `discard(result)` true = throw the draft away (e.g. a command that was refused must not save half-done changes).
   */
  async mutate<T>(
    code: string,
    fn: (room: S, now: number) => T,
    discard?: (result: T) => boolean,
  ): Promise<{ found: false } | { found: true; result: T }> {
    // The first attempt starts from this instance's newest copy when it has one, skipping a store read;
    // if that copy is stale the compare-and-swap refuses it and the next attempts read the store.
    let useCached = true;
    for (let attempt = 0; attempt < 12; attempt++) {
      let cur = useCached ? this.cached(code) : null;
      const fromCache = !!cur;
      useCached = false;
      if (!cur) {
        const loaded = await this.store.load(code);
        if (!loaded) return { found: false };
        cur = this.remember(code, JSON.stringify(loaded.state), loaded.version);
      }
      const before = cur.json;
      const draft = JSON.parse(before) as S;
      const result = fn(draft, Date.now());
      const after = discard?.(result) ? before : JSON.stringify(draft);
      if (after === before) {
        // Refused or no change: nothing to save, so a cached copy was never checked against the store —
        // confirm on fresh data (e.g. "start" right after someone joined through another instance).
        if (fromCache) continue;
        return { found: true, result };
      }
      if (await this.store.save(draft, cur.version)) {
        this.remember(code, after, cur.version + 1);
        const rec: GameRecord | undefined = this.adapter.lastRecord(draft);
        if (rec && rec.id !== this.adapter.lastRecord(JSON.parse(before) as S)?.id) {
          await this.store.recordGame(rec).catch((err) => console.error("[be_game] leaderboard:", err));
          this.recordAccountResults(rec);
        }
        return { found: true, result };
      }
      // A stale cached copy is retried at once from the store; a race lost on fresh data backs off first.
      if (!fromCache) await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
    }
    throw new Error("Phòng đang bận, thử lại");
  }

  /** Feed the per-account leaderboard after the save; never awaited so Postgres cannot hold the room loop. */
  private recordAccountResults(rec: GameRecord) {
    const firsts = rec.results.filter((r) => r.rank === 0).length;
    const rows = rec.results.map((r) => ({ usernameKey: nameKey(r.name), points: r.delta, rank: r.rank === 0 && firsts > 1 ? 2 : r.rank + 1 })); // ranks start at 0 here, at 1 in the account store; shared firsts do not count as wins
    void (async () => {
      try {
        const svc = await withTimeout(getAccountService(), ACCOUNT_TIMEOUT_MS);
        await svc.store.recordResults(this.adapter.game, rec.id, new Date(rec.at), rows);
      } catch (err) {
        console.error("[be_game] account results:", err instanceof Error ? err.message : "error");
      }
    })();
  }

  private cached(code: string) {
    return this.rooms.get(code)?.latest ?? null;
  }

  /** Keep `json` as this instance's copy of the room if it is not older than the one held (only for rooms with local sockets). */
  private remember(code: string, json: string, version: number) {
    const entry = { json, version };
    const r = this.rooms.get(code);
    if (r && (!r.latest || version >= r.latest.version)) r.latest = entry;
    return entry;
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
      r = { conns: new Set(), unsubscribe: null, timer: null, refreshing: null, dirty: false, latest: null, want: 0 };
      this.rooms.set(code, r);
      const room = r;
      void this.store.subscribe(code, (version) => this.refresh(code, version)).then((unsub) => {
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

  /**
   * Push fresh views to this instance's sockets in the room and re-arm its timer. Coalesces bursts.
   * `version` (from a store notification) is the version to show at least; the store is only read
   * when this instance's own copy is older than that.
   */
  refresh(code: string, version?: number): Promise<void> {
    const r = this.rooms.get(code);
    if (!r) return Promise.resolve();
    if (version && version > r.want) r.want = version;
    if (r.refreshing) {
      r.dirty = true;
      return r.refreshing;
    }
    r.refreshing = (async () => {
      do {
        r.dirty = false;
        let cur = r.latest && r.latest.version >= r.want ? r.latest : null;
        if (!cur) {
          const loaded = await this.store.load(code).catch(() => null);
          if (!loaded) break;
          cur = this.remember(code, JSON.stringify(loaded.state), loaded.version);
        }
        const state = JSON.parse(cur.json) as S;
        const now = Date.now();
        const looks = looksByName(state as unknown as LookRoom);
        for (const conn of r.conns) {
          if (!conn.token) continue;
          const view = this.adapter.view(state, conn.token, conn.role, now);
          if (!view && replacedBy(state as unknown as LookRoom, conn)) {
            send(conn.socket, { type: "signedOut", reason: "replaced" });
            this.remove(conn);
            conn.socket.close(4001, "replaced");
            continue;
          }
          if (view) send(conn.socket, { type: "state", view: typeof view === "object" && Object.keys(looks).length ? { ...view, looks } : view });
        }
        // Replacing the last socket removes this local room; do not re-arm or refresh it again.
        if (this.rooms.get(code) !== r) break;
        this.arm(code, r, state, now);
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
  const conn: Conn = { socket, code: null, token: null, role: "player", userId: null, session: null, authCheckedAt: 0 };
  const now = opts.now ?? Date.now;
  const hubPromise: Promise<RoomHub> = opts.hub ? Promise.resolve(opts.hub) : getHub(opts.game ?? "tienlen");
  let closed = false;
  let windowStart = Date.now();
  let messagesInWindow = 0;
  let lastEmojiAt = 0;
  let lastChatAt = 0;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  if (opts.deadline) {
    const ms = opts.deadline.getTime() - Date.now() - RECONNECT_LEAD_MS;
    reconnectTimer = setTimeout(() => send(socket, { type: "reconnect" }), Math.max(ms, 5_000));
  }

  const ack = (id: number, res: Ack | Result) => send(socket, { type: "ack", id, ...res });

  /**
   * False, with the socket signed out and closed, once the account behind this connection logged out, was disabled or
   * changed its password. Rechecked at most every SESSION_RECHECK_MS on ANY message, so a client that stops sending
   * pings still loses a revoked session. An account-store outage keeps the connection (logged).
   */
  const sessionStillValid = async (): Promise<boolean> => {
    if (!conn.userId || !conn.session || now() - conn.authCheckedAt <= SESSION_RECHECK_MS) return true;
    conn.authCheckedAt = now();
    try {
      const svc = await withTimeout(getAccountService(), ACCOUNT_TIMEOUT_MS);
      const user = await withTimeout(svc.authenticate(conn.session), ACCOUNT_TIMEOUT_MS);
      if (!user) {
        send(socket, { type: "signedOut", reason: "revoked" });
        cleanup();
        socket.close(4001, "revoked");
        return false;
      }
    } catch (err) {
      console.error("[be_game] session recheck:", err instanceof Error ? err.message : "error");
    }
    return true;
  };

  /** Room-create limit per client IP; fails open (logged) when the limiter or the account service is down. */
  const mayCreateRoom = async (): Promise<boolean> => {
    try {
      const limiter = opts.limiter ?? (await withTimeout(getAccountService(), ACCOUNT_TIMEOUT_MS)).limiter;
      return await limiter.hit(`room-create:${opts.ip || "unknown"}`, ROOM_CREATES_PER_IP, ROOM_CREATE_WINDOW_SEC);
    } catch (err) {
      console.error("[be_game] room-create limiter:", err instanceof Error ? err.message : "error");
      return true;
    }
  };

  const handle = async (hub: RoomHub, msg: InMessage) => {
    const adapter = hub.adapter;
    if (!(await sessionStillValid())) return;
    if (msg.type === "ping") {
      send(socket, { type: "pong" });
      if (conn.code && conn.token) {
        const { token } = conn;
        await hub.mutate(conn.code, (room, now) => adapter.heartbeat(room, token, now));
      }
      return;
    }

    const id = Number(msg.id) || 0;
    if (msg.type === "create") {
      if (!(await mayCreateRoom())) return ack(id, { ok: false, error: ROOM_CREATE_LIMITED });
      return ack(id, { ok: true, code: await hub.createRoom() });
    }

    if (msg.type === "join" || msg.type === "watch") {
      const code = cleanCode(msg.code);
      const token = String(msg.token ?? "");
      if (accountsConfigError()) return ack(id, { ok: false, error: ACCOUNTS_UNCONFIGURED });
      let svc: AccountService;
      let user: Awaited<ReturnType<AccountService["authenticate"]>>;
      try {
        svc = await withTimeout(getAccountService(), ACCOUNT_TIMEOUT_MS);
        user = await withTimeout(svc.authenticate(typeof msg.session === "string" ? msg.session : null), ACCOUNT_TIMEOUT_MS);
      } catch (err) {
        console.error("[be_game] account auth:", err instanceof Error ? err.message : "error");
        return ack(id, { ok: false, error: ACCOUNT_DOWN });
      }
      if (!user) return ack(id, { ok: false, error: NEED_LOGIN });
      // The account decides name and look; whatever the client sent is ignored.
      const name = user.username;
      const look: PlayerLook = { icon: user.icon, color: user.color };
      const res = await hub.mutate(
        code,
        (room, now): Result => {
          const r = msg.type === "join" ? adapter.join(room, token, name, now, newId, user.id) : adapter.watch(room, token, name, now);
          if (!r.ok) return r;
          if (msg.type === "join") {
            // A seat kept by token mid-game keeps its old name: never take over another account's seat.
            const seat = (room as unknown as LookRoom).seats.find((p) => p?.token === token);
            if (seat && (seat.uid ? seat.uid !== user.id : seat.name !== cleanName(name))) return { ok: false, error: "Ghế này thuộc tài khoản khác" };
          }
          setLook(room as unknown as LookRoom, token, look);
          return r;
        },
        (r) => !r.ok,
      );
      if (!res.found) return ack(id, { ok: false, error: "Không tìm thấy phòng" });
      if (!res.result.ok) return ack(id, res.result);
      if (conn.code && conn.code !== code) hub.remove(conn);
      conn.code = code;
      conn.token = token;
      conn.userId = user.id;
      conn.session = typeof msg.session === "string" ? msg.session : null;
      conn.authCheckedAt = now();
      conn.role = msg.type === "join" ? "player" : "spectator";
      hub.add(conn, code);
      ack(id, { ok: true });
      if (typeof msg.device === "string" && DEVICE_RE.test(msg.device)) {
        svc.store
          .trackView({ path: `/play/${adapter.game}`, device: msg.device, userId: user.id })
          .catch((err) => console.error("[be_game] track:", err instanceof Error ? err.message : "error"));
      }
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

    if (msg.type === "look") {
      // The payload is ignored: the look always comes from the account's current profile.
      if (accountsConfigError()) return ack(id, { ok: false, error: ACCOUNTS_UNCONFIGURED });
      if (!conn.userId) return ack(id, { ok: false, error: NEED_LOGIN });
      const userId = conn.userId;
      let user: Awaited<ReturnType<AccountService["store"]["userById"]>>;
      try {
        user = await withTimeout((await withTimeout(getAccountService(), ACCOUNT_TIMEOUT_MS)).store.userById(userId), ACCOUNT_TIMEOUT_MS);
      } catch (err) {
        console.error("[be_game] account auth:", err instanceof Error ? err.message : "error");
        return ack(id, { ok: false, error: ACCOUNT_DOWN });
      }
      if (!user || user.disabled) return ack(id, { ok: false, error: NEED_LOGIN });
      const look: PlayerLook = { icon: user.icon, color: user.color };
      const res = await hub.mutate(code, (room) => setLook(room as unknown as LookRoom, token, look));
      return ack(id, res.found ? { ok: true } : { ok: false, error: "Không tìm thấy phòng" });
    }

    if (msg.type === "emoji") {
      const now = Date.now();
      if (now - lastEmojiAt < EMOJI_COOLDOWN_MS) return ack(id, { ok: false, error: "Chậm lại một chút" });
      lastEmojiAt = now;
      const res = await hub.mutate(code, (room, t) => adapter.react(room, token, msg.emoji, t));
      return ack(id, res.found ? res.result : { ok: false, error: "Không tìm thấy phòng" });
    }

    if (msg.type === "chat") {
      const now = Date.now();
      if (now - lastChatAt < CHAT_COOLDOWN_MS) return ack(id, { ok: false, error: "Chậm lại một chút" });
      lastChatAt = now;
      // Every game's room has the shared social fields (seats, spectators, chat).
      const res = await hub.mutate(code, (room, t) => sendChat(room as unknown as SocialRoom, token, msg.text, t));
      return ack(id, res.found ? res.result : { ok: false, error: "Không tìm thấy phòng" });
    }

    if (conn.role === "spectator") return ack(id, { ok: false, error: "Khán giả không thể thao tác" });
    // A refused command is not saved, whatever it changed before failing.
    const res = await hub.mutate(
      code,
      (room, now) => adapter.command(room, token, msg, now),
      (r) => !r.ok,
    );
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
      if (closed) return;
      try {
        const hub = await hubPromise;
        if (!closed) await handle(hub, msg);
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

const originList = (env: NodeJS.ProcessEnv) =>
  (env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** An origin pattern: scheme://host[:port], `*` wildcards in the host only, no path or trailing slash. */
const ORIGIN_PATTERN_RE = /^https?:\/\/[a-z0-9*.-]+(:\d{1,5})?$/i;
/**
 * Hosts anyone can get a subdomain of. No wildcard is allowed anywhere under them: even a pattern scoped by project and
 * team name (zonenop-game-*-<team>.vercel.app) matches a project someone else names to fit. List exact origins instead.
 */
const SHARED_HOSTS = ["vercel.app"];

/**
 * Why ALLOWED_ORIGIN is not usable in production, or null when it is (or when this is not production, where an
 * empty list stays open for local development). Production = NODE_ENV=production (the Docker image) or Vercel.
 * The message names the bad entry but this variable holds no secrets.
 */
export function originConfigError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== "production" && !env.VERCEL) return null;
  const list = originList(env);
  if (list.length === 0) return "ALLOWED_ORIGIN is empty: list the frontend origins, comma-separated";
  for (const entry of list) {
    if (entry === "*") return "ALLOWED_ORIGIN contains a lone *, which admits every site";
    if (!ORIGIN_PATTERN_RE.test(entry)) return `ALLOWED_ORIGIN entry ${JSON.stringify(entry)} is not scheme://host[:port] (no path, no trailing slash)`;
    const host = entry.replace(/^https?:\/\//i, "").replace(/:\d+$/, "").toLowerCase();
    // A wildcard must be followed by at least two literal labels (".example.com"): "https://*", "https://*.app"
    // or "https://*vercel.app" would admit sites anyone can create.
    if (host.includes("*") && !/\.[a-z0-9-]+\.[a-z0-9-]+$/.test(host.slice(host.lastIndexOf("*") + 1)))
      return `ALLOWED_ORIGIN entry ${JSON.stringify(entry)} has a wildcard without two fixed labels after it (e.g. *.example.com)`;
    const shared = SHARED_HOSTS.find((h) => host.includes("*") && host.endsWith(`.${h}`));
    if (shared) return `ALLOWED_ORIGIN entry ${JSON.stringify(entry)} has a wildcard under ${shared}, where anyone can create a matching site; list exact origins`;
  }
  return null;
}

/** Called when the server is created: production refuses to start with an unusable allow-list (D2-a). */
export function assertOriginConfig(env: NodeJS.ProcessEnv = process.env): void {
  const why = originConfigError(env);
  if (why) throw new Error(`[be_game] refusing to start: ${why}`);
}

/**
 * Origin check for the WebSocket upgrade and CORS. Production always has a list (assertOriginConfig); in
 * development an unset ALLOWED_ORIGIN accepts every origin. Comma-separated, `*` wildcards,
 * e.g. "https://my-site.com,https://my-app-*-my-team.vercel.app". Requests without Origin (non-browser
 * clients) and same-host pages are always accepted: this is not authentication.
 */
export function isAllowedOrigin(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return true; // non-browser clients
  const allowed = originList(process.env);
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
