---
paths:
  - "src/server/**"
  - "api/**"
  - "src/local.ts"
---

# Server / transport rules

- All entry points (`api/*.ts`, `src/local.ts`) only serve `createGameServer()`; routing lives in the `ROUTES` table of `src/server/app.ts`. **Do not add files to `api/`**: Vercel Hobby allows 12 functions (5 used) and `api/[game]/[kind].ts` already serves every `/api/<game>/<ws|rooms|leaderboard>`.
- A new game touches `GameKind` (`store.ts`), an adapter in `ADAPTERS` (`adapters.ts`) and three routes in `app.ts` — see `docs/GUIDE.md` → "Thêm một game mới".
- Room writes go through the store's compare-and-swap (`mutate`); never write a room without it. Multiple instances (Vercel) share state only through Redis + pub/sub.
- `isAllowedOrigin` (`hub.ts`) guards both the WebSocket upgrade (403) and CORS. Requests without `Origin` stay allowed (non-browser clients). Keep `test/origin.test.ts` in step with any change; the live allow-list is documented in `docs/SELF_HOSTING.md`.
- `GET /api/health` is an operations contract: the deploy workflow reads `ok` and `commit` (`BUILD_COMMIT` / `VERCEL_GIT_COMMIT_SHA`), operators read `redisHost`, `sharedStore` and `now`. Keep those fields (and the error path `ok:false, error`) and update the field list in `docs/GUIDE.md` → HTTP endpoints when you change it.
- Keep graceful shutdown working (`SIGTERM` → stop accepting, close sockets with 1001) — Docker deploys rely on it.
- `tsconfig.json` stays `module: "CommonJS"`.
- Hub behaviour changes need a hub-level test (`test/hub.test.ts` uses `FakeSocket` and two hubs on one memory store to simulate two instances).
