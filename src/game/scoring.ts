import { type Card, RANK_TWO, isRed, rankOf } from "./cards";
import type { Combo } from "./combos";

/**
 * Tiến Lên points per finishing position (default Nhất +2, Nhì +1; the host can change them). Every game sums to zero.
 *   Tới trắng: the winner takes 2 × Nhất from every other player (double).
 *   Chết cháy (never played a card before the first player finished): the loss is doubled; the extra goes to Nhất.
 * On top of that, chặt heo moves points from the chopped player to the chopper (see chopPoints);
 * each chặt chồng doubles the previous chop.
 */
export const DEFAULT_TIENLEN_POINTS = { first: 2, second: 1 };

/**
 * Points by finishing position from the room's Nhất / Nhì setting, mirrored so the game sums to zero:
 *   4 players: +first, +second, −second, −first
 *   3 players: +first, +second, −(first + second)
 *   2 players: +first, −first
 */
export function tienlenRankPoints(n: number, points = DEFAULT_TIENLEN_POINTS): number[] {
  const { first, second } = points;
  if (n === 2) return [first, -first];
  if (n === 3) return [first, second, -(first + second)];
  if (n === 4) return [first, second, -second, -first];
  return [];
}

/** Mèo Nổ and Cờ Tỷ Phú: symmetric points by rank. */
const RANK_POINTS: Record<number, number[]> = {
  2: [1, -1],
  3: [2, 0, -2],
  4: [3, 1, -1, -3],
  5: [4, 2, 0, -2, -4],
  6: [5, 3, 1, -1, -3, -5],
};

export const INSTANT_WIN_POINTS = 2;
/** Chặt heo: heo đen (♠ ♣) 1 điểm, heo đỏ (♦ ♥) 2 điểm each. */
export const BLACK_TWO_POINTS = 1;
export const RED_TWO_POINTS = 2;
/** Chopping a 3 đôi thông or tứ quý that was played normally (not itself a chop). Chặt chồng doubles instead (see game.ts). */
export const CHOP_BOMB_POINTS = 2;

/** One chop: `from` (whose cards were chopped) pays `to` (the chopper). */
export interface ChopScore {
  from: string;
  to: string;
  points: number;
}

/** Points a chop is worth, given the combo that got chopped. */
export function chopPoints(chopped: Combo): number {
  const twos = chopped.cards.filter((c: Card) => rankOf(c) === RANK_TWO);
  if (twos.length) return twos.reduce((sum, c) => sum + (isRed(c) ? RED_TWO_POINTS : BLACK_TWO_POINTS), 0);
  return CHOP_BOMB_POINTS;
}

/** Tiến Lên point change for each player id: finishing order + chặt heo transfers. */
export function scoreTienLen(
  finished: string[],
  instantWinner: string | null,
  chops: ChopScore[] = [],
  burned: string[] = [],
  points = DEFAULT_TIENLEN_POINTS,
): Record<string, number> {
  const n = finished.length;
  const deltas: Record<string, number> = {};
  if (instantWinner) {
    const each = points.first * 2;
    for (const id of finished) deltas[id] = id === instantWinner ? each * (n - 1) : -each;
  } else {
    const table = tienlenRankPoints(n, points);
    finished.forEach((id, i) => {
      deltas[id] = table[i] ?? 0;
    });
    // Chết cháy: pay your rank's loss twice; Nhất collects the extra.
    const winner = finished[0];
    for (const id of burned) {
      if (id === winner || !(id in deltas) || deltas[id] >= 0) continue;
      const extra = -deltas[id];
      deltas[id] -= extra;
      deltas[winner] += extra;
    }
  }
  for (const c of chops) {
    if (!(c.from in deltas) || !(c.to in deltas)) continue;
    deltas[c.from] -= c.points;
    deltas[c.to] += c.points;
  }
  return deltas;
}

/** Point change for each player id by finishing order (Mèo Nổ, Cờ Tỷ Phú). */
export function scoreGame(finished: string[], instantWinner: string | null): Record<string, number> {
  const n = finished.length;
  const deltas: Record<string, number> = {};
  if (instantWinner) {
    for (const id of finished) deltas[id] = id === instantWinner ? INSTANT_WIN_POINTS * (n - 1) : -INSTANT_WIN_POINTS;
    return deltas;
  }
  const table = RANK_POINTS[n] ?? [];
  finished.forEach((id, i) => {
    deltas[id] = table[i] ?? 0;
  });
  return deltas;
}
