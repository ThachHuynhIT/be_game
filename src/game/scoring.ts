/**
 * Points per finishing position. Every game sums to zero.
 *   4 players: Nhất +3, Nhì +1, Ba −1, Bét −3
 *   3 players: +2, 0, −2
 *   2 players: +1, −1
 *   5 players: +4, +2, 0, −2, −4
 *   6 players: +5, +3, +1, −1, −3, −5 (Mèo Nổ, Cờ Tỷ Phú)
 *   Tới trắng: the winner takes +2 from every other player.
 */
const RANK_POINTS: Record<number, number[]> = {
  2: [1, -1],
  3: [2, 0, -2],
  4: [3, 1, -1, -3],
  5: [4, 2, 0, -2, -4],
  6: [5, 3, 1, -1, -3, -5],
};

export const INSTANT_WIN_POINTS = 2;

/** Point change for each player id, given the finishing order. */
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
