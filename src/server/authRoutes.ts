import type { IncomingMessage, ServerResponse } from "node:http";
import { type AccountService, TOO_MANY, getAccountService, publicUser, sessionSecret } from "../accounts/service";

const MAX_BODY = 4096;
const STORE_TIMEOUT_MS = 5000;
const UNAVAILABLE = "Máy chủ tài khoản đang lỗi, thử lại sau";
const NEED_LOGIN = "Cần đăng nhập";
const BOT_RE = /bot|crawl|spider|preview|monitor/i;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) return void res.writeHead(status, { "cache-control": "no-store" }).end();
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}
const err = (res: ServerResponse, status: number, error: string) => send(res, status, { ok: false, error });

export function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  const cf = req.headers["cf-connecting-ip"];
  const ip = first || (Array.isArray(cf) ? cf[0] : cf)?.trim() || req.socket.remoteAddress || "unknown";
  return ip.slice(0, 64);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Dữ liệu gửi lên quá lớn");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("shape");
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Dữ liệu không hợp lệ");
  }
}

const withTimeout = <T>(p: Promise<T>): Promise<T> => {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error("account store timed out")), STORE_TIMEOUT_MS)))]).finally(() => clearTimeout(t)) as Promise<T>;
};

const bearer = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  const m = typeof h === "string" ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m ? m[1] : null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Strips query/hash; must start with "/" and be ≤ 200 chars. */
export function normalizeTrackPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.split("#")[0].split("?")[0];
  return p.startsWith("/") && p.length <= 200 ? p : null;
}

/** Handles /api/auth/*, /api/admin/* and /api/track. Returns true when the request was handled. */
export async function handleAccountRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const isAuth = path.startsWith("/api/auth/");
  const isAdmin = path.startsWith("/api/admin/");
  if (!isAuth && !isAdmin && path !== "/api/track") return false;
  try {
    if (!sessionSecret()) {
      err(res, 503, "Máy chủ chưa cấu hình đăng nhập");
      return true;
    }
    await withTimeout(dispatch(req, res, path));
  } catch (e) {
    if (res.headersSent) return true;
    if (e instanceof HttpError) err(res, e.status, e.message);
    else {
      console.error("[be_game] account route failed:", e instanceof Error ? e.message : "error");
      err(res, 503, UNAVAILABLE);
    }
  }
  return true;
}

async function dispatch(req: IncomingMessage, res: ServerResponse, path: string) {
  const method = req.method ?? "GET";
  const svc = await getAccountService();
  const ip = clientIp(req);
  const methodNotAllowed = () => err(res, 405, "Method not allowed");

  if (path === "/api/track") {
    if (method !== "POST") return methodNotAllowed();
    return track(req, res, svc, ip);
  }
  if (path === "/api/auth/register" || path === "/api/auth/login") {
    if (method !== "POST") return methodNotAllowed();
    const body = await readJson(req);
    const r =
      path === "/api/auth/register"
        ? await svc.register({ username: str(body.username), password: str(body.password), icon: body.icon as string | undefined, color: body.color as string | undefined }, ip)
        : await svc.login({ username: str(body.username), password: str(body.password) }, ip);
    return r.ok ? send(res, 200, { ok: true, session: r.session, user: r.user }) : err(res, r.status, r.error);
  }

  const user = await svc.authenticate(bearer(req));
  if (path === "/api/auth/logout") {
    if (method !== "POST") return methodNotAllowed();
    if (user) await svc.logout(user);
    return send(res, 200, { ok: true });
  }
  if (path === "/api/auth/me") {
    if (method !== "GET" && method !== "PATCH") return methodNotAllowed();
    if (!user) return err(res, 401, NEED_LOGIN);
    if (method === "GET") return send(res, 200, { ok: true, user: publicUser(user) });
    const b = await readJson(req);
    const r = await svc.updateMe(user, {
      icon: b.icon as string | undefined,
      color: b.color as string | undefined,
      password: b.password as string | undefined,
      oldPassword: b.oldPassword as string | undefined,
    });
    return r.ok ? send(res, 200, { ok: true, user: r.user, ...(r.session ? { session: r.session } : {}) }) : err(res, r.status, r.error);
  }

  if (path.startsWith("/api/admin/")) {
    if (!user) return err(res, 401, NEED_LOGIN);
    if (user.role !== "admin") return err(res, 403, "Không có quyền truy cập");
    const url = new URL(req.url ?? "/", "http://x");
    if (path === "/api/admin/stats") {
      if (method !== "GET") return methodNotAllowed();
      const days = Number(url.searchParams.get("days") ?? "7");
      if (![7, 30, 90].includes(days)) return err(res, 400, "days phải là 7, 30 hoặc 90");
      return send(res, 200, await svc.store.stats(days));
    }
    if (path === "/api/admin/users") {
      if (method !== "GET") return methodNotAllowed();
      const q = (url.searchParams.get("q") ?? "").slice(0, 50);
      const page = Math.max(1, Math.min(10_000, Math.floor(Number(url.searchParams.get("page") ?? "1")) || 1));
      const { rows, total } = await svc.store.listUsers(q, page, 50);
      const users = rows.map((u) => ({ id: u.id, username: u.username, role: u.role, disabled: u.disabled, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null, games: u.games }));
      return send(res, 200, { users, total, page, pageSize: 50 });
    }
    const m = /^\/api\/admin\/users\/([^/]+)$/.exec(path);
    if (m) {
      if (method !== "PATCH") return methodNotAllowed();
      const b = await readJson(req);
      const r = await svc.adminUpdate(user, decodeURIComponent(m[1]), { role: b.role as any, disabled: b.disabled as any, password: b.password as any });
      return r.ok ? send(res, 200, { ok: true, user: r.user }) : err(res, r.status, r.error);
    }
  }
  err(res, 404, "Not found");
}

async function track(req: IncomingMessage, res: ServerResponse, svc: AccountService, ip: string) {
  const ua = String(req.headers["user-agent"] ?? "");
  if (BOT_RE.test(ua)) return send(res, 204);
  if (!(await svc.limiter.hit(`track:ip:${ip}`, 60, 60))) return err(res, 429, TOO_MANY);
  const b = await readJson(req);
  const path = normalizeTrackPath(b.path);
  if (!path) return err(res, 400, "path không hợp lệ");
  if (typeof b.device !== "string" || !DEVICE_RE.test(b.device)) return err(res, 400, "device không hợp lệ");
  const user = await svc.authenticate(bearer(req)).catch(() => null);
  await svc.store.trackView({ path, device: b.device, userId: user?.id ?? null });
  send(res, 204);
}
