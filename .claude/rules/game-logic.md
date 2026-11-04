---
paths:
  - "src/game/**"
  - "src/meono/**"
  - "src/typhu/**"
  - "src/splendor/**"
  - "src/bang/**"
  - "src/cangua/**"
  - "src/oanquan/**"
  - "src/noichu/**"
---

# Game logic rules

- `game.ts` / `room.ts` are pure: no timers, I/O, `Date.now()` or direct `Math.random()` calls. Take `now` and `random: () => number` as parameters and pass `random` to every helper that shuffles, rolls or picks (a forgotten pass-through makes seeded fuzz tests flaky in CI).
- State must survive `JSON.parse(JSON.stringify(s))` unchanged: no `Map`/`Set`/class instances/`NaN`/`-0` (write `0 - x`, not `-x`, when x can be 0); do not rely on `undefined` keys.
- Commands return `{ ok: true } | { ok: false; error: string }` with a **Vietnamese** error message. A rejected command is rolled back by the hub — return `ok: true` plus a log line for changes that must persist.
- New state/settings fields are optional and read with defaults (`xxxSettingsOf(room)`, `field ?? default`): rooms already in Redis (12 h TTL) do not have them.
- `settings` is refused while a game is running and copied into the game state at `start`.
- Views/summaries decide visibility: never include `token`; private data only for the owning player, never for spectators.
- Every game must end: timeouts and absent players are handled in `tickGame`/`tickXxx`, and `nextGameTickAt` returns the next deadline.
- **Frontend sync**: `cards.ts`/`board.ts` (and `src/game/{cards,combos,rules}.ts`) are copied verbatim into `zonenop-game/src/lib/<game>/`; `protocol.ts` has a hand-edited copy there. Change both together and say so in the PR.
- **Seats**: every `joinXxx` re-attaches through `findReturning` (own token, else an offline same-name seat), and every path that frees a seat (not kick) calls `rememberGone` so `takeGone`/`seatFor` restore id and stats (`room.gone`, server-only, never in views). A new game must do the same (`docs/GUIDE.md` → "Vào lại phòng").
- Update `docs/games/<game>.md` (and the tables in `docs/GUIDE.md` / `README.md` when player counts or endpoints change) in the same commit.
- After rule changes run that game's tests and its fuzz test (`npx vitest run test/<game>.test.ts test/fuzz-<game>.test.ts`).
