/**
 * Ô Ăn Quan board layout. For N players (2–4) the ring has N segments of 6 squares:
 * segment i = square 6i (ô quan) followed by 6i+1 … 6i+5 (the 5 ô dân owned by player i).
 * Ring size = 6N. Two players is the classic 12-square board, indexed so that +1 runs
 * left → right along the bottom row as seen by the player sitting there:
 *
 *            11  10   9   8   7          ← side 1 (players[1]) owns 7–11
 *     (0)                          (6)   ← ô quan, left and right ends
 *             1   2   3   4   5          ← side 0 (players[0]) owns 1–5
 *
 * Seen from side 1 (board rotated 180°) their row reads 7 8 9 10 11 left → right,
 * so direction +1 is "phải" (right) and −1 is "trái" (left) for whoever moves.
 * With 3 or 4 players the ring is a triangle / square drawn the same way: each player sees
 * their own segment at the bottom, running left → right.
 */

/** Squares per segment (1 ô quan + 5 ô dân). */
export const SEGMENT = 6;
/** Ring size of the classic two-player board. */
export const CELLS = 12;
export const cellsFor = (players: number) => SEGMENT * players;
/** The ô quan squares for a ring of `players` segments. */
export const quanCellsFor = (players: number) => Array.from({ length: players }, (_, i) => i * SEGMENT);
/** The 5 ô dân side `side` owns. */
export const rowOf = (side: number): number[] => [1, 2, 3, 4, 5].map((k) => side * SEGMENT + k);
/** Rows of the (up to four) sides. */
export const ROWS: readonly (readonly number[])[] = [0, 1, 2, 3].map(rowOf);
export const START_DAN = 5;
/** Quan non: an ô quan still holding its quan can't be captured with fewer dân than this. */
export const QUAN_NON_MIN = 5;
export const RESEED = 5;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const QUAN_VALUE_OPTIONS = [5, 10];
export const DEFAULT_QUAN_VALUE = 10;
export const TURN_SECONDS_OPTIONS = [15, 20, 30, 45];
export const DEFAULT_TURN_SECONDS = 30;
/** Safety stop: after this many moves (200 per player) the game ends as if the board were cleared. */
export const maxMovesFor = (players: number) => 200 * players;
export const MAX_MOVES = maxMovesFor(2);

export const isQuanCell = (c: number) => c % SEGMENT === 0;
/** Index into `quan[]` for an ô quan square. */
export const quanIndex = (c: number) => c / SEGMENT;
/** Which side owns an ô dân square (null for ô quan). */
export const sideOfCell = (c: number): number | null => (c < 0 || c % SEGMENT === 0 ? null : Math.floor(c / SEGMENT));
export const nextCell = (c: number, dir: 1 | -1, cells = CELLS) => (c + dir + cells) % cells;
