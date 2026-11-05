import { vi } from "vitest";

/** Small seeded PRNG (mulberry32): same seed, same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * For code that calls Math.random with no way to inject it (a room's `start` deals through the adapter):
 * makes it deterministic until the returned restore runs. An unseeded Tiến Lên deal is sometimes a
 * "tới trắng" instant win that ends the game at once, which made such tests fail now and then on CI.
 */
export function seedMathRandom(seed: number): () => void {
  const spy = vi.spyOn(Math, "random").mockImplementation(rng(seed));
  return () => spy.mockRestore();
}
