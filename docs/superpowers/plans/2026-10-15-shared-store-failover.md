# Shared Upstash store + client failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi máy chính (điện thoại) sập, người đang chơi tự sang máy dự phòng và chơi tiếp đúng ván — bằng cách cho cả
hai backend dùng chung Upstash, và cho client thử máy còn lại khi máy đã ghim không trả lời.

**Architecture:** be_game không đổi logic: chỉ thêm `GAME_KINDS`, export `keysFor`, trường `sharedStore` ở
`/api/health`, bộ đếm lệnh Redis bật bằng env (để đo hạn mức), script chuyển dữ liệu `src/tools/migrate-store.ts`, và
`compose.selfhost.yml` lấy `REDIS_URL` từ `.env`. Client zonenop-game: hàm thuần `basesToTry` và `open()` thử máy đã
ghim trước rồi các máy còn lại. Chuyển điện thoại sang Upstash là bước vận hành cuối, có cổng chờ người dùng.

**Tech Stack:** be_game: Node 22, TypeScript, ioredis 5, vitest, `ioredis-mock` 8 (devDependency mới). zonenop-game:
Next 16 / React 19, vitest. Playwright (`playwright-core` ở `%TEMP%/shots`, Edge) cho buổi diễn tập.

**Spec:** `docs/superpowers/specs/2026-10-15-shared-store-failover-design.md` (repo be_game)

## Global Constraints

- be_game: nhánh `feature/shared-store-failover` tạo từ `docs/shared-store-failover-spec` (đã có commit spec); PR vào
  `main`. zonenop-game: nhánh `feature/failover-shared-store` từ `develop`; PR vào `develop`.
- Không đổi logic game, protocol, CAS/`SAVE_SCRIPT`, cách nối lại bằng token.
- URL Upstash là **bí mật**: không commit, không in ra log/báo cáo/console (chỉ in host), không đặt vào GitHub
  secrets. Chỉ nằm trong `~/apps/be_game/.env` trên điện thoại (quyền 600) và biến môi trường tạm khi diễn tập.
- Không thao tác trên server điện thoại cho tới Task 7, và Task 7 chỉ chạy sau khi người dùng duyệt rõ ràng.
- Quy tắc máy dùng chung (skill zangyapro-host): chỉ trong `/home/zonenop`, không prune, không restart Docker daemon.
- Trước mỗi commit: be_game `npm run typecheck && npm test`; zonenop-game `npm run lint && npm run typecheck && npm test`.
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Chữ hiển thị tiếng Việt; comment/code tiếng Anh như repo.

## Điều chỉnh so với spec

1. Hàm client là `basesToTry(roomBase: string | null, candidates: readonly string[]): string[]` (spec ghi thêm tham số
   `pinnedUnreachable`): vòng `open()` đã thử tuần tự và chỉ sang máy tiếp theo khi máy trước `unreachable` hoặc
   `not-found`, nên không cần cờ đó.
2. Đo hạn mức bằng **bộ đếm lệnh phía be_game** (`BE_GAME_COUNT_COMMANDS=1`, log mỗi 60 s) trong buổi diễn tập, cộng
   số liệu dashboard Upstash nếu người dùng cung cấp — vì không có API dashboard.
3. Buổi diễn tập chạy **hai be_game local trỏ vào Upstash thật** (máy này không có Docker/Redis); dữ liệu thử là phòng
   tạm, hết hạn sau 12 giờ.

## Review Focus

1. **URL bí mật lộ ra** (log script, báo cáo, health, commit): chỉ được thấy host. Kiểm ở Task 2 (test output) và Task 6.
2. **Gộp bảng xếp hạng chạy lại hai lần** → điểm bị cộng gấp đôi. Script không idempotent theo thiết kế; Task 7 chạy đúng
   một lần, `--dry-run` trước. Kiểm ở Task 2 (cảnh báo trong output) và Task 7.
3. **Client đổi máy khi máy ghim chỉ chậm** (chưa sập): `tryJoin` timeout 10 s → coi là `unreachable` → sang máy kia;
   với kho chung thì vẫn đúng ván, với kho riêng thì `not-found` → quay lại. Kiểm ở Task 4 (unit) và Task 5.
4. **Hai máy cùng `tick` một phòng**: CAS chỉ cho một lần ghi. Kiểm ở Task 5 (ván chơi tiếp không nhảy lượt hai lần).
5. **`compose.selfhost.yml` thiếu `REDIS_URL` trong `.env`** → vẫn dùng Redis cục bộ như cũ. Kiểm ở Task 3
   (`docker compose config` với và không có biến).

---

### Task 1: be_game — `GAME_KINDS`, `keysFor`, health `sharedStore`, bộ đếm lệnh

**Files:**
- Modify: `src/server/store.ts`, `src/server/app.ts`
- Create: `test/shared-store.test.ts`

**Interfaces — Produces:**
- `export const GAME_KINDS: readonly GameKind[]` (đúng 7 game, cùng thứ tự type).
- `export function keysFor(game: GameKind)` (đã có, thêm `export`).
- `export const isSharedStoreHost = (host: string | null) => boolean` trong `app.ts`: `true` khi host khác rỗng và không
  phải `redis`, `localhost`, `127.0.0.1`, `[::1]`.
- `/api/health` thêm `sharedStore: boolean`.
- `export function countCommands(redis: { sendCommand: (...a: any[]) => any }, onTick: (n: number) => void, everyMs?: number): () => void`
  trong `store.ts` — bọc `sendCommand` đếm lệnh, gọi `onTick(count)` mỗi `everyMs` (mặc định 60 000) rồi về 0; trả hàm dừng.
  `getRedis()` bật nó khi `process.env.BE_GAME_COUNT_COMMANDS === "1"`, log `[be_game] redis commands last 60s: <n>`.

- [ ] **Step 1: Nhánh** — `cd D:/WorkSpace/be_game && git switch docs/shared-store-failover-spec && git switch -c feature/shared-store-failover`
- [ ] **Step 2: Test (fail)** — `test/shared-store.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { isSharedStoreHost } from "../src/server/app";
import { GAME_KINDS, countCommands, keysFor } from "../src/server/store";

describe("shared store helpers", () => {
  it("lists every game", () => {
    expect([...GAME_KINDS].sort()).toEqual(["bang", "cangua", "meono", "oanquan", "splendor", "tienlen", "typhu"]);
  });
  it("exposes the key layout", () => {
    expect(keysFor("typhu").room("ABCDE")).toBe("typhu:room:ABCDE");
    expect(keysFor("tienlen").lbPlayer("lan")).toBe("tienlen:lb:p:lan");
    expect(keysFor("meono").index).toBe("meono:rooms");
  });
  it("tells a shared (remote) Redis from the local compose one", () => {
    expect(isSharedStoreHost("happy-osprey-296234.upstash.io")).toBe(true);
    for (const h of ["redis", "localhost", "127.0.0.1", "[::1]", "", null]) expect(isSharedStoreHost(h)).toBe(false);
  });
  it("counts commands per interval and stops cleanly", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const redis = { sendCommand: (cmd: string) => sent.push(cmd) };
    const ticks: number[] = [];
    const stop = countCommands(redis, (n) => ticks.push(n), 1000);
    redis.sendCommand("GET");
    redis.sendCommand("SET");
    vi.advanceTimersByTime(1000);
    redis.sendCommand("GET");
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(ticks).toEqual([2, 1]);
    expect(sent).toEqual(["GET", "SET", "GET"]);
    vi.useRealTimers();
  });
});
```

  (Ghi chú: rule repo nói "không fake timers" cho test luật game; bộ đếm là hạ tầng có `setInterval` thật, fake timers
  là cách duy nhất để test tất định — ghi lý do trong comment đầu test.)

- [ ] **Step 3: Chạy → FAIL** — `npx vitest run test/shared-store.test.ts` → lỗi import (`GAME_KINDS`/`isSharedStoreHost` không tồn tại).
- [ ] **Step 4: Cài đặt** — trong `store.ts`:

```ts
export const GAME_KINDS = ["tienlen", "meono", "typhu", "splendor", "bang", "cangua", "oanquan"] as const satisfies readonly GameKind[];
```
  thêm `export` trước `function keysFor`; và

```ts
/** Ops aid (BE_GAME_COUNT_COMMANDS=1): count Redis commands sent by this process and report them every interval. */
export function countCommands(redis: { sendCommand: (...a: any[]) => any }, onTick: (n: number) => void, everyMs = 60_000): () => void {
  const original = redis.sendCommand.bind(redis);
  let n = 0;
  redis.sendCommand = (...a: any[]) => {
    n++;
    return original(...a);
  };
  const timer = setInterval(() => {
    onTick(n);
    n = 0;
  }, everyMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    redis.sendCommand = original;
  };
}
```
  trong `getRedis()` sau khi tạo `redis`:
  `if (process.env.BE_GAME_COUNT_COMMANDS === "1") countCommands(redis, (n) => console.log(\`[be_game] redis commands last 60s: ${n}\`));`

  Trong `app.ts`:

```ts
/** A Redis outside this machine (Upstash…) means both backends share rooms; the compose `redis` service does not. */
export const isSharedStoreHost = (host: string | null) => !!host && !["redis", "localhost", "127.0.0.1", "[::1]"].includes(host);
```
  (`new URL("redis://[::1]:6379").hostname` là `"[::1]"`, có ngoặc.) Nếu import `app.ts` trong test kéo theo tác dụng
  phụ (mở Redis, listen…), chuyển `isSharedStoreHost` sang `store.ts` và import từ đó — ghi lại trong báo cáo.
  và trong `health()` thêm vào `info`: `sharedStore: isSharedStoreHost(url ? new URL(url).hostname : null),`.
  Nếu `GameKind` hiện là union viết tay, có thể đổi thành `export type GameKind = (typeof GAME_KINDS)[number]` và bỏ
  `satisfies` — miễn typecheck sạch và test đúng 7 game.
- [ ] **Step 5: PASS** — `npx vitest run test/shared-store.test.ts`; rồi `npm run typecheck && npm test`.
- [ ] **Step 6: Commit** — `feat(store): GAME_KINDS, exported key layout, sharedStore in health, opt-in command counter`.

---

### Task 2: be_game — script chuyển dữ liệu `src/tools/migrate-store.ts`

**Files:**
- Create: `src/tools/migrate-store.ts`, `test/migrate-store.test.ts`
- Modify: `package.json`, `package-lock.json` (`npm i -D ioredis-mock@8`)

**Interfaces:**
- Consumes: `GAME_KINDS`, `keysFor` (Task 1).
- Produces: `export interface MigrateResult { game: GameKind; players: number; roomsCopied: number; roomsSkipped: number }`;
  `export async function migrateGame(src: Redis, dst: Redis, game: GameKind, dryRun: boolean): Promise<MigrateResult>`;
  `export async function migrateAll(src: Redis, dst: Redis, dryRun: boolean): Promise<MigrateResult[]>`;
  CLI `tsx src/tools/migrate-store.ts --from <url> --to <url> [--dry-run]`.

- [ ] **Step 1: `npm i -D ioredis-mock@8`**; kiểm tra hai instance tách dữ liệu: tạo `new RedisMock({ port: 1 })` và
  `new RedisMock({ port: 2 })`, `set` ở một bên, `get` bên kia phải `null`. Nếu ioredis-mock chia sẻ dữ liệu giữa các
  instance kể cả khác port, dùng hai `keyPrefix` khác nhau (`{ keyPrefix: "src:" }` / `"dst:"`) và ghi chú trong test.
- [ ] **Step 2: Test (fail)** — `test/migrate-store.test.ts`

```ts
import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateAll, migrateGame } from "../src/tools/migrate-store";
import { keysFor } from "../src/server/store";

type R = InstanceType<typeof RedisMock>;
let src: R;
let dst: R;
const k = keysFor("typhu");

beforeEach(async () => {
  src = new RedisMock({ port: 1 });
  dst = new RedisMock({ port: 2 });
  await src.flushall();
  await dst.flushall();
});

async function seedPlayer(r: R, key: string, f: { name: string; points: number; games: number; wins: number; last: number }) {
  await r.zincrby(k.lbPoints, f.points, key);
  await r.hset(k.lbPlayer(key), { name: f.name, points: f.points, games: f.games, wins: f.wins, last: f.last });
}

describe("migrateGame", () => {
  it("adds leaderboard totals for players on both sides and keeps the newest name", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    await seedPlayer(dst, "lan", { name: "lan", points: 4, games: 1, wins: 0, last: 100 });
    await seedPlayer(src, "minh", { name: "Minh", points: -2, games: 1, wins: 0, last: 150 });
    const r = await migrateGame(src as never, dst as never, "typhu", false);
    expect(r.players).toBe(2);
    expect(Number(await dst.zscore(k.lbPoints, "lan"))).toBe(14);
    expect(await dst.hgetall(k.lbPlayer("lan"))).toMatchObject({ name: "Lan", points: "14", games: "4", wins: "1", last: "200" });
    expect(Number(await dst.zscore(k.lbPoints, "minh"))).toBe(-2);
  });

  it("copies rooms the destination does not have, with their remaining TTL and lobby score", async () => {
    await src.hset(k.room("AAAAA"), { state: '{"code":"AAAAA"}', version: 7 });
    await src.pexpire(k.room("AAAAA"), 3_600_000);
    await src.zadd(k.index, 1234, "AAAAA");
    await src.hset(k.room("BBBBB"), { state: '{"code":"BBBBB","src":1}', version: 2 });
    await src.zadd(k.index, 99, "BBBBB");
    await dst.hset(k.room("BBBBB"), { state: '{"code":"BBBBB","dst":1}', version: 9 });
    const r = await migrateGame(src as never, dst as never, "typhu", false);
    expect(r).toMatchObject({ roomsCopied: 1, roomsSkipped: 1 });
    expect(await dst.hgetall(k.room("AAAAA"))).toEqual({ state: '{"code":"AAAAA"}', version: "7" });
    const ttl = await dst.pttl(k.room("AAAAA"));
    expect(ttl).toBeGreaterThan(3_590_000);
    expect(Number(await dst.zscore(k.index, "AAAAA"))).toBe(1234);
    expect((await dst.hgetall(k.room("BBBBB"))).state).toBe('{"code":"BBBBB","dst":1}');
  });

  it("skips index entries whose room is gone and never copies dedupe markers", async () => {
    await src.zadd(k.index, 1, "GONE1");
    await src.set(k.record("g-1"), "1");
    const r = await migrateGame(src as never, dst as never, "typhu", false);
    expect(r.roomsCopied).toBe(0);
    expect(await dst.exists(k.record("g-1"))).toBe(0);
    expect(await dst.zcard(k.index)).toBe(0);
  });

  it("writes nothing on a dry run but reports what it would do", async () => {
    await seedPlayer(src, "lan", { name: "Lan", points: 10, games: 3, wins: 1, last: 200 });
    await src.hset(k.room("AAAAA"), { state: "{}", version: 1 });
    await src.zadd(k.index, 1, "AAAAA");
    const r = await migrateGame(src as never, dst as never, "typhu", true);
    expect(r).toMatchObject({ players: 1, roomsCopied: 1, roomsSkipped: 0 });
    expect(await dst.dbsize()).toBe(0);
  });
});

describe("migrateAll", () => {
  it("covers every game", async () => {
    const all = await migrateAll(src as never, dst as never, true);
    expect(all.map((r) => r.game).sort()).toEqual(["bang", "cangua", "meono", "oanquan", "splendor", "tienlen", "typhu"]);
  });
});
```

- [ ] **Step 3: Chạy → FAIL** — `npx vitest run test/migrate-store.test.ts` (module chưa có).
- [ ] **Step 4: Cài đặt `src/tools/migrate-store.ts`**

```ts
// One-off copy of rooms and leaderboards from one Redis to another (e.g. the phone's local Redis → Upstash).
// Leaderboards are ADDED to the destination (run it once); rooms are copied only when the destination lacks them.
// Usage: tsx src/tools/migrate-store.ts --from <redis url> --to <redis url> [--dry-run]
import type { Redis } from "ioredis";
import { GAME_KINDS, type GameKind, keysFor } from "../server/store";

export interface MigrateResult {
  game: GameKind;
  players: number;
  roomsCopied: number;
  roomsSkipped: number;
}

export async function migrateGame(src: Redis, dst: Redis, game: GameKind, dryRun: boolean): Promise<MigrateResult> {
  const k = keysFor(game);
  const result: MigrateResult = { game, players: 0, roomsCopied: 0, roomsSkipped: 0 };

  const members = await src.zrange(k.lbPoints, 0, -1);
  for (const key of members) {
    const p = await src.hgetall(k.lbPlayer(key));
    result.players++;
    if (dryRun) continue;
    const delta = Number(p.points ?? (await src.zscore(k.lbPoints, key)) ?? 0);
    await dst.zincrby(k.lbPoints, delta, key);
    const h = k.lbPlayer(key);
    await dst.hincrby(h, "points", delta);
    await dst.hincrby(h, "games", Number(p.games ?? 0));
    await dst.hincrby(h, "wins", Number(p.wins ?? 0));
    const dstLast = Number((await dst.hget(h, "last")) ?? 0);
    if (Number(p.last ?? 0) >= dstLast) await dst.hset(h, { name: p.name ?? key, last: p.last ?? "0" });
  }

  const codes = await src.zrange(k.index, 0, -1, "WITHSCORES");
  for (let i = 0; i < codes.length; i += 2) {
    const code = codes[i];
    const score = Number(codes[i + 1]);
    const [state, version] = await src.hmget(k.room(code), "state", "version");
    if (state == null || version == null) continue;
    if (await dst.exists(k.room(code))) {
      result.roomsSkipped++;
      continue;
    }
    result.roomsCopied++;
    if (dryRun) continue;
    const ttl = await src.pttl(k.room(code));
    await dst.hset(k.room(code), { state, version });
    if (ttl > 0) await dst.pexpire(k.room(code), ttl);
    await dst.zadd(k.index, score, code);
  }
  return result;
}

export async function migrateAll(src: Redis, dst: Redis, dryRun: boolean): Promise<MigrateResult[]> {
  const out: MigrateResult[] = [];
  for (const game of GAME_KINDS) out.push(await migrateGame(src, dst, game, dryRun));
  return out;
}

async function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = arg("--from");
  const to = arg("--to");
  const dryRun = argv.includes("--dry-run");
  if (!from || !to) {
    console.error("usage: tsx src/tools/migrate-store.ts --from <redis url> --to <redis url> [--dry-run]");
    process.exit(1);
  }
  const { default: IORedis } = await import("ioredis");
  const src = new IORedis(from, { maxRetriesPerRequest: 3 });
  const dst = new IORedis(to, { maxRetriesPerRequest: 3 });
  console.log(`${dryRun ? "[dry run] " : ""}${new URL(from).hostname} → ${new URL(to).hostname}`);
  if (!dryRun) console.log("Leaderboards are ADDED to the destination: run this once.");
  try {
    for (const r of await migrateAll(src, dst, dryRun)) {
      console.log(`${r.game}: players ${r.players}, rooms copied ${r.roomsCopied}, rooms already there ${r.roomsSkipped}`);
    }
  } finally {
    src.disconnect();
    dst.disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/migrate-store.ts")) void main(process.argv.slice(2));
```

  Ghi chú: hash người chơi có `points` (hiện tại luôn có, do `RECORD_SCRIPT`); fallback `zscore` chỉ cho dữ liệu cũ.
- [ ] **Step 5: PASS** — `npx vitest run test/migrate-store.test.ts`; `npm run typecheck && npm test`.
- [ ] **Step 6: CLI chạy khô cục bộ** (không có Redis thật trên máy này): `npx tsx src/tools/migrate-store.ts` → in usage, exit 1;
  kiểm `--from redis://user:secret@h1:6379 --to rediss://x:y@h2:6380 --dry-run` in `h1 → h2` (không lộ `secret`) rồi
  thoát do không kết nối được (Ctrl+C / timeout là chấp nhận được).
- [ ] **Step 7: Commit** — `feat(tools): migrate rooms and leaderboards between Redis stores`.

---

### Task 3: be_game — compose lấy `REDIS_URL` từ `.env`, docs

**Files:** Modify `compose.selfhost.yml`, `docs/SELF_HOSTING.md`, `docs/DEPLOYMENT.md`, `.claude/rules/deploy.md`, `.env.example`.

- [ ] **Step 1:** `compose.selfhost.yml`: `REDIS_URL: redis://redis:6379` → `REDIS_URL: ${REDIS_URL:-redis://redis:6379}`
  (comment: "Set REDIS_URL in .env to the shared Upstash URL so the Vercel backup sees the same rooms; leave it unset
  to use the local redis service.").
- [ ] **Step 2: Kiểm compose** — `GAME_DOMAIN=game.example.com docker compose -f compose.selfhost.yml config` không chạy
  được ở máy này (không Docker): thay bằng kiểm CI (`ci.yml` đã chạy `docker compose config --quiet`), và đọc lại YAML.
  Ghi rõ trong báo cáo.
- [ ] **Step 3: Docs** —
  - `SELF_HOSTING.md`: bảng cấu hình thêm dòng `~/apps/be_game/.env` `REDIS_URL` (Upstash chung, bí mật, quyền 600; bỏ
    trống = Redis cục bộ); mục "Chuyển sang / quay lại kho chung" theo spec §4 và §6 (lệnh `docker compose run --rm
    --no-deps be_game node_modules/.bin/tsx src/tools/migrate-store.ts …`, cảnh báo chạy một lần); bộ đếm
    `BE_GAME_COUNT_COMMANDS=1`; xử lý sự cố "Hết hạn mức Upstash → cả hai máy lỗi".
  - `DEPLOYMENT.md`: sơ đồ và câu "Hai máy có Redis riêng" → hai máy dùng chung Upstash (sau khi chuyển), client tự sang
    máy còn lại với phòng đang chơi; `/api/health` có `sharedStore`.
  - `.claude/rules/deploy.md`: thêm luật — không in/commit URL Upstash; `migrate-store` chỉ chạy một lần mỗi chiều.
  - `.env.example`: dòng `# REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379  # self-host: share rooms with the Vercel backup`.
- [ ] **Step 4:** `npm run typecheck && npm test`; commit `feat(selfhost): REDIS_URL from .env to share the Upstash store; docs`.

---

### Task 4: zonenop-game — client thử máy còn lại

**Files:** Modify `src/components/games/gameClient.ts`, `src/components/games/gameClient.test.ts`, `docs/GAMES_GUIDE.md` (§1.2).

**Interfaces — Produces:** `export function basesToTry(roomBase: string | null, candidates: readonly string[]): string[]`.

- [ ] **Step 1: Nhánh** — `cd D:/WorkSpace/zonenop-game && git switch develop && git pull --ff-only && git switch -c feature/failover-shared-store`
- [ ] **Step 2: Test (fail)** — thêm vào `gameClient.test.ts`:

```ts
import { basesToTry } from "./gameClient";

describe("basesToTry", () => {
  const A = "https://play-api.example";
  const B = "https://backup.example";
  it("tries every candidate in order when the room's backend is unknown", () => {
    expect(basesToTry(null, [A, B])).toEqual([A, B]);
  });
  it("tries the pinned backend first, then the others (so a dead backend falls through)", () => {
    expect(basesToTry(B, [A, B])).toEqual([B, A]);
    expect(basesToTry(A, [A, B])).toEqual([A, B]);
  });
  it("keeps a pinned backend that is no longer configured out of the list", () => {
    expect(basesToTry("https://old.example", [A, B])).toEqual([A, B]);
  });
});
```
  (Sửa dòng import đầu file thành `import { basesToTry, fetchApi } from "./gameClient";` thay vì import thêm dòng.)
- [ ] **Step 3: FAIL** — `npx vitest run src/components/games/gameClient.test.ts`.
- [ ] **Step 4: Cài đặt** — trong `gameClient.ts`:

```ts
/**
 * Backends to try for a room: the one it was joined on first, then the others. With a store shared by both backends a
 * room survives its backend going down, so a dead pinned backend falls through to the next; with separate stores the
 * other backend answers "Không tìm thấy phòng" and the loop goes back to waiting for the pinned one.
 */
export function basesToTry(roomBase: string | null, candidates: readonly string[]): string[] {
  if (!roomBase || !candidates.includes(roomBase)) return [...candidates];
  return [roomBase, ...candidates.filter((b) => b !== roomBase)];
}
```
  và trong `open()`: `const bases = roomBase ? [roomBase] : await candidateBases();` →
  `const bases = basesToTry(roomBase, roomBase ? SERVER_BASES : await candidateBases());`
  (khi đã ghim thì dùng thứ tự cấu hình, không chờ probe 3 s). Giữ nguyên phần còn lại của vòng lặp: `unreachable` →
  thử máy tiếp; `not-found` → thử máy tiếp; hết danh sách mà có `unreachable` → `scheduleRetry()` như cũ. Khi join thành
  công ở máy khác thì `roomBase = base; rememberRoomServer(...)` (đã có).
- [ ] **Step 5: PASS + toàn bộ** — `npm run lint && npm run typecheck && npm test`.
- [ ] **Step 6: Docs** — `GAMES_GUIDE.md` §1.2: phòng không còn bị khoá vào một máy khi máy đó sập: client thử máy đã
  ghim rồi máy còn lại; chỉ chơi tiếp được khi hai backend dùng chung kho (be_game `docs/SELF_HOSTING.md`).
- [ ] **Step 7: Commit** — `feat(games): fall back to the other backend for an open room when its backend is down`.

---

### Task 5: Diễn tập chuyển máy + đo hạn mức (cổng: cần URL Upstash)

**Điều kiện:** controller có URL Upstash từ người dùng (biến môi trường `UPSTASH_URL` trong shell của implementer,
không ghi vào file nào trong repo). Không có URL → task dừng ở NEEDS_CONTEXT.

- [ ] **Step 1: Hai backend local cùng Upstash** (từ `D:/WorkSpace/be_game`, nhánh Task 1–3):
  `PORT=4123 REDIS_URL="$UPSTASH_URL" BE_GAME_COUNT_COMMANDS=1 npx tsx src/local.ts > "$TEMP/shots/be-a.log" 2>&1 &`
  `PORT=4124 REDIS_URL="$UPSTASH_URL" npx tsx src/local.ts > "$TEMP/shots/be-b.log" 2>&1 &`
  Kiểm `/api/health` cả hai: `sharedStore: true`, cùng `redisHost` (in host thôi).
- [ ] **Step 2: Frontend** (zonenop-game, nhánh Task 4):
  `NEXT_PUBLIC_TIENLEN_SERVER_URL=http://localhost:4123 NEXT_PUBLIC_TIENLEN_FALLBACK_URL=http://localhost:4124 npx next dev -p 3105`.
- [ ] **Step 3: Đo hạn mức** — bàn Cờ Tỷ Phú 4 người (`$TEMP/shots/typhu-bots.mjs` với `GAME_SERVER=http://localhost:4123`
  + 1 người Playwright) chơi 10 phút; đọc các dòng `redis commands last 60s` trong `be-a.log`; quy ra lệnh/giờ-bàn.
  Ghi kèm "Upstash có thể tính mỗi lệnh trong EVAL → nhân tối đa ~5" và đề nghị người dùng đối chiếu dashboard.
  Nếu bộ đếm báo 0 trong khi ván đang chạy (auto-pipelining của ioredis đi vòng qua `sendCommand`), không sửa thêm:
  ghi nhận và dựa vào dashboard Upstash (người dùng đọc số trước/sau 10 phút).
- [ ] **Step 4: Diễn tập Cờ Tỷ Phú** — trong ván đang chơi (người Playwright trên `localhost:3105` đang ở `:4123`):
  ghi lại lượt hiện tại, tiền, vị trí của mọi người; dừng tiến trình 4123 (theo cổng, kiểm command line); trong ≤ 15 s
  trang hiện lại bàn, cùng mã phòng, cùng lượt/tiền/vị trí; người chơi đi tiếp được một nước; bot (nối 4123) cũng phải
  nối lại — sửa `typhu-bots.mjs` bản sao để bot thử `:4124` khi `:4123` đóng, cùng token.
- [ ] **Step 5: Diễn tập Tiến Lên** — 2 context Playwright cùng bàn Tiến Lên trên `:4123`, chia bài, ghi số lá mỗi người;
  dừng 4123; cả hai về `:4124`, cùng số lá, cùng lượt; đánh tiếp một nước.
- [ ] **Step 6: Bật lại 4123** — người mới vào sảnh (qua `:4123`) thấy đúng một phòng mỗi ván; vào phòng thấy đúng trạng
  thái hiện tại (không có bản cũ).
- [ ] **Step 7: Dọn** — dừng mọi tiến trình đã bật (theo cổng, kiểm command line); phòng thử để tự hết hạn.
- [ ] **Step 8: Báo cáo** — số đo lệnh/giờ-bàn, thời gian chuyển máy, ảnh chụp trước/sau, mọi lỗi gặp phải. Không commit
  gì (trừ khi phải sửa code Task 1–4 — khi đó quay lại task tương ứng).

---

### Task 6: Review toàn nhánh (cả hai repo), PR

- [ ] be_game: review nhánh `feature/shared-store-failover`; push; PR vào `main` (kèm số đo Task 5).
- [ ] zonenop-game: review nhánh `feature/failover-shared-store`; push; PR vào `develop`.
- [ ] Merge be_game PR → auto-deploy điện thoại (compose mới, `.env` chưa có `REDIS_URL` → vẫn Redis cục bộ; kiểm
  `/api/health` `sharedStore: false`, ván cũ vẫn chạy). Hai bước merge và push là quyết định của người dùng.

---

### Task 7: Chuyển điện thoại sang Upstash (cổng: người dùng duyệt + URL)

Chỉ chạy khi: be_game PR đã deploy; người dùng đã xem số đo Task 5 và chọn gói Upstash phù hợp; người dùng nói rõ "chuyển".

- [ ] **Step 1:** `ssh vsmart-zangyapro`; `cd ~/apps/be_game`; ghi lại top 10 bảng xếp hạng mỗi game từ
  `https://play-api.fudio101.com/api/<game>/leaderboard` (trước).
- [ ] **Step 2:** `docker compose -f compose.selfhost.yml stop be_game`.
- [ ] **Step 3:** `docker compose -f compose.selfhost.yml run --rm --no-deps be_game node_modules/.bin/tsx src/tools/migrate-store.ts --from redis://redis:6379 --to "$UPSTASH_URL" --dry-run`
  (URL truyền qua biến môi trường của phiên SSH, không ghi vào lịch sử: `read -rs UPSTASH_URL; export UPSTASH_URL`). Đọc số liệu.
- [ ] **Step 4:** chạy lại không `--dry-run` **đúng một lần**.
- [ ] **Step 5:** thêm `REDIS_URL=<Upstash>` vào `.env` (`chmod 600 .env`); `docker compose -f compose.selfhost.yml up -d be_game`.
- [ ] **Step 6:** kiểm `/api/health` hai máy: cùng `redisHost`, `sharedStore: true`; top 10 bảng xếp hạng = trước + điểm
  máy dự phòng; một ván bot ngắn trên `play-api` thấy được từ `be-game-omega` (`/api/typhu/rooms`).
- [ ] **Step 7:** zonenop-game PR (Task 4) lên `main` (release) để người chơi production có failover. Quyết định của người dùng.
- [ ] **Step 8:** Docs: cập nhật `SELF_HOSTING.md` trạng thái "đang dùng kho chung từ <ngày>".
