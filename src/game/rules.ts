import { type Card, RANK_TWO, rankOf } from "./cards";

export type InstantWinReason = "fourTwos" | "dragon" | "sixPairs" | "fivePairSeq";

export const INSTANT_WIN_NAMES: Record<InstantWinReason, string> = {
  fourTwos: "Tứ quý heo",
  dragon: "Sảnh rồng",
  sixPairs: "6 đôi",
  fivePairSeq: "5 đôi thông",
};

/** Tới trắng: a dealt 13-card hand that wins immediately. */
export function detectInstantWin(hand: Card[]): InstantWinReason | null {
  if (hand.length !== 13) return null;
  const counts = new Array(13).fill(0);
  for (const c of hand) counts[rankOf(c)]++;

  if (counts[RANK_TWO] === 4) return "fourTwos";
  if (counts.slice(0, 12).every((n) => n >= 1)) return "dragon";
  if (counts.reduce((sum, n) => sum + Math.floor(n / 2), 0) >= 6) return "sixPairs";

  let run = 0;
  for (let r = 0; r < RANK_TWO; r++) {
    run = counts[r] >= 2 ? run + 1 : 0;
    if (run >= 5) return "fivePairSeq";
  }
  return null;
}
