# Accounts, per-account leaderboard and admin stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bắt buộc đăng nhập bằng tài khoản (username, mật khẩu, role), bảng điểm mùa mới theo tài khoản, thống kê truy cập/chơi và trang `/admin` — dùng chung Neon Postgres cho cả hai backend.

**Architecture:** be_game có module `src/accounts/` (store Postgres + store bộ nhớ cùng interface, mật khẩu scrypt, token phiên HMAC, giới hạn số lần thử bằng Redis) và các route `/api/auth/*`, `/api/admin/*`, `/api/track`; hub đòi phiên khi join và ghi `game_results`. zonenop-game có `src/components/auth/` (phiên trong localStorage, gửi kèm mọi request/join), trang `/dang-nhap`, menu tài khoản, tab bảng điểm, beacon theo dõi, trang `/admin` (Recharts, nạp lười).

**Tech Stack:** be_game: Node 22, TypeScript, `pg` 8 (mới), `pg-mem` 3 (dev, mới), ioredis 5, vitest. zonenop-game: Next 16, React 19, Tailwind 4, game-ui, `recharts` 2 (mới), vitest, Playwright (`playwright-core` ở `%TEMP%/shots`, Edge).

**Spec:** `docs/superpowers/specs/2026-10-16-accounts-admin-design.md` (repo be_game)

## Global Constraints

- be_game: nhánh `feature/accounts` tạo từ `docs/accounts-admin-spec`, PR vào `main`. zonenop-game: nhánh `feature/accounts` từ `develop`, PR vào `develop`.
- Bí mật (`DATABASE_URL`, `SESSION_SECRET`, mật khẩu, token phiên) không bao giờ được commit, log, in trong test output hay trả về trong response. Hash mật khẩu không bao giờ ra khỏi store.
- Không đổi luật game, cách tính điểm, CAS/`SAVE_SCRIPT`, token ghế (vào lại bàn).
- Username: 3–20 ký tự, regex `^[\p{L}\p{N}_.]+( [\p{L}\p{N}_.]+)*$` (u-flag) sau NFC + trim + gộp khoảng trắng; khoá so trùng = `nameKey()` hiện có (lowercase). Mật khẩu 8–72 ký tự.
- scrypt N=32768 (2^15), r=8, p=1, keylen 32, salt 16 byte, `maxmem` 64 MiB; chuỗi lưu `scrypt$32768$8$1$<salt b64>$<hash b64>`.
- Token phiên: `<b64url(JSON {uid, ver, exp})>.<b64url(HMAC-SHA256)>`, hạn 30 ngày (`exp` = epoch giây). Thiếu `SESSION_SECRET` thì: production (`NODE_ENV=production` hoặc `VERCEL`) → route auth trả 503 "Máy chủ chưa cấu hình đăng nhập"; dev/test → secret cố định `"dev-insecure-secret"`.
- Giới hạn: register 5/giờ/IP; login 10/15 phút/IP và 5/15 phút/username; track 60/phút/IP. Vượt → 429 `{ok:false,error:"Thử quá nhiều lần, đợi một lát rồi thử lại"}`.
- Lỗi đăng nhập luôn là `"Sai tên đăng nhập hoặc mật khẩu"` (không lộ username có tồn tại không).
- Chữ hiển thị tiếng Việt; code/comment tiếng Anh như repo.
- Trước mỗi commit: be_game `npm run typecheck && npx vitest run --dir test`; zonenop-game `npm run lint && npm run typecheck && npm test` (task có UI: thêm `npx next build`).
- Commit kết thúc bằng dòng trống rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## API contract (cả hai repo dựa vào; không đổi tên trường)

```ts
// be_game → client
type PublicUser = { id: string; username: string; role: "user" | "admin"; icon: string; color: string };
// POST /api/auth/register  {username, password, icon?, color?} → 200 {ok:true, session, user} | 400/409/429 {ok:false, error}
// POST /api/auth/login     {username, password}               → 200 {ok:true, session, user} | 401/429 {ok:false, error}
// POST /api/auth/logout    Bearer                             → 200 {ok:true}
// GET  /api/auth/me        Bearer                             → 200 {ok:true, user} | 401 {ok:false, error:"Cần đăng nhập"}
// PATCH /api/auth/me       Bearer {icon?, color?, password?, oldPassword?} → 200 {ok:true, user, session?}  (session mới khi đổi mật khẩu)
// POST /api/track          {path, device} (+Bearer tuỳ chọn)   → 204
// GET  /api/<game>/leaderboard[?season=old]                   → mùa này: {season:"current", rows: LeaderRow[]}; old: định dạng cũ
type LeaderRow = { name: string; points: number; games: number; wins: number; icon: string; color: string };
// GET  /api/admin/stats?days=7|30|90   Bearer(admin) → AdminStats
type AdminStats = {
  days: number;
  totals: { users: number; newUsers: number; views: number; devices: number; games: number; players: number; playDevices: number };
  daily: { day: string; views: number; devices: number; games: number; players: number; newUsers: number }[]; // đủ `days` ngày, cũ → mới, ngày trống = 0
  byGame: { game: string; games: number; players: number }[];
  topPages: { path: string; views: number }[];   // 10
  topPlayers: { name: string; games: number; points: number }[]; // 10
};
// GET  /api/admin/users?q=&page=1      Bearer(admin) → {users: AdminUser[], total, page, pageSize: 50}
type AdminUser = { id: string; username: string; role: "user"|"admin"; disabled: boolean; createdAt: string; lastLoginAt: string|null; games: number };
// PATCH /api/admin/users/<id>  Bearer(admin) {role?, disabled?, password?} → {ok:true, user: AdminUser} | 400/403/404
// WS join/watch: {type, code, name, token, look, session, device} → thiếu/sai session: ack {ok:false, error:"Cần đăng nhập"}
// GET /api/health thêm `accounts: "postgres" | "memory"`
```
Header `Authorization: Bearer <session>`. CORS cho phép header `Authorization, Content-Type` và method `GET, POST, PATCH, OPTIONS` (preflight `OPTIONS` → 204).

## Review Focus

1. **Hai máy cùng ghi một ván** → `game_results` chỉ một dòng mỗi người (PK + `ON CONFLICT DO NOTHING`). Test ở Task B2.
2. **Username khác hoa thường / dấu cách thừa** ("Lan", " lan ", "LAN") là cùng một tài khoản; đăng ký trùng → 409. Test ở Task B1/B4.
3. **Token sau khi đăng xuất / đổi mật khẩu / bị khoá** phải bị từ chối, cả HTTP lẫn WS join (kể cả qua cache 60 s: thao tác đó xoá cache của user). Test ở Task B4/B5.
4. **Người không phải admin gọi route admin** → 403; admin tự hạ quyền/tự khoá mình → 400. Test ở Task B4.
5. **Neon lỗi / chậm** → route auth trả 503 tiếng Việt trong ≤ 5 s (timeout), ván chơi không hỏng khi ghi `game_results` lỗi. Test ở Task B4/B5 (store giả ném lỗi).

---

## Luồng thực thi

Hai luồng song song (hai repo, không đụng file của nhau):
- **be_game:** B1 → B2 → B3 → B4 → B5 → B6.
- **zonenop-game:** Z1 → Z2 → Z3 → Z4 → Z5 → Z6 (Z1–Z5 dùng API contract ở trên; Z6 chạy e2e với be_game nhánh `feature/accounts` khi B5 xong).

---

### Task B1: be_game — account store (users) + migrations

**Files:**
- Create: `src/accounts/types.ts`, `src/accounts/store.ts` (interface + `createMemoryAccountStore`), `src/accounts/pg.ts` (`createPgAccountStore`), `src/accounts/migrations.ts`, `test/accounts-store.test.ts`
- Modify: `package.json`, `package-lock.json` (`npm i pg@8` ; `npm i -D pg-mem@3 @types/pg@8`)

**Interfaces — Produces:**
```ts
// types.ts
export type Role = "user" | "admin";
export interface UserRow { id: string; usernameKey: string; username: string; passwordHash: string; role: Role; icon: string; color: string;
  disabled: boolean; sessionVersion: number; createdAt: Date; lastLoginAt: Date | null }
export type UserPatch = Partial<Pick<UserRow, "role" | "disabled" | "icon" | "color" | "passwordHash" | "lastLoginAt">> & { bumpSession?: boolean };
// store.ts
export interface AccountStore {
  readonly kind: "postgres" | "memory";
  createUser(u: { usernameKey: string; username: string; passwordHash: string; role: Role; icon: string; color: string; createdAt?: Date }): Promise<UserRow | null>; // null = key taken; createdAt only for tests
  userByKey(usernameKey: string): Promise<UserRow | null>;
  userById(id: string): Promise<UserRow | null>;
  updateUser(id: string, patch: UserPatch): Promise<UserRow | null>; // bumpSession → sessionVersion + 1
  listUsers(q: string, page: number, pageSize: number): Promise<{ rows: (UserRow & { games: number })[]; total: number }>;
  // B2 adds: recordResults, leaderboard, trackView, stats, pruneViews
}
export function createMemoryAccountStore(): AccountStore;
// pg.ts
export function createPgAccountStore(pool: import("pg").Pool): Promise<AccountStore>; // runs migrations first
// migrations.ts
export const MIGRATIONS: { id: number; sql: string }[];
export async function migrate(q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>): Promise<void>;
```

- [ ] **Step 1: Cài gói** — `npm i pg@8 && npm i -D pg-mem@3 @types/pg@8`.
- [ ] **Step 2: Test (fail)** — `test/accounts-store.test.ts` chạy cùng bộ test cho hai store (`describe.each`):

```ts
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { createMemoryAccountStore, type AccountStore } from "../src/accounts/store";
import { createPgAccountStore } from "../src/accounts/pg";

async function pgStore(): Promise<AccountStore> {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return createPgAccountStore(new Pool());
}
const base = { passwordHash: "scrypt$x", role: "user" as const, icon: "", color: "#fbbf24" };

describe.each([["memory", async () => createMemoryAccountStore()], ["postgres (pg-mem)", pgStore]])("%s account store", (_, make) => {
  it("creates a user and refuses a second one with the same key", async () => {
    const s = await make();
    const u = await s.createUser({ ...base, usernameKey: "lan", username: "Lan" });
    expect(u).toMatchObject({ username: "Lan", role: "user", disabled: false, sessionVersion: 0 });
    expect(await s.createUser({ ...base, usernameKey: "lan", username: "LAN" })).toBeNull();
    expect((await s.userByKey("lan"))?.id).toBe(u!.id);
    expect((await s.userById(u!.id))?.username).toBe("Lan");
  });
  it("patches fields and bumps the session version", async () => {
    const s = await make();
    const u = (await s.createUser({ ...base, usernameKey: "minh", username: "Minh" }))!;
    const v = await s.updateUser(u.id, { role: "admin", icon: "🦊", bumpSession: true });
    expect(v).toMatchObject({ role: "admin", icon: "🦊", sessionVersion: 1 });
    expect(await s.updateUser("00000000-0000-0000-0000-000000000000", { icon: "x" })).toBeNull();
  });
  it("lists users by name, newest first, with paging", async () => {
    const s = await make();
    for (const n of ["An", "Bình", "Anh"]) await s.createUser({ ...base, usernameKey: n.toLowerCase(), username: n });
    const r = await s.listUsers("an", 1, 50);
    expect(r.total).toBe(2);
    expect(r.rows.map((x) => x.username).sort()).toEqual(["An", "Anh"]);
    expect((await s.listUsers("", 2, 2)).rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: FAIL** — `npx vitest run test/accounts-store.test.ts` (module chưa có).
- [ ] **Step 4: Cài đặt.**
  - `migrations.ts`: bảng `schema_migrations(id int primary key)`; migration 1 tạo `users` (cột như `UserRow`, snake_case: `id uuid primary key`, `username_key text unique not null`, `username text not null`, `password_hash`, `role text not null default 'user'`, `icon text not null default ''`, `color text not null default '#fbbf24'`, `disabled boolean not null default false`, `session_version int not null default 0`, `created_at timestamptz not null default now()`, `last_login_at timestamptz`), `game_results(game text, record_id text, user_id uuid, points int not null, rank int not null, won boolean not null, at timestamptz not null, day text not null, primary key (game, record_id, user_id))`, `page_views(id serial primary key, at timestamptz not null default now(), day text not null, path text not null, device_id text not null, user_id uuid)`, các index `page_views(day)`, `game_results(day)`, `game_results(game, user_id)`. `migrate()` đọc id đã chạy, chạy phần còn thiếu theo thứ tự, ghi id. `day` = chuỗi `YYYY-MM-DD` theo giờ Việt Nam (UTC+7), do JS tính (`vnDay(date)` export từ `types.ts`) để pg-mem và Postgres giống nhau.
  - `id` sinh bằng `crypto.randomUUID()` trong JS (không dựa vào `gen_random_uuid`).
  - `pg.ts`: mỗi hàm một câu SQL tham số hoá (`$1…`), map snake_case → `UserRow`. `createUser`: `INSERT … ON CONFLICT (username_key) DO NOTHING RETURNING *` → không có dòng = `null`. `listUsers`: `WHERE username_key LIKE $1` với `%q%` (q đã lowercase), `ORDER BY created_at DESC`, `LIMIT/OFFSET`, `games` = subquery `COUNT(*)` từ `game_results`.
  - `store.ts` memory: `Map<id, UserRow>`, cùng ngữ nghĩa (trả bản sao, không lộ object nội bộ).
- [ ] **Step 5: PASS** — `npx vitest run test/accounts-store.test.ts`; `npm run typecheck && npx vitest run --dir test`.
- [ ] **Step 6: Commit** — `feat(accounts): user store (Postgres + memory) with migrations`.

---

### Task B2: be_game — kết quả ván, bảng điểm, lượt xem, thống kê

**Files:**
- Modify: `src/accounts/store.ts`, `src/accounts/pg.ts`, `src/accounts/types.ts`
- Create: `test/accounts-stats.test.ts`

**Interfaces — Consumes:** B1. **Produces** (thêm vào `AccountStore`):
```ts
recordResults(game: string, recordId: string, at: Date, rows: { usernameKey: string; points: number; rank: number }[]): Promise<void>; // user không tồn tại → bỏ dòng đó; trùng → bỏ qua
leaderboard(game: string, limit: number): Promise<LeaderRow[]>;   // ORDER BY points DESC, wins DESC, name
trackView(v: { path: string; device: string; userId: string | null; at?: Date }): Promise<void>;
stats(days: number, now?: Date): Promise<AdminStats>;              // đúng kiểu ở API contract
pruneViews(olderThanDays: number, now?: Date): Promise<number>;
```
`LeaderRow`, `AdminStats` khai báo trong `types.ts` đúng như API contract.

- [ ] **Step 1: Test (fail)** — `test/accounts-stats.test.ts` (`describe.each` hai store như B1):

```ts
it("records each player once per game even when two backends record it", async () => {
  const s = await make();
  await s.createUser({ ...base, usernameKey: "lan", username: "Lan" });
  await s.createUser({ ...base, usernameKey: "minh", username: "Minh" });
  const at = new Date("2026-10-16T05:00:00Z");
  const rows = [{ usernameKey: "lan", points: 3, rank: 1 }, { usernameKey: "minh", points: -1, rank: 2 }, { usernameKey: "ghost", points: 1, rank: 3 }];
  await s.recordResults("tienlen", "g-1", at, rows);
  await s.recordResults("tienlen", "g-1", at, rows); // second backend
  await s.recordResults("tienlen", "g-2", at, [{ usernameKey: "lan", points: 2, rank: 2 }]);
  expect(await s.leaderboard("tienlen", 50)).toEqual([
    { name: "Lan", points: 5, games: 2, wins: 1, icon: "", color: "#fbbf24" },
    { name: "Minh", points: -1, games: 1, wins: 0, icon: "", color: "#fbbf24" },
  ]);
  expect(await s.leaderboard("meono", 50)).toEqual([]);
});

it("counts views, devices, games, players and new users per day (UTC+7), padding empty days", async () => {
  const s = await make();
  const now = new Date("2026-10-16T10:00:00Z"); // 17:00 in Vietnam
  const u = (await s.createUser({ ...base, usernameKey: "lan", username: "Lan", createdAt: now }))!;
  await s.trackView({ path: "/", device: "dev-a", userId: null, at: new Date("2026-10-15T18:00:00Z") }); // 16/10 01:00 VN
  await s.trackView({ path: "/tien-len", device: "dev-a", userId: u.id, at: now });
  await s.trackView({ path: "/", device: "dev-b", userId: null, at: new Date("2026-10-14T03:00:00Z") });
  await s.trackView({ path: "/play/tienlen", device: "dev-a", userId: u.id, at: now });
  await s.recordResults("tienlen", "g-1", now, [{ usernameKey: "lan", points: 3, rank: 1 }]);
  const st = await s.stats(7, now);
  expect(st.daily).toHaveLength(7);
  expect(st.daily.at(-1)).toMatchObject({ day: "2026-10-16", views: 2, devices: 1, games: 1, players: 1, newUsers: 1 });
  expect(st.daily.at(-3)).toMatchObject({ day: "2026-10-14", views: 1, devices: 1, games: 0 });
  expect(st.daily[0]).toMatchObject({ day: "2026-10-10", views: 0 });
  expect(st.totals).toMatchObject({ users: 1, newUsers: 1, views: 3, devices: 2, games: 1, players: 1, playDevices: 1 });
  expect(st.byGame).toEqual([{ game: "tienlen", games: 1, players: 1 }]);
  expect(st.topPages[0]).toEqual({ path: "/", views: 2 });
  expect(st.topPlayers).toEqual([{ name: "Lan", games: 1, points: 3 }]);
});

it("prunes views older than the cut-off", async () => {
  const s = await make();
  const now = new Date("2026-10-16T00:00:00Z");
  await s.trackView({ path: "/", device: "d", userId: null, at: new Date("2026-01-01T00:00:00Z") });
  await s.trackView({ path: "/", device: "d", userId: null, at: now });
  expect(await s.pruneViews(180, now)).toBe(1);
  expect((await s.stats(7, now)).totals.views).toBe(1);
});
```
  Ghi chú định nghĩa: `views` = số dòng `page_views` có `path` không bắt đầu bằng `/play/`; `devices` = số `device_id` khác nhau trong các dòng đó; `games` = số `record_id` khác nhau trong `game_results`; `players` = số `user_id` khác nhau trong `game_results`; `playDevices` = số `device_id` khác nhau trong `page_views` có `path` bắt đầu bằng `/play/`; `newUsers` = user có `created_at` trong kỳ (theo `vnDay`). Totals tính trong `days` ngày gần nhất, trừ `users` = tổng mọi thời gian. Store bộ nhớ dùng `createdAt = new Date()` khi tạo user; để test `newUsers` ổn định, `createUser` nhận tuỳ chọn `createdAt?: Date` (chỉ dùng trong test) và test truyền `createdAt: now`.
- [ ] **Step 2: FAIL** — `npx vitest run test/accounts-stats.test.ts`.
- [ ] **Step 3: Cài đặt** — SQL chỉ dùng `COUNT(DISTINCT …)`, `SUM(CASE …)`, `GROUP BY`, so sánh chuỗi `day >= $1` (không dùng `FILTER`, `date_trunc`, `generate_series` — pg-mem không chắc hỗ trợ); đệm ngày trống bằng JS. `recordResults`: một `INSERT … SELECT u.id … FROM users u WHERE u.username_key = $x … ON CONFLICT DO NOTHING` mỗi dòng (hoặc tra id trước rồi chèn), `won = rank === 1`.
- [ ] **Step 4: PASS** — test file + toàn bộ.
- [ ] **Step 5: Commit** — `feat(accounts): game results, leaderboard, page views and admin stats queries`.

---

### Task B3: be_game — mật khẩu, token phiên, username, giới hạn thử

**Files:**
- Create: `src/accounts/password.ts`, `src/accounts/session.ts`, `src/accounts/username.ts`, `src/accounts/rateLimit.ts`, `test/accounts-auth.test.ts`

**Interfaces — Produces:**
```ts
export async function hashPassword(pw: string): Promise<string>;
export async function verifyPassword(pw: string, stored: string): Promise<boolean>; // false for malformed stored
export function signSession(p: { uid: string; ver: number }, secret: string, now?: number): string; // exp = now/1000 + 30 days
export function readSession(token: string, secret: string, now?: number): { uid: string; ver: number } | null; // bad sig / expired / malformed → null
export function normalizeUsername(raw: string): { ok: true; username: string; key: string } | { ok: false; error: string };
export function validatePassword(pw: string): string | null; // error text or null
export interface RateLimiter { hit(bucket: string, limit: number, windowSec: number): Promise<boolean> } // true = allowed
export function redisRateLimiter(redis: { incr(k: string): Promise<number>; expire(k: string, s: number): Promise<unknown> }): RateLimiter;
export function memoryRateLimiter(now?: () => number): RateLimiter;
```

- [ ] **Step 1: Test (fail):**

```ts
import RedisMock from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/accounts/password";
import { readSession, signSession } from "../src/accounts/session";
import { normalizeUsername, validatePassword } from "../src/accounts/username";
import { memoryRateLimiter, redisRateLimiter } from "../src/accounts/rateLimit";

describe("passwords", () => {
  it("hashes with scrypt and a random salt, verifies only the right password", async () => {
    const a = await hashPassword("matkhau123");
    const b = await hashPassword("matkhau123");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("matkhau123", a)).toBe(true);
    expect(await verifyPassword("matkhau124", a)).toBe(false);
    expect(await verifyPassword("matkhau123", "garbage")).toBe(false);
  });
});
describe("sessions", () => {
  const now = 1_790_000_000_000;
  it("round-trips, rejects a tampered or foreign token, and expires after 30 days", () => {
    const t = signSession({ uid: "u1", ver: 2 }, "s3cret", now);
    expect(readSession(t, "s3cret", now)).toEqual({ uid: "u1", ver: 2 });
    expect(readSession(t, "other", now)).toBeNull();
    const [p, sig] = t.split(".");
    expect(readSession(`${p}x.${sig}`, "s3cret", now)).toBeNull();
    expect(readSession(t, "s3cret", now + 31 * 86_400_000)).toBeNull();
    expect(readSession("nope", "s3cret", now)).toBeNull();
  });
});
describe("usernames", () => {
  it("normalizes spaces and case into one key, keeps the typed form", () => {
    expect(normalizeUsername("  Lan   Anh ")).toEqual({ ok: true, username: "Lan Anh", key: "lan anh" });
    expect(normalizeUsername("Thạch_99")).toMatchObject({ ok: true, key: "thạch_99" });
  });
  it("rejects bad lengths and characters", () => {
    for (const bad of ["ab", "x".repeat(21), "a<b>", "lan!", ""]) expect(normalizeUsername(bad).ok).toBe(false);
    expect(validatePassword("1234567")).not.toBeNull();
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("x".repeat(73))).not.toBeNull();
  });
});
describe("rate limits", () => {
  it.each([["memory", () => memoryRateLimiter()], ["redis", () => redisRateLimiter(new RedisMock() as never)]])("%s allows `limit` hits per window", async (_, make) => {
    const rl = make();
    for (let i = 0; i < 3; i++) expect(await rl.hit("login:ip:1.2.3.4", 3, 900)).toBe(true);
    expect(await rl.hit("login:ip:1.2.3.4", 3, 900)).toBe(false);
    expect(await rl.hit("login:ip:5.6.7.8", 3, 900)).toBe(true);
  });
});
```
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Cài đặt** — `crypto.scrypt` promisify, `timingSafeEqual` (độ dài khác → false); HMAC so sánh bằng `timingSafeEqual`; redis limiter: `INCR` khoá `be_game:rl:<bucket>`, nếu kết quả = 1 thì `EXPIRE`; memory limiter: Map bucket → {count, resetAt}.
- [ ] **Step 4: PASS** + toàn bộ. **Step 5: Commit** — `feat(accounts): scrypt passwords, signed sessions, username rules, rate limits`.

---

### Task B4: be_game — route auth / admin / track, CORS, health

**Files:**
- Create: `src/accounts/service.ts` (logic không phụ thuộc HTTP), `src/server/authRoutes.ts` (HTTP), `test/accounts-routes.test.ts`
- Modify: `src/server/app.ts` (gọi `handleAccountRoute` trước bảng `ROUTES`; CORS header + `OPTIONS`; `health()` thêm `accounts`), `api/` (Vercel: thêm file `api/auth/[action].ts`, `api/admin/[...path].ts`, `api/track.ts` export cùng `createGameServer()` như các file khác — xem cách `api/[game]/[kind].ts` làm), `vercel.json` nếu cần rewrite.

**Interfaces — Consumes:** B1–B3. **Produces:**
```ts
// service.ts
export interface AccountService {
  store: AccountStore;
  register(input: { username: string; password: string; icon?: string; color?: string }, ip: string): Promise<Result<{ session: string; user: PublicUser }>>;
  login(input: { username: string; password: string }, ip: string): Promise<Result<{ session: string; user: PublicUser }>>;
  authenticate(token: string | null): Promise<UserRow | null>; // cache 60 s by uid; disabled / ver mismatch → null
  forget(uid: string): void; // drop cache entry (logout, password change, disable, role change)
  logout(user: UserRow): Promise<void>;
  updateMe(user: UserRow, patch: { icon?: string; color?: string; password?: string; oldPassword?: string }): Promise<Result<{ user: PublicUser; session?: string }>>;
  adminUpdate(admin: UserRow, id: string, patch: { role?: Role; disabled?: boolean; password?: string }): Promise<Result<{ user: AdminUser }>>;
}
type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
export function getAccountService(): Promise<AccountService>; // singleton: pg if DATABASE_URL else memory; redis limiter if Redis configured else memory
export function publicUser(u: UserRow): PublicUser;
export const PROFILE_COLORS: readonly string[]; export const PROFILE_ICONS: readonly string[]; // copy exactly from zonenop-game src/components/games/gameClient.ts; invalid icon/color → defaults ("", "#fbbf24")
// authRoutes.ts
export async function handleAccountRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean>; // true = handled
```
- `ADMIN_USERNAMES` (danh sách, so bằng key) → khi register/login thành công mà user là `user` thì nâng `admin`.
- Pg pool: `new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, ssl: url có "sslmode=require" hoặc host khác localhost ? { rejectUnauthorized: true } : undefined })`. Mọi lời gọi store trong route bọc timeout 5 s → 503 `"Máy chủ tài khoản đang lỗi, thử lại sau"`.
- IP: `x-forwarded-for` phần đầu, rồi `cf-connecting-ip`, rồi `req.socket.remoteAddress`.
- Body JSON tối đa 4 KB, sai JSON → 400.
- `/api/track`: bỏ qua (204, không ghi) nếu UA khớp `/bot|crawl|spider|preview|monitor/i`; `path` sai → 400; `device` sai regex `^[A-Za-z0-9_-]{16,64}$` → 400.
- Mỗi khi ứng dụng khởi động lần đầu (lần đầu `getAccountService`), gọi `pruneViews(180)` không chờ, lỗi chỉ log.

- [ ] **Step 1: Test (fail)** — `test/accounts-routes.test.ts`: dựng `createGameServer()` trên cổng 0 (như `test/shared-store.test.ts`), env `ADMIN_USERNAMES="boss"`, không `DATABASE_URL` (store bộ nhớ, limiter bộ nhớ). Reset singleton giữa các test bằng hàm `resetAccountServiceForTests()` export từ `service.ts`. Các ca:
  1. register `Lan`/`matkhau123` → 200, `session` có dấu `.`, `user` = `{username:"Lan", role:"user"}`, response không có trường nào chứa `scrypt`.
  2. register ` lan ` → 409 `"Tên đăng nhập đã có người dùng"`; username `ab` → 400; mật khẩu 7 ký tự → 400.
  3. login sai mật khẩu và login user không tồn tại → cùng 401 `"Sai tên đăng nhập hoặc mật khẩu"`; login đúng → 200.
  4. `GET /api/auth/me` không token → 401; có token → user; sau `logout` cùng token → 401.
  5. `PATCH /api/auth/me` đổi màu `#f87171` → user có màu mới; đổi mật khẩu với `oldPassword` sai → 400; đúng → 200 + `session` mới, token cũ → 401.
  6. register `boss` → role `admin`. `GET /api/admin/stats?days=7` với token `Lan` → 403; với `boss` → 200 có `daily` dài 7; `days=5` → 400.
  7. `PATCH /api/admin/users/<Lan id>` `{disabled:true}` → token của Lan → 401 ngay (cache bị xoá); `boss` tự `{role:"user"}` → 400.
  8. `POST /api/track` `{path:"/", device:"abcdefghijklmnop"}` → 204, rồi `stats` có `views` 1; `device:"x"` → 400; UA `Googlebot` → 204 nhưng `views` không tăng.
  9. 6 lần register từ cùng IP trong giờ → lần thứ 6 là 429.
  10. `OPTIONS /api/auth/login` với `Origin` được phép → 204 có `access-control-allow-headers` chứa `Authorization`.
  11. Store ném lỗi (thay `service.store.userByKey` bằng hàm reject) → login trả 503 thông báo tiếng Việt.
  12. `/api/health` có `accounts: "memory"`.
- [ ] **Step 2: FAIL.** **Step 3: Cài đặt** theo các interface trên. **Step 4: PASS** + toàn bộ.
- [ ] **Step 5: Commit** — `feat(accounts): auth, admin and track routes`.

---

### Task B5: be_game — bắt buộc phiên khi join, ghi kết quả, bảng điểm mùa mới

**Files:**
- Modify: `src/server/hub.ts` (join/watch), `src/server/app.ts` (route leaderboard), `test/hub.test.ts` hoặc test mới `test/accounts-game.test.ts`

**Interfaces — Consumes:** `getAccountService()`, `AccountService.authenticate`, `store.recordResults`, `store.leaderboard`, `store.trackView`.

- Join/watch: đọc `msg.session`, `msg.device`. `authenticate` null → ack `{ok:false, error:"Cần đăng nhập"}`, không đụng phòng. Có user → gọi adapter với `name = user.username` (bỏ `msg.name`), look = `{icon:user.icon, color:user.color}`. Join thành công và `device` hợp lệ → `store.trackView({path:"/play/<game>", device, userId:user.id})` không chờ, lỗi chỉ log. Service lỗi/timeout → ack `"Máy chủ tài khoản đang lỗi, thử lại sau"`.
- Nơi `recordGame(rec)` được gọi trong `hub.mutate`: thêm `accounts.store.recordResults(game, rec.id, new Date(rec.at), rec.results.map(r => ({ usernameKey: nameKey(r.name), points: r.delta, rank: r.rank })))` — `.catch(log)`, không chờ trong đường găng nếu có thể (vẫn `await` sau khi đã trả kết quả cho ván là được).
- Leaderboard route: không có `season=old` → `{season:"current", rows: await store.leaderboard(game, 50)}`; `season=old` → dữ liệu Redis cũ, giữ nguyên định dạng cũ.
- Hub cần biết tên game cho `recordResults` và `/play/<game>`: dùng `GameKind` hub đã có.
- [ ] **Step 1: Test (fail)** — dùng hub thật với store phòng bộ nhớ + account service bộ nhớ (cách dựng hub như `test/hub.test.ts`):
  1. join không `session` → `"Cần đăng nhập"`; join với session hợp lệ của `Lan` nhưng `name:"Kẻ giả"` → seat tên `Lan`.
  2. token của user bị khoá → `"Cần đăng nhập"`.
  3. Chạy một ván Tiến Lên 2 người tới hết (dùng helper có sẵn trong test hub/fuzz để đánh tự động) trên **hai hub cùng store phòng** → `store.leaderboard("tienlen")` có đúng 2 dòng, mỗi dòng `games: 1`.
  4. `recordResults` ném lỗi → ván vẫn kết thúc bình thường (state `ended`), có log lỗi (spy `console.error`).
  5. `GET /api/leaderboard` → `{season:"current", rows:[…]}`; `?season=old` → mảng/định dạng cũ.
  6. join kèm `device:"abcdefghijklmnop"` → `stats(7).totals.playDevices` = 1.
- [ ] **Step 2: FAIL. Step 3: Cài đặt. Step 4: PASS** + toàn bộ.
- [ ] **Step 5: Commit** — `feat(accounts): sign-in required to play; results feed the per-account leaderboard`.

---

### Task B6: be_game — cấu hình và tài liệu

**Files:** `compose.selfhost.yml` (environment: `DATABASE_URL: ${DATABASE_URL:-}`, `SESSION_SECRET: ${SESSION_SECRET:-}`, `ADMIN_USERNAMES: ${ADMIN_USERNAMES:-}`), `.env.example`, `docs/GUIDE.md` (route mới, API contract), `docs/DEPLOYMENT.md` (bảng env, Neon), `docs/SELF_HOSTING.md` (bảng cấu hình, cách đặt bí mật an toàn: `read -rs` + `printf >> .env`, `chmod 600`; tạo `SESSION_SECRET` bằng `openssl rand -base64 32`), `README.md`, `.claude/rules/deploy.md` (không log/commit `DATABASE_URL`/`SESSION_SECRET`).
- [ ] **Step 1:** sửa các file trên; nêu rõ: chưa có `DATABASE_URL` thì tài khoản ở bộ nhớ (mất khi restart, mỗi máy một danh sách) — chỉ dùng để dev.
- [ ] **Step 2:** `npm run typecheck && npx vitest run --dir test`; `npx --yes yaml@2.5.1 valid < compose.selfhost.yml`.
- [ ] **Step 3: Commit** — `docs(accounts): env, deploy and API docs`.

---

### Task Z1: zonenop-game — phiên đăng nhập phía client

**Files:**
- Create: `src/components/auth/session.ts`, `src/components/auth/session.test.ts`, `src/components/auth/device.ts`
- Modify: `src/components/games/gameClient.ts` (gửi `session` + `device` trong `join`/`watch`; `fetchApi` gửi `Authorization` khi có phiên; ack `"Cần đăng nhập"` → xoá phiên + `onSignedOut`)

**Interfaces — Produces:**
```ts
export interface PublicUser { id: string; username: string; role: "user" | "admin"; icon: string; color: string }
export const SESSION_KEY = "games:session"; // localStorage: JSON {session, user}
export function getSession(): { session: string; user: PublicUser } | null;
export function saveSession(s: { session: string; user: PublicUser }): void; // notifies subscribers
export function clearSession(): void;
export function useSession(): { session: string; user: PublicUser } | null; // useSyncExternalStore, null on the server
export async function authRequest<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }>;
// uses activeServerBase() then the other bases on network error (like fetchApi); 401 → clearSession()
export async function refreshMe(): Promise<void>; // GET /api/auth/me → saveSession({session, user}) or clearSession on 401
export function getDeviceId(): string; // localStorage "games:device", 24 chars [A-Za-z0-9_-], created once
```
- Phiên mới thay `getSavedProfile()` làm nguồn look khi đã đăng nhập: `getSavedProfile()` trả `{icon,color}` của `user` nếu có phiên.
- [ ] **Step 1: Test (fail)** — `session.test.ts` (stub `localStorage` như `src/components/typhu/prefs.test.ts`, stub `fetch`): lưu/đọc/xoá; JSON hỏng → `null`; `authRequest` gửi header `Authorization: Bearer <s>`; phản hồi 401 → `getSession()` thành `null`; `getDeviceId()` ổn định giữa hai lần gọi và khớp regex `^[A-Za-z0-9_-]{24}$`.
- [ ] **Step 2–4:** FAIL → cài đặt → PASS + `npm run lint && npm run typecheck && npm test`.
- [ ] **Step 5: Commit** — `feat(auth): client session, device id, session on join and API calls`.

### Task Z2: zonenop-game — trang đăng nhập/đăng ký, cổng bắt buộc, menu tài khoản

**Files:**
- Create: `src/app/dang-nhap/page.tsx`, `src/components/auth/AuthForm.tsx`, `src/components/auth/AccountMenu.tsx`
- Modify: `src/components/games/GamesShell.tsx` (bỏ `NameGate`: chưa có phiên → `router.replace("/dang-nhap?next=<đường dẫn hiện tại>")`; có phiên → `refreshMe()` một lần), avatar ở thanh trên mở `AccountMenu`, `src/components/typhu/dialogs/LookDialog.tsx` (Lưu → `authRequest("PATCH","/api/auth/me",{icon,color})` rồi `saveSession`), `src/app/robots.ts` (disallow `/dang-nhap`, `/admin`).
- `AuthForm`: `GameTabs` "Đăng nhập" / "Đăng ký"; trường username + mật khẩu (+ nhập lại mật khẩu và `ProfilePicker` khi đăng ký); nút `GameButton` có `loading`; lỗi server hiện dưới form; thành công → `saveSession` → `router.replace(next ?? "/")`. `next` chỉ chấp nhận đường dẫn nội bộ bắt đầu bằng `/` và không bắt đầu bằng `//`.
- `AccountMenu` (GameDialog): đổi biểu tượng & màu (`ProfilePicker` → PATCH), đổi mật khẩu (cũ + mới + nhập lại), đăng xuất (`POST /api/auth/logout` rồi `clearSession`, về `/dang-nhap`), "Quản trị" → `/admin` khi `role === "admin"`.
- [ ] **Step 1:** test thuần cho `safeNext(next)` (đặt trong `AuthForm.tsx` export hoặc `src/components/auth/next.ts`): `"/tien-len"` → giữ; `"//evil.com"`, `"https://x"`, `""`, `null` → `"/"`.
- [ ] **Step 2–4:** cài đặt; lint/typecheck/test/build.
- [ ] **Step 5: Commit** — `feat(auth): sign-in / sign-up page, required sign-in, account menu`.

### Task Z3: zonenop-game — bảng điểm mùa này / mùa trước

**Files:** Modify `src/components/games/GameLobby.tsx` (phần bảng điểm) và `gameClient.ts` nếu có hàm đọc leaderboard.
- Tab `GameTabs` "Mùa này" (`/api/<game>/leaderboard` → `rows`) và "Mùa trước" (`?season=old`, định dạng cũ). Mỗi dòng mùa này: hạng, avatar (icon/màu), tên, điểm, số ván, số thắng.
- [ ] Test thuần cho hàm chuyển dữ liệu (`toLeaderRows(payload)` chấp nhận cả `{season,rows}` lẫn mảng cũ) → cài đặt → lint/typecheck/test/build → Commit `feat(lobby): current-season and previous-season leaderboards`.

### Task Z4: zonenop-game — beacon lượt xem

**Files:** Create `src/components/auth/PageTracker.tsx` (client component, `usePathname`), Modify `src/app/layout.tsx` (gắn `PageTracker`).
- Mỗi lần `pathname` đổi: `navigator.sendBeacon(base + "/api/track", new Blob([JSON.stringify({path, device})], {type:"application/json"}))`; không có `sendBeacon` → `fetch(..., {method:"POST", keepalive:true, headers, body})`. Có phiên thì dùng `fetch` (beacon không gửi được header) kèm `Authorization`. Không gửi khi `process.env.NODE_ENV === "test"`. Không bao giờ ném lỗi ra UI.
- [ ] Test thuần cho `trackPayload(pathname)` (cắt query, ≤ 200 ký tự) → cài đặt → lint/typecheck/test/build → Commit `feat(stats): page-view beacon`.

### Task Z5: zonenop-game — trang `/admin`

**Files:**
- Create: `src/app/admin/page.tsx` (metadata `robots: { index: false }`), `src/components/admin/AdminDashboard.tsx`, `src/components/admin/StatCards.tsx`, `src/components/admin/Charts.tsx` (Recharts, nạp bằng `next/dynamic` `ssr:false`), `src/components/admin/UsersTable.tsx`, `src/components/admin/format.ts` + `format.test.ts`
- Modify: `package.json` (`npm i recharts@2`)
- Chưa đăng nhập → `/dang-nhap?next=/admin`; không phải admin → panel "Bạn không có quyền xem trang này". Chọn kỳ 7/30/90 ngày (`GameTabs`/nút), gọi `GET /api/admin/stats?days=`.
- Thẻ chỉ số (`StatCards`, 7 thẻ theo `totals`, số định dạng `vi-VN`); biểu đồ đường lượt xem + số máy theo ngày; biểu đồ cột số ván + số người chơi theo ngày; bảng `byGame` (tên game từ `ONLINE_GAMES`), `topPages`, `topPlayers`. Tab "Người dùng": ô tìm kiếm (debounce 300 ms), bảng 50 dòng/trang, nút khoá/mở khoá, đổi role (xác nhận), đặt lại mật khẩu (GameDialog nhập mật khẩu mới).
- Giao diện: `GameThemeScope` hub, `GamePanel`, chữ tiếng Việt, đọc tốt ở 390 px (bảng cuộn ngang trong khung, thẻ 2 cột) và 1440 px.
- `format.ts`: `formatDay("2026-10-16") → "16/10"`, `compact(12345) → "12,3 N"` (hoặc `Intl.NumberFormat("vi-VN",{notation:"compact"})`), `fillDaily` không cần (server đã đệm).
- [ ] Test `format.test.ts` → cài đặt → lint/typecheck/test/`npx next build` (kiểm tra Recharts không vào bundle trang game: chunk của `/tien-len` không chứa `recharts`) → Commit `feat(admin): stats dashboard and user management`.

### Task Z6: zonenop-game — e2e + tài liệu

**Files:** `docs/GAMES_GUIDE.md` (§ tài khoản, phiên, bảng điểm, admin), `README.md`, `CLAUDE.md`, `.env.example` (nếu cần).
- [ ] **E2E** (không commit script; lưu ở `%TEMP%/shots/accounts-e2e.mjs`): be_game nhánh `feature/accounts` chạy `PORT=4123 ADMIN_USERNAMES=boss npx tsx src/local.ts` (bộ nhớ), `next dev -p 3105` với `NEXT_PUBLIC_TIENLEN_SERVER_URL=http://localhost:4123`. Khung 390×844:
  1. mở `/tien-len` → bị chuyển về `/dang-nhap?next=/tien-len`; đăng ký `Lan`/`matkhau123` → về `/tien-len`;
  2. tạo bàn, thêm 1 người thứ hai (context khác, đăng ký `Minh`), chơi tới hết ván (bấm tự động như các script cũ);
  3. sảnh: tab "Mùa này" có Lan và Minh với `games` 1;
  4. context thứ ba đăng ký `boss` → `/admin` có số ván ≥ 1, số máy ≥ 2, biểu đồ hiện; tab Người dùng thấy Lan, khoá Lan → context của Lan bị đẩy về `/dang-nhap` ở lần gọi kế tiếp;
  5. không lỗi console; chụp ảnh `/dang-nhap`, sảnh, `/admin` (390 và 1440).
- [ ] Docs → lint/typecheck/test → Commit `docs(accounts): sign-in, leaderboard seasons and admin`.

---

## Sau khi xong (controller)

- Review toàn nhánh hai repo; PR be_game → `main`, zonenop-game → `develop`.
- **Thứ tự triển khai bắt buộc** (spec §11): (1) người dùng đặt `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAMES` trên điện thoại và Vercel be-game; (2) merge be_game **và** release zonenop-game ngay sau đó. Lý do: be_game mới từ chối `join` không có `session`, nên trang cũ ngừng vào được bàn cho tới khi trang mới lên (vài phút, chấp nhận được). Merge/release và đặt bí mật là quyết định của người dùng.
