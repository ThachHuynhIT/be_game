import { describe, expect, it } from "vitest";
import { scoreGame } from "../src/game/scoring";

const sum = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);

describe("scoreGame", () => {
  it("scores 4, 3 and 2 player games by finishing order and sums to zero", () => {
    expect(scoreGame(["a", "b", "c", "d"], null)).toEqual({ a: 3, b: 1, c: -1, d: -3 });
    expect(scoreGame(["a", "b", "c"], null)).toEqual({ a: 2, b: 0, c: -2 });
    expect(scoreGame(["a", "b"], null)).toEqual({ a: 1, b: -1 });
    for (const f of [["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]]) expect(sum(scoreGame(f, null))).toBe(0);
  });

  it("tới trắng: winner takes 2 from everyone", () => {
    const d = scoreGame(["w", "x", "y", "z"], "w");
    expect(d).toEqual({ w: 6, x: -2, y: -2, z: -2 });
    expect(sum(d)).toBe(0);
  });
});
