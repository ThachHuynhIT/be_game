# CLAUDE.md

This file provides guidance to Claude Code and other AI coding assistants when working with code in this repository. Path-scoped rules live in [`.claude/rules/`](.claude/rules/) and load automatically when you touch matching files.

---

## 🔧 Language & Tech Stack

- **Language**: TypeScript (strict), `module: "CommonJS"` in `tsconfig.json` — keep it; Vercel compiles extensionless relative imports only this way.
- **Runtime**: Node 22, plain `http.Server` + [`ws`](https://github.com/websockets/ws), run with `tsx` (no build step).
- **State**: Redis via `ioredis` (`REDIS_URL` / `KV_URL` / `UPSTASH_REDIS_URL`), in-memory store when unset.
- **Tests**: `vitest`.
- **Deploy targets**: Vercel Functions (`api/`, region `sin1`) and the self-hosted Docker Compose stack (`compose.selfhost.yml`).
- **Frontend**: the separate [portfolio](https://github.com/ThachHuynhIT/portfolio) repo (Next.js) connects via `NEXT_PUBLIC_TIENLEN_SERVER_URL`.

---

## 🚀 Key Commands

```bash
npm run dev        # tsx watch src/local.ts → http://localhost:4000, ws://localhost:4000/api/ws
npm start          # same, no watch
npm test           # vitest run (all tests incl. fuzz)
npm run typecheck  # tsc --noEmit (api/, src/, test/)
npx vitest run test/<file>.test.ts   # one file
FUZZ_SEEDS=500 npx vitest run test/fuzz-meono.test.ts   # deeper fuzzing where supported
```

Before finishing any change: `npm run typecheck && npm test`. CI (`.github/workflows/ci.yml`) runs both plus a Docker build + smoke test, and only a green CI on `main` deploys.

---

## 📚 Documentation Index (Vietnamese)

- [`README.md`](README.md): overview, endpoints, local run, Vercel deploy.
- [`docs/GUIDE.md`](docs/GUIDE.md): **developer guide** — architecture (hub, store, adapters), WebSocket protocol, tick/deadlines, presence, scoring/leaderboard, HTTP endpoints, env vars, test conventions, adding a new game (both repos), conventions & known traps.
- [`docs/games/<game>.md`](docs/games/): rules and state machine of each game.
- [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md): self-hosted server, CD workflow, where every config value lives, runbook, shared-host rules, troubleshooting.

Update the relevant doc **in the same commit** as the code it describes.

---

## 🏛️ Architecture (short)

`api/*.ts` (Vercel) and `src/local.ts` (local/self-host) all serve `createGameServer()` from `src/server/app.ts`, which routes by path (`ROUTES`: 7 games × `ws|rooms|leaderboard`). WebSocket connections go to `attachConnection()` → a `RoomHub` per game (`src/server/hub.ts`) → `RoomStore` (`src/server/store.ts`, Redis CAS + pub/sub, or memory) → the game's `GameAdapter` (`src/server/adapters.ts`) → pure game code in `src/<game>/{room,game}.ts`.

| Game | Dir | WS path |
|---|---|---|
| Tiến Lên | `src/game/` | `/api/ws` |
| Mèo Nổ | `src/meono/` | `/api/meono/ws` |
| Cờ Tỷ Phú | `src/typhu/` | `/api/typhu/ws` |
| Đá Quý (Splendor) | `src/splendor/` | `/api/splendor/ws` |
| Đấu Súng (Bang!) | `src/bang/` | `/api/bang/ws` |
| Cờ Cá Ngựa | `src/cangua/` | `/api/cangua/ws` |
| Ô Ăn Quan | `src/oanquan/` | `/api/oanquan/ws` |

Vercel Hobby allows 12 functions; there are 5. **Never add files to `api/`** for a new game — add routes in `app.ts` (`api/[game]/[kind].ts` already catches `/api/<game>/<kind>`).

---

## 🧩 Non-negotiable Engineering Rules

1. **Game code is a pure state machine.** `src/<game>/game.ts` and `room.ts`: no timers, no I/O, no `Date.now()`; `now` and `random: () => number` are parameters and are passed down to every helper that shuffles, rolls or picks. `Math.random` may appear only as a parameter default (`random = Math.random`), never called directly. This is what makes fuzz tests seeded and reproducible.
2. **State is plain JSON.** No `Map`/`Set`/classes/`undefined`-as-meaning/`NaN`/`-0` (use `0 - x`). `JSON.parse(JSON.stringify(state))` must deep-equal the state (it round-trips through Redis).
3. **Rejected commands change nothing.** The hub discards the draft when a command returns `{ ok: false }`; anything that must stick returns `ok: true` with a log line.
4. **Results**: `{ ok: true } | { ok: false; error: string }`, error text in **Vietnamese** (shown to players as-is).
5. **Views are the only security boundary.** Never put `token` in a view/summary; private data (hand, role) only for the owning `player`, never for spectators.
6. **Old rooms in Redis (12 h TTL) may lack new fields**: read settings through `xxxSettingsOf(room)`, make new state fields optional with defaults.
7. **Settings are frozen once a game starts** (copied into the game state at `start`).

---

## 🔁 Cross-repo Sync with portfolio

The portfolio keeps client copies for validation/rendering. Changing any of these means changing the portfolio copy in the same batch of work:

- Verbatim copies: `src/game/{cards,combos,rules}.ts` → `portfolio/src/lib/tienlen/`; `src/typhu/board.ts`, `src/cangua/board.ts`, `src/splendor/cards.ts`, `src/bang/cards.ts`, `src/oanquan/board.ts` → `portfolio/src/lib/<game>/`.
- Hand-edited copies: every `src/<game>/protocol.ts` (different imports, re-declared types, optional fields for older servers).

Details: `docs/GUIDE.md` → "Quy ước chung & bẫy thường gặp" and "Thêm một game mới".

---

## 🚢 Deploy & the Shared Host

- **Vercel** project `be-game` (`be-game-omega.vercel.app`): kept as fallback.
- **Self-hosted (live)**: `https://game.fudio101.com` → Cloudflare Tunnel → Traefik → `be_game` on host `vsmart-zangyapro` (an arm64 **phone**, shared with its owner `fudio101`). Deployed by `.github/workflows/deploy.yml` after CI passes on `main`. Everything is in [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).
- On that host: work only in `/home/zonenop`; owner's containers/files are read-only; **never** `docker system|volume|builder prune` or `image prune -a`; ask before Docker restart, reboot, `apk add`; never touch kernel/boot/firewall/sshd/Tailscale/WiFi/power.
- **The owner sometimes edits `~/apps/be_game` directly.** Before any deploy from the repo, diff the server copy against the repo and bring their changes in first.
- Production deploys of the **portfolio** on Vercel are the user's to trigger.

---

## ✍️ Commits & PRs

- Subject prefix = area, lower-case: `typhu: …`, `hub: …`, `test: …`, `docs: …`, `ci(deploy): …`, `deploy: …`. Imperative, says what changed for players/operators.
- Body explains *why* and how it was verified (tests run, fuzz seeds, deploy tested against the server).
- Work on a branch and open a PR to `main`; merging to `main` deploys.
