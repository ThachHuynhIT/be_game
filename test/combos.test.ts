import { describe, expect, it } from "vitest";
import { parseCards as c } from "../src/game/cards";
import { canBeat, detectCombo, isChop } from "../src/game/combos";
import { detectInstantWin } from "../src/game/rules";

const combo = (labels: string) => {
  const r = detectCombo(c(labels));
  if (!r) throw new Error(`not a combo: ${labels}`);
  return r;
};

describe("detectCombo", () => {
  it.each([
    ["3s", "single"],
    ["5s 5h", "pair"],
    ["9c 9d 9h", "triple"],
    ["Ks Kc Kd Kh", "quad"],
    ["3s 4h 5d", "straight"],
    ["10s Jc Qd Kh As", "straight"],
    ["3s 3h 4s 4h 5c 5d", "pairSeq"],
    ["7s 7h 8s 8h 9c 9d 10c 10d", "pairSeq"],
  ])("%s → %s", (labels, type) => {
    expect(combo(labels).type).toBe(type);
  });

  it.each([
    "3s 4h", // two different ranks
    "3s 5h 6d", // gap
    "Ks As 2h", // 2 cannot be in a straight
    "Qs Qh Ks Kh As Ah 2s 2h", // 2 cannot be in đôi thông
    "3s 3h 4s 4h", // only 2 pairs
    "3s 3h 3d 4s 4h 4d", // triples, not pairs
    "5s 5h 5d 5c 5s", // duplicate card
  ])("rejects %s", (labels) => {
    expect(detectCombo(c(labels))).toBeNull();
  });
});

describe("canBeat", () => {
  it("lets anything lead a fresh round", () => {
    expect(canBeat(null, combo("3s"))).toBe(true);
  });

  it("compares same type by top card, suit breaking rank ties", () => {
    expect(canBeat(combo("5s"), combo("5h"))).toBe(true);
    expect(canBeat(combo("5h"), combo("5s"))).toBe(false);
    expect(canBeat(combo("As"), combo("2s"))).toBe(true);
    expect(canBeat(combo("7s 7c"), combo("7d 7h"))).toBe(true);
    expect(canBeat(combo("3s 4s 5s"), combo("3h 4h 5h"))).toBe(true);
    expect(canBeat(combo("3s 4s 5h"), combo("3h 4h 5d"))).toBe(false);
  });

  it("requires same type and length", () => {
    expect(canBeat(combo("3s 4s 5s"), combo("4s 5s 6s 7s"))).toBe(false);
    expect(canBeat(combo("9s"), combo("3s 3h"))).toBe(false);
    expect(canBeat(combo("3s 3h 3d"), combo("4s 4h 4d 4c"))).toBe(false);
  });

  it("3 đôi thông chặt 1 heo but not đôi heo", () => {
    const seq3 = combo("3s 3h 4s 4h 5c 5d");
    expect(canBeat(combo("2h"), seq3)).toBe(true);
    expect(isChop(combo("2h"), seq3)).toBe(true);
    expect(canBeat(combo("2s 2h"), seq3)).toBe(false);
  });

  it("tứ quý chặt heo, đôi heo, 3 đôi thông", () => {
    const quad = combo("3s 3c 3d 3h");
    expect(canBeat(combo("2h"), quad)).toBe(true);
    expect(canBeat(combo("2s 2h"), quad)).toBe(true);
    expect(canBeat(combo("Js Jh Qs Qh Ks Kh"), quad)).toBe(true);
    expect(canBeat(combo("As"), quad)).toBe(false);
    expect(canBeat(combo("4s 4c 4d 4h"), quad)).toBe(false);
  });

  it("4 đôi thông chặt everything above, including tứ quý", () => {
    const seq4 = combo("3s 3h 4s 4h 5c 5d 6c 6d");
    expect(canBeat(combo("2h"), seq4)).toBe(true);
    expect(canBeat(combo("2s 2h"), seq4)).toBe(true);
    expect(canBeat(combo("Js Jh Qs Qh Ks Kh"), seq4)).toBe(true);
    expect(canBeat(combo("As Ac Ad Ah"), seq4)).toBe(true);
    expect(canBeat(seq4, combo("As Ac Ad Ah"))).toBe(false);
  });
});

describe("detectInstantWin (tới trắng)", () => {
  it("tứ quý heo", () => {
    expect(detectInstantWin(c("2s 2c 2d 2h 3s 5h 7d 9c Js Kh 4d 6c 8h"))).toBe("fourTwos");
  });
  it("sảnh rồng", () => {
    expect(detectInstantWin(c("3s 4s 5s 6s 7s 8s 9s 10s Js Qs Ks As 3h"))).toBe("dragon");
  });
  it("6 đôi", () => {
    expect(detectInstantWin(c("3s 3h 5s 5h 7s 7h 9s 9h Js Jh Ks Kh 2d"))).toBe("sixPairs");
  });
  it("5 đôi thông", () => {
    // 5 consecutive pairs plus a triple → only 5 pairs total from those, plus no 6th pair.
    expect(detectInstantWin(c("3s 3h 4s 4h 5s 5h 6s 6h 7s 7h 7d 9c Jd"))).toBe("fivePairSeq");
  });
  it("ordinary hand", () => {
    expect(detectInstantWin(c("3s 4h 5d 7c 8s 9h 10d Jc Qs Kh As 2d 2c"))).toBeNull();
  });
});
