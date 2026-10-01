/**
 * Cờ Cá Ngựa (Vietnamese ludo) board data. A 15×15 grid: four 6×6 corner stables, a shared
 * 56-square track (14 per colour) and a 6-step home column per colour leading to the centre.
 * Copied verbatim to the portfolio (src/lib/cangua/board.ts) — keep it dependency-free.
 *
 * A horse's position is its progress from its own start square:
 *   -1 = in the stable · 0 = start square (cửa chuồng) · 55 = the square before its home column
 *   56..61 = home column steps 1..6.
 */

export const COLORS = ["red", "blue", "yellow", "green"] as const;
export type HorseColor = (typeof COLORS)[number];
export const COLOR_NAMES: Record<HorseColor, string> = { red: "Đỏ", blue: "Xanh dương", yellow: "Vàng", green: "Xanh lá" };

export const GRID = 15;
export const SIDE = 14;
export const TRACK_LEN = 56;
export const HOME_LEN = 6;
export const HORSES = 4;
export const STABLE = -1;
/** Progress of the last track square before the home column. */
export const GATE = TRACK_LEN - 1;
/** Progress of the top home step (6). */
export const FINAL = GATE + HOME_LEN;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const TURN_SECONDS_OPTIONS = [10, 15, 20, 30];
export const DEFAULT_TURN_SECONDS = 15;
/** Colours used for each table size (2 players sit opposite). */
export const COLORS_FOR_PLAYERS: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

export type Cell = [row: number, col: number];

/** The 56 track squares clockwise, starting at red's start square. */
export const TRACK: Cell[] = (() => {
  const t: Cell[] = [];
  const quarter = (cells: Cell[]) => t.push(...cells);
  const range = (a: number, b: number) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Array.from({ length: a - b + 1 }, (_, i) => a - i));
  // Left arm top row → corner → up the top arm → top middle.
  quarter([...range(0, 6).map((c): Cell => [6, c]), ...range(5, 0).map((r): Cell => [r, 6]), [0, 7]]);
  // Down the top arm → corner → right arm top row → right middle.
  quarter([...range(0, 6).map((r): Cell => [r, 8]), ...range(9, 14).map((c): Cell => [6, c]), [7, 14]]);
  // Right arm bottom row → corner → down the bottom arm → bottom middle.
  quarter([...range(14, 8).map((c): Cell => [8, c]), ...range(9, 14).map((r): Cell => [r, 8]), [14, 7]]);
  // Up the bottom arm → corner → left arm bottom row → left middle.
  quarter([...range(14, 8).map((r): Cell => [r, 6]), ...range(5, 0).map((c): Cell => [8, c]), [7, 0]]);
  return t;
})();

/** Home column cells per colour, step 1 first. */
export const HOME_CELLS: Cell[][] = [
  [1, 2, 3, 4, 5, 6].map((c): Cell => [7, c]),
  [1, 2, 3, 4, 5, 6].map((r): Cell => [r, 7]),
  [13, 12, 11, 10, 9, 8].map((c): Cell => [7, c]),
  [13, 12, 11, 10, 9, 8].map((r): Cell => [r, 7]),
];

/** Top-left corner of each colour's 6×6 stable. */
export const STABLE_ORIGIN: Cell[] = [
  [0, 0],
  [0, 9],
  [9, 9],
  [9, 0],
];

/** Where the 4 horses sit inside their stable. */
export const STABLE_CELLS: Cell[][] = STABLE_ORIGIN.map(([r, c]) => [
  [r + 1, c + 1],
  [r + 1, c + 4],
  [r + 4, c + 1],
  [r + 4, c + 4],
]);

export const startIndex = (color: number) => color * SIDE;
/** Track square index for a horse of `color` at `progress` (0..GATE). */
export const trackIndex = (color: number, progress: number) => (startIndex(color) + progress) % TRACK_LEN;

/** Grid cell of a horse. */
export function cellOf(color: number, progress: number, horse: number): Cell {
  if (progress === STABLE) return STABLE_CELLS[color][horse];
  if (progress <= GATE) return TRACK[trackIndex(color, progress)];
  return HOME_CELLS[color][Math.min(progress - GATE, HOME_LEN) - 1];
}
