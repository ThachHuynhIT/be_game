import { getRedis, redisUrl } from "../server/store";
import { hashPassword, verifyPassword } from "./password";
import { type RateLimiter, memoryRateLimiter, redisRateLimiter } from "./rateLimit";
import { readSession, signSession } from "./session";
import { type AccountStore, createMemoryAccountStore } from "./store";
import type { Role, UserRow } from "./types";
import { normalizeUsername, validatePassword } from "./username";

export type PublicUser = { id: string; username: string; role: Role; icon: string; color: string };
export type AdminUser = { id: string; username: string; role: Role; disabled: boolean; createdAt: string; lastLoginAt: string | null; games: number };
export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

// Copied from zonenop-game src/components/games/gameClient.ts.
export const PROFILE_ICONS: readonly string[] = ["🐱", "🐈", "🐈‍⬛", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "🐆", "🦁", "😀", "😎", "🤠", "🐶", "🦊", "🐼", "🐯", "🦄", "🐲", "🐴", "👑", "🎩", "💎", "🔥", "⭐"];
export const PROFILE_COLORS: readonly string[] = ["#fbbf24", "#f87171", "#fb923c", "#a3e635", "#34d399", "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#e5e7eb"];
const DEFAULT_ICON = "";
const DEFAULT_COLOR = "#fbbf24";

const validIcon = (v: unknown) => (typeof v === "string" && (v === "" || PROFILE_ICONS.includes(v)) ? v : DEFAULT_ICON);
const validColor = (v: unknown) => (typeof v === "string" && PROFILE_COLORS.includes(v) ? v : DEFAULT_COLOR);

export const BAD_LOGIN = "Sai tên đăng nhập hoặc mật khẩu";
export const TOO_MANY = "Thử quá nhiều lần, đợi một lát rồi thử lại";
const CACHE_MS = 60_000;

export const publicUser = (u: UserRow): PublicUser => ({ id: u.id, username: u.username, role: u.role, icon: u.icon, color: u.color });

export interface AccountService {
  store: AccountStore;
  limiter: RateLimiter;
  register(input: { username: string; password: string; icon?: string; color?: string }, ip: string): Promise<Result<{ session: string; user: PublicUser }>>;
  login(input: { username: string; password: string }, ip: string): Promise<Result<{ session: string; user: PublicUser }>>;
  /** Cached 60 s by uid; disabled or session-version mismatch gives null. */
  authenticate(token: string | null): Promise<UserRow | null>;
  /** Drops the cache entry (logout, password change, disable, role change). */
  forget(uid: string): void;
  logout(user: UserRow): Promise<void>;
  updateMe(user: UserRow, patch: { icon?: string; color?: string; password?: string; oldPassword?: string }): Promise<Result<{ user: PublicUser; session?: string }>>;
  adminUpdate(admin: UserRow, id: string, patch: { role?: Role; disabled?: boolean; password?: string }): Promise<Result<{ user: AdminUser }>>;
}

let warnedShort = false;

/** Signing secret; null when it must be configured (production without SESSION_SECRET). */
export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SESSION_SECRET) {
    if (!warnedShort && Buffer.byteLength(env.SESSION_SECRET) < 32) {
      warnedShort = true;
      console.warn("[be_game] SESSION_SECRET is shorter than 32 bytes; use a longer random value.");
    }
    return env.SESSION_SECRET;
  }
  if (isProduction(env)) return null;
  return "dev-insecure-secret";
}

const isProduction = (env: NodeJS.ProcessEnv) => env.NODE_ENV === "production" || !!env.VERCEL;

export const ACCOUNTS_UNCONFIGURED = "Máy chủ chưa cấu hình đăng nhập";

/**
 * Names of the env vars that keep accounts from running, or null when they can run. In production a missing
 * DATABASE_URL would silently give a per-instance memory store (accounts lost on restart), so it is refused
 * unless ACCOUNTS_MEMORY=1 opts in. Only variable names are returned, never values.
 */
export function accountsConfigError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isProduction(env)) return null;
  const missing: string[] = [];
  if (!env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!env.DATABASE_URL && env.ACCOUNTS_MEMORY !== "1") missing.push("DATABASE_URL (or ACCOUNTS_MEMORY=1)");
  return missing.length ? `missing ${missing.join(", ")}` : null;
}

let warnedUnconfigured = false;

/** Loud, once per process: called when the server is created. */
export function warnIfAccountsUnconfigured(env: NodeJS.ProcessEnv = process.env): void {
  const why = accountsConfigError(env);
  if (!why || warnedUnconfigured) return;
  warnedUnconfigured = true;
  console.error(`[be_game] ACCOUNTS UNCONFIGURED (${why}): sign-in, admin, tracking and joining games are refused until it is set.`);
}

const adminKeys = () =>
  new Set(
    (process.env.ADMIN_USERNAMES ?? "")
      .split(",")
      .map((s) => normalizeUsername(s))
      .flatMap((r) => (r.ok ? [r.key] : [])),
  );

/** Rate limiter that fails open: a Redis outage must not lock everyone out. Logs at most once a minute. */
function failOpen(inner: RateLimiter): RateLimiter {
  let lastLog = 0;
  return {
    async hit(bucket, limit, windowSec) {
      try {
        return await inner.hit(bucket, limit, windowSec);
      } catch (e) {
        const now = Date.now();
        if (now - lastLog >= 60_000) {
          lastLog = now;
          console.error("[be_game] rate limiter unavailable, allowing requests:", e instanceof Error ? e.message : "error");
        }
        return true;
      }
    },
  };
}

let dummyHash: Promise<string> | null = null;

export function createAccountService(store: AccountStore, limiter: RateLimiter, now: () => number = Date.now): AccountService {
  const cache = new Map<string, { user: UserRow; until: number }>();
  const fail = (status: number, error: string) => ({ ok: false as const, status, error });
  const lim = failOpen(limiter);

  const issue = (u: UserRow) => {
    const secret = sessionSecret();
    if (!secret) throw new Error("SESSION_SECRET is not configured");
    return signSession({ uid: u.id, ver: u.sessionVersion }, secret, now());
  };
  const promote = async (u: UserRow): Promise<UserRow> => {
    if (u.role === "user" && adminKeys().has(u.usernameKey)) return (await store.updateUser(u.id, { role: "admin" })) ?? u;
    return u;
  };
  const adminUser = async (u: UserRow): Promise<AdminUser> => {
    const found = await store.listUsers(u.username, 1, 50);
    const games = found.rows.find((r) => r.id === u.id)?.games ?? 0;
    return { id: u.id, username: u.username, role: u.role, disabled: u.disabled, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null, games };
  };

  const svc: AccountService = {
    store,
    limiter: lim,

    async register(input, ip) {
      if (!(await lim.hit(`reg:ip:${ip}`, 5, 3600))) return fail(429, TOO_MANY);
      const name = normalizeUsername(input.username);
      if (!name.ok) return fail(400, name.error);
      const pwErr = validatePassword(input.password);
      if (pwErr) return fail(400, pwErr);
      const hash = await hashPassword(input.password);
      let user = await store.createUser({ usernameKey: name.key, username: name.username, passwordHash: hash, role: "user", icon: validIcon(input.icon), color: validColor(input.color) });
      if (!user) return fail(409, "Tên đăng nhập đã có người dùng");
      user = await promote(user);
      user = (await store.updateUser(user.id, { lastLoginAt: new Date(now()) })) ?? user;
      return { ok: true, session: issue(user), user: publicUser(user) };
    },

    async login(input, ip) {
      if (!(await lim.hit(`login:ip:${ip}`, 10, 900))) return fail(429, TOO_MANY);
      const name = normalizeUsername(input.username);
      // Invalid names get no per-user bucket (never key a bucket by a raw request string).
      if (name.ok && !(await lim.hit(`login:user:${name.key}`, 5, 900))) return fail(429, TOO_MANY);
      const password = typeof input.password === "string" ? input.password : "";
      const found = name.ok ? await store.userByKey(name.key) : null;
      if (!found) {
        // Equalise timing with a real verification so unknown usernames are not detectable.
        dummyHash ??= hashPassword("dummy-password").catch((e) => {
          dummyHash = null;
          throw e;
        });
        await verifyPassword(password, await dummyHash).catch(() => false);
        return fail(401, BAD_LOGIN);
      }
      if (!(await verifyPassword(password, found.passwordHash)) || found.disabled) return fail(401, BAD_LOGIN);
      let user = await promote(found);
      user = (await store.updateUser(user.id, { lastLoginAt: new Date(now()) })) ?? user;
      cache.delete(user.id);
      return { ok: true, session: issue(user), user: publicUser(user) };
    },

    async authenticate(token) {
      if (!token) return null;
      const secret = sessionSecret();
      if (!secret) return null;
      const s = readSession(token, secret, now());
      if (!s) return null;
      const t = now();
      let user: UserRow | null;
      const hit = cache.get(s.uid);
      // A token newer than the cached row was issued by another instance after a bump: re-read instead of rejecting it.
      if (hit && hit.until > t && hit.user.sessionVersion >= s.ver) user = hit.user;
      else {
        user = await store.userById(s.uid);
        if (user) cache.set(s.uid, { user, until: t + CACHE_MS });
        else cache.delete(s.uid);
      }
      if (!user || user.disabled || user.sessionVersion !== s.ver) return null;
      return user;
    },

    forget(uid) {
      cache.delete(uid);
    },

    async logout(user) {
      await store.updateUser(user.id, { bumpSession: true });
      cache.delete(user.id);
    },

    async updateMe(user, patch) {
      const upd: Parameters<AccountStore["updateUser"]>[1] = {};
      if (patch.icon !== undefined) {
        if (typeof patch.icon !== "string" || (patch.icon !== "" && !PROFILE_ICONS.includes(patch.icon))) return fail(400, "Biểu tượng không hợp lệ");
        upd.icon = patch.icon;
      }
      if (patch.color !== undefined) {
        if (typeof patch.color !== "string" || !PROFILE_COLORS.includes(patch.color)) return fail(400, "Màu không hợp lệ");
        upd.color = patch.color;
      }
      const changingPassword = patch.password !== undefined;
      if (changingPassword) {
        const err = validatePassword(patch.password as string);
        if (err) return fail(400, err);
        if (typeof patch.oldPassword !== "string" || !(await verifyPassword(patch.oldPassword, user.passwordHash))) return fail(400, "Mật khẩu cũ không đúng");
        upd.passwordHash = await hashPassword(patch.password as string);
        upd.bumpSession = true;
      }
      const next = (await store.updateUser(user.id, upd)) ?? user;
      cache.delete(user.id);
      return { ok: true, user: publicUser(next), ...(changingPassword ? { session: issue(next) } : {}) };
    },

    async adminUpdate(admin, id, patch) {
      if (id === admin.id && ((patch.role !== undefined && patch.role !== "admin") || patch.disabled === true)) return fail(400, "Không thể tự hạ quyền hoặc tự khoá chính mình");
      if (patch.role !== undefined && patch.role !== "user" && patch.role !== "admin") return fail(400, "Vai trò không hợp lệ");
      if (patch.disabled !== undefined && typeof patch.disabled !== "boolean") return fail(400, "Giá trị khoá không hợp lệ");
      const upd: Parameters<AccountStore["updateUser"]>[1] = {};
      if (patch.role !== undefined) upd.role = patch.role;
      if (patch.disabled !== undefined) upd.disabled = patch.disabled;
      // Locking revokes every issued token (spec §7): unlocking later must not revive them.
      if (patch.disabled === true) upd.bumpSession = true;
      if (patch.password !== undefined) {
        const err = validatePassword(patch.password);
        if (err) return fail(400, err);
        upd.passwordHash = await hashPassword(patch.password);
        upd.bumpSession = true;
      }
      const next = await store.updateUser(id, upd);
      if (!next) return fail(404, "Không tìm thấy người dùng");
      cache.delete(id);
      return { ok: true, user: await adminUser(next) };
    },
  };
  return svc;
}

let singleton: Promise<AccountService> | null = null;
/** Overall init budget: a hung connect/migration must not be cached forever. */
const INIT_TIMEOUT_MS = 15_000;
let testInit: { build?: () => Promise<AccountService>; timeoutMs?: number } = {};

/** Drops the process-wide service; tests may swap the builder or the init timeout. */
export function resetAccountServiceForTests(opts: { build?: () => Promise<AccountService>; timeoutMs?: number } = {}) {
  singleton = null;
  testInit = opts;
}

async function build(): Promise<AccountService> {
  let store: AccountStore;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const { createPgAccountStore } = await import("./pg");
    const local = /@(localhost|127\.0\.0\.1|\[::1\])([:/?]|$)/.test(url);
    const ssl = /sslmode=require/.test(url) || !local ? { rejectUnauthorized: true } : undefined;
    const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, ssl });
    pool.on("error", (e) => console.error("[be_game] pg pool:", e.message));
    try {
      store = await createPgAccountStore(pool);
    } catch (e) {
      pool.end().catch(() => {}); // the next call builds a fresh pool
      throw e;
    }
  } else {
    store = createMemoryAccountStore();
  }
  let limiter: RateLimiter;
  const redis = redisUrl() ? await getRedis().catch(() => null) : null;
  limiter = redis ? redisRateLimiter(redis as any) : memoryRateLimiter();
  const svc = createAccountService(store, limiter);
  void store.pruneViews(180).catch((e) => console.error("[be_game] pruneViews failed:", e instanceof Error ? e.message : "error"));
  return svc;
}

/** Process-wide service: Postgres if DATABASE_URL, else memory; Redis limiter if configured, else memory. A failed or timed-out init is retried next call. */
export function getAccountService(): Promise<AccountService> {
  // Never cached: setting the env (and restarting) is the fix, but a misconfigured process must not build a memory store.
  if (accountsConfigError()) return Promise.reject(new Error("accounts unconfigured"));
  if (!singleton) {
    const ms = testInit.timeoutMs ?? INIT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const p = Promise.race([
      (testInit.build ?? build)(),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`account service init timed out after ${ms}ms`)), ms))),
    ]).finally(() => clearTimeout(timer));
    singleton = p;
    p.catch(() => {
      if (singleton === p) singleton = null;
    });
  }
  return singleton;
}
