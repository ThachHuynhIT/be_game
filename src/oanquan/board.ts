/**
 * Ô Ăn Quan board layout. 12 squares in a ring, indexed so that +1 runs
 * left → right along the bottom row as seen by the player sitting there:
 *
 *            11  10   9   8   7          ← side 1 (players[1]) owns 7–11
 *     (0)                          (6)   ← ô quan, left and right ends
 *             1   2   3   4   5          ← side 0 (players[0]) owns 1–5
 *
 * Seen from side 1 (board rotated 180°) their row reads 7 8 9 10 11 left → right,
 * so direction +1 is "phải" (right) and −1 is "trái" (left) for whoever moves.
 */

export const CELLS = 12;
/** The two ô quan squares (left end, right end). */
export const QUAN_CELLS = [0, 6] as const;
/** The 5 ô dân each side owns. */
export const ROWS: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 5],
  [7, 8, 9, 10, 11],
];
export const START_DAN = 5;
/** Quan non: an ô quan still holding its quan can't be captured with fewer dân than this. */
export const QUAN_NON_MIN = 5;
export const RESEED = 5;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;

export const QUAN_VALUE_OPTIONS = [5, 10];
export const DEFAULT_QUAN_VALUE = 10;
export const TURN_SECONDS_OPTIONS = [15, 20, 30, 45];
export const DEFAULT_TURN_SECONDS = 30;
/** Safety stop: after this many moves the game ends as if the board were cleared. */
export const MAX_MOVES = 400;

export const isQuanCell = (c: number) => c === 0 || c === 6;
/** Index into `quan[]` for an ô quan square. */
export const quanIndex = (c: number) => (c === 0 ? 0 : 1);
/** Which side owns an ô dân square (null for ô quan). */
export const sideOfCell = (c: number): 0 | 1 | null => (c >= 1 && c <= 5 ? 0 : c >= 7 && c <= 11 ? 1 : null);
export const nextCell = (c: number, dir: 1 | -1) => (c + dir + CELLS) % CELLS;
