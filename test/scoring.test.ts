import { describe, expect, it } from "vitest";
import { parseCards as c } from "../src/game/cards";
import { detectCombo } from "../src/game/combos";
import { chopPoints, scoreGame, scoreTienLen } from "../src/game/scoring";

const sum = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);

describe("scoreTienLen", () => {
  it("gives Nhất +2 and Nhì +1, and sums to zero", () => {
    expect(scoreTienLen(["a", "b", "c", "d"], null)).toEqual({ a: 2, b: 1, c: -1, d: -2 });
    expect(scoreTienLen(["a", "b", "c"], null)).toEqual({ a: 2, b: 1, c: -3 });
    expect(scoreTienLen(["a", "b"], null)).toEqual({ a: 2, b: -2 });
    for (const f of [["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]]) expect(sum(scoreTienLen(f, null))).toBe(0);
  });

  it("tới trắng pays double: winner takes 4 from everyone", () => {
    const d = scoreTienLen(["w", "x", "y", "z"], "w");
    expect(d).toEqual({ w: 12, x: -4, y: -4, z: -4 });
    expect(sum(d)).toBe(0);
  });

  it("adds chặt heo transfers", () => {
    const d = scoreTienLen(["a", "b", "c", "d"], null, [{ from: "a", to: "d", points: 2 }]);
    expect(d).toEqual({ a: 0, b: 1, c: -1, d: 0 });
    expect(sum(d)).toBe(0);
  });

  it("chết cháy doubles the loss and Nhất collects the extra", () => {
    expect(scoreTienLen(["a", "b", "c", "d"], null, [], ["d"])).toEqual({ a: 4, b: 1, c: -1, d: -4 });
    expect(scoreTienLen(["a", "b", "c", "d"], null, [], ["c", "d"])).toEqual({ a: 5, b: 1, c: -2, d: -4 });
    expect(scoreTienLen(["a", "b"], null, [], ["b"])).toEqual({ a: 4, b: -4 });
    expect(sum(scoreTienLen(["a", "b", "c"], null, [], ["c"]))).toBe(0);
  });

  it("values heo đen 1, heo đỏ 2, chặt chồng 2", () => {
    expect(chopPoints(detectCombo(c("2s"))!)).toBe(1);
    expect(chopPoints(detectCombo(c("2h"))!)).toBe(2);
    expect(chopPoints(detectCombo(c("2c 2d"))!)).toBe(3);
    expect(chopPoints(detectCombo(c("4s 4h 5s 5h 6c 6d"))!)).toBe(2);
  });
});

describe("scoreGame (Mèo Nổ, Cờ Tỷ Phú)", () => {
  it("keeps the symmetric table", () => {
    expect(scoreGame(["a", "b", "c", "d"], null)).toEqual({ a: 3, b: 1, c: -1, d: -3 });
    expect(sum(scoreGame(["a", "b", "c", "d", "e", "f"], null))).toBe(0);
  });
});
