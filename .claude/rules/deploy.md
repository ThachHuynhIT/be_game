---
paths:
  - ".github/workflows/**"
  - "compose.selfhost.yml"
  - "docker-compose.yml"
  - "Dockerfile"
  - ".dockerignore"
  - "Caddyfile"
  - "docs/SELF_HOSTING.md"
  - "docs/DEPLOYMENT.md"
  - "vercel.json"
  - ".env.example"
---

# Deploy / infrastructure rules

Read `docs/DEPLOYMENT.md` (environments, release flow) and `docs/SELF_HOSTING.md` (the server) first. Two backends are live at once — self-hosted primary and Vercel backup, separate Redis today (shared-Upstash cutover not done) — and the zonenop-game frontend fails over between them. The live server `vsmart-zangyapro` is an arm64 phone **shared with its owner** (`fudio101`); we are user `zonenop`.

## On the server
- Work only in `/home/zonenop` and in our own containers/images/compose project (`be_game`). Home Assistant, Traefik, cloudflared, `/home/fudio101` and `vsmart-zangyapro-homeserver-*` services are read-only.
- Never `docker system prune`, `docker volume prune`, `docker builder prune` or `docker image prune -a`. Remove our own images by name/ID.
- Builds run in our own BuildKit builder (`be_game`, driver `docker-container`), never the daemon's `default` one the owner shares. The deploy caps that builder's cache (`docker buildx prune --builder be_game --max-used-space 1gb`) and stops it; pruning is only ever scoped with `--builder <ours>`.
- Ask the user before: restarting the Docker daemon, rebooting, `apk add`. Never: `apk upgrade`, kernel/`/boot`, firewall, sshd, Tailscale, NetworkManager, `/sys/class/power_supply`.
- Before deploying from the repo, diff `~/apps/be_game` on the server against the repo: the owner edits files there directly. Bring their changes into the repo first or the deploy overwrites them.
- Images must run on `linux/arm64`; services need `restart: unless-stopped` and data on disk (bind mounts under the deploy dir, not named volumes) — the phone can power off hard.

## Workflow & compose
- `compose.selfhost.yml` publishes no ports; be_game joins the external `traefik_network` and is routed by labels on `GAME_DOMAIN` (required in `.env`). Any CI step that runs `docker compose config` on it must pass `GAME_DOMAIN=game.example.com`.
- The deploy script runs under `set -euo pipefail`: never pipe into a command that exits early (`| head`, `| grep -q`) — capture output in a variable and test it. Both patterns already caused random exit 141 / false health failures.
- Health checks run inside the container (`docker compose exec -T be_game node -e "fetch(...)"`); the image has no `curl` and port 4000 is not on the host.
- Keep `data/` and `.env` untouched by the deploy; keep the guard that refuses to clean a non-be_game directory.
- `DEPLOY_PATH` must stay an absolute path under `$HOME` (the script refuses anything else). Set path secrets from Git Bash with `MSYS_NO_PATHCONV=1`, or `/home/...` turns into `C:/Program Files/Git/home/...`.
- Deploy only from `workflow_run` of a **push** CI on `main` (or a manual run on `main`); PR CI must never deploy. Keep `id-token: write` (Tailscale OIDC) and pin the server host key (`StrictHostKeyChecking yes`).
- Test workflow script changes by extracting the `REMOTE` script and running it against the server (twice, to cover the "nothing changed" path) before pushing; report what was verified in the PR.
- The shared Upstash URL (`REDIS_URL` in the server `.env`) is a secret: never print it, commit it, put it in GitHub secrets or paste it in a doc/PR (placeholders like `rediss://default:<password>@<host>.upstash.io:6379` only). Enter it with `read -rs`, pass it to tools as `env:NAME` (never on argv: `ps` on the shared phone shows it) and write it to `.env` with `printf`, not `echo`/an editor paste into history.
- `src/tools/migrate-store.ts` ADDS leaderboards to the destination: run it once (local → Upstash only), `--dry-run` first, never re-run after a failure without checking the destination (a successful real run leaves the marker `be_game:migrated:<source host>:<port>` in the destination and a second real run is refused; `--force` overrides it, use only when you know the destination holds none of the source's leaderboards), always add `--label traefik.enable=false` to `docker compose run --rm --no-deps … be_game … migrate-store` so Traefik never routes live traffic to the one-off container, and **never migrate back from Upstash into the old local Redis** (it would add the pre-cutover leaderboard twice). Rolling back = remove `REDIS_URL` from `.env`. Switching the server to/from the shared store follows `docs/SELF_HOSTING.md` → "Chuyển sang / quay lại kho chung".
- `DATABASE_URL` (Neon) and `SESSION_SECRET` are secrets like `REDIS_URL`: never log, print, commit, echo, put in GitHub secrets or paste into a doc/PR. Enter them with `read -rs` + `printf ... >> .env` + `chmod 600` (on Vercel via the dashboard / env API); generate the secret with `openssl rand -base64 32`. Do not `cat .env` or run `docker compose config` on the server (it prints resolved values). Both backends need the same `SESSION_SECRET` and `DATABASE_URL`; deploy order and checks: `docs/DEPLOYMENT.md` → "Triển khai tài khoản".
- The deploy verifies the served commit: `/api/health` must report `commit` = the SHA shipped (`BUILD_COMMIT` via compose on the phone, `VERCEL_GIT_COMMIT_SHA` on Vercel) in the in-container and public checks, and the `vercel` job (repo variable `VERCEL_HEALTH_URL`) waits up to 10 min for Vercel. Keep `commit` in the health payload and `BUILD_COMMIT` in `compose.selfhost.yml`.
- Production deploys of the frontend (zonenop-game, Vercel) are the user's call.
