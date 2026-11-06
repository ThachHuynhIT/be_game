// Runs before every unit test file (vitest.config.ts `setupFiles`). Each test starts with the same seeded
// Math.random, so code that draws with no way to inject `random` (a room's `start` deals through the adapter,
// room codes, ids) gives the same result on every run. Unseeded, a Tiến Lên deal ends at once as a "tới trắng"
// about 2–3% of the time, which made several tests fail now and then on CI (and red CI on main blocks deploys).
// A test may still seed differently itself (seedMathRandom, fuzz tests' own rng); this only sets the default.
import { afterEach, beforeEach, vi } from "vitest";
import { rng } from "./helpers/rng";

export const DEFAULT_SEED = 1;

beforeEach(() => {
  vi.spyOn(Math, "random").mockImplementation(rng(DEFAULT_SEED));
});

afterEach(() => {
  vi.mocked(Math.random).mockRestore?.();
});
