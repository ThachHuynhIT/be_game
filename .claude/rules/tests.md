---
paths:
  - "test/**"
---

# Test rules

- Time is a parameter: use a constant like `T = 1_000_000` and pass `T + n`. No fake timers.
- Randomness is injected: pass `() => 0`, a queued `dice(...)`, or a seeded `rng(seed)` into every `new*Game` / `tickGame` / shuffle / roll. A test must give the same result on every run — if a test can fail on CI but not locally, look for an un-injected `Math.random()` or `Date.now()` in `src/`.
- Build state by hand after creating a game (`s.turn = …`, `s.hands = …`); state is plain JSON so this is safe.
- Helpers: `names = (id) => id` for `NameOf`, `never = () => false` for `absent`; tokens are at least 8 characters.
- Hub tests: `createRoomHub(createMemoryRoomStore(), xxxAdapter)`, then `hub.createRoom()` / `hub.mutate(code, …)`.
- Fuzz tests (`fuzz-<game>.test.ts`) check invariants: no exceptions, games always end, cards/money/pieces conserved, JSON round-trip equality, rejected commands leave state unchanged, views never leak tokens or hidden cards. Keep each file under ~5 s by default; deeper runs via `FUZZ_SEEDS` where supported.
- A bug found by fuzzing gets a focused regression test and a line in `docs/GUIDE.md` → "Lỗi đã bắt bằng fuzz".
- Run `npm run typecheck && npm test` before finishing.
