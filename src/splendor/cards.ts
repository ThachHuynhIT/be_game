/**
 * Đá Quý (Splendor-style) card data. The 90 development cards and 10 nobles are generated
 * from cost patterns that follow the classic game's distribution (40 / 30 / 20 cards per tier,
 * 8 / 6 / 4 per colour), rotated over the colours so every gem is used evenly.
 * Copied verbatim to the portfolio (src/lib/splendor/cards.ts) — keep it dependency-free.
 */

export const GEMS = ["white", "blue", "green", "red", "black"] as const;
export type Gem = (typeof GEMS)[number];
export type Token = Gem | "gold";
export const TOKENS: Token[] = [...GEMS, "gold"];

export const GEM_NAMES: Record<Token, string> = {
  white: "Kim cương",
  blue: "Lam ngọc",
  green: "Lục bảo",
  red: "Hồng ngọc",
  black: "Mã não",
  gold: "Vàng",
};

export type Cost = Partial<Record<Gem, number>>;

export interface DevCard {
  id: number;
  tier: 1 | 2 | 3;
  /** Permanent discount this card gives. */
  bonus: Gem;
  points: number;
  cost: Cost;
}

export interface Noble {
  id: number;
  /** Bonuses (owned cards) needed to attract this noble. */
  req: Cost;
  points: number;
}

/**
 * Cost patterns per tier. Keys: "own" = the card's bonus colour, 1–4 = the other colours in
 * rotation after it. [pattern, points].
 */
type Pattern = [Partial<Record<"own" | 1 | 2 | 3 | 4, number>>, number];

const TIER1: Pattern[] = [
  [{ 1: 3 }, 0],
  [{ 1: 1, 2: 1, 3: 1, 4: 1 }, 0],
  [{ 1: 1, 2: 1, 3: 2, 4: 1 }, 0],
  [{ 2: 2, 3: 2, 4: 1 }, 0],
  [{ own: 1, 1: 3, 3: 1 }, 0],
  [{ 3: 1, 4: 2 }, 0],
  [{ 1: 2, 3: 2 }, 0],
  [{ 4: 4 }, 1],
];

const TIER2: Pattern[] = [
  [{ 1: 2, 2: 2, 3: 3 }, 1],
  [{ own: 2, 1: 3, 4: 3 }, 1],
  [{ 2: 1, 3: 4, 4: 2 }, 2],
  [{ 1: 5, 2: 3 }, 2],
  [{ 3: 5 }, 2],
  [{ own: 6 }, 3],
];

const TIER3: Pattern[] = [
  [{ 1: 3, 2: 3, 3: 5, 4: 3 }, 3],
  [{ 4: 7 }, 4],
  [{ own: 3, 3: 6, 4: 3 }, 4],
  [{ own: 3, 4: 7 }, 5],
];

function build(): DevCard[] {
  const cards: DevCard[] = [];
  let id = 1;
  const tiers: [1 | 2 | 3, Pattern[]][] = [
    [1, TIER1],
    [2, TIER2],
    [3, TIER3],
  ];
  for (const [tier, patterns] of tiers) {
    GEMS.forEach((bonus, ci) => {
      patterns.forEach(([pattern, points], pi) => {
        // Shift the rotation per pattern so the same colour isn't always "colour 1".
        const other = (k: number) => GEMS[(ci + ((k + pi) % 4) + 1) % 5];
        const cost: Cost = {};
        for (const [key, n] of Object.entries(pattern)) {
          const gem = key === "own" ? bonus : other(Number(key) - 1);
          cost[gem] = (cost[gem] ?? 0) + (n as number);
        }
        cards.push({ id: id++, tier, bonus, points, cost });
      });
    });
  }
  return cards;
}

export const CARDS: DevCard[] = build();
export const CARD_BY_ID: Record<number, DevCard> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const NOBLES: Noble[] = [
  ...GEMS.map((g, i): Noble => ({ id: i + 1, req: { [g]: 4, [GEMS[(i + 1) % 5]]: 4 }, points: 3 })),
  ...GEMS.map(
    (g, i): Noble => ({ id: i + 6, req: { [g]: 3, [GEMS[(i + 1) % 5]]: 3, [GEMS[(i + 2) % 5]]: 3 }, points: 3 }),
  ),
];
export const NOBLE_BY_ID: Record<number, Noble> = Object.fromEntries(NOBLES.map((n) => [n.id, n]));

/** Gem tokens of each colour by player count; gold is always 5. */
export const GEMS_FOR_PLAYERS: Record<number, number> = { 2: 4, 3: 5, 4: 7 };
export const GOLD_TOKENS = 5;
export const MAX_TOKENS = 10;
export const MAX_RESERVED = 3;
export const BOARD_SLOTS = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Host settings. */
export const TARGET_OPTIONS = [10, 12, 15, 18, 21];
export const TURN_SECONDS_OPTIONS = [30, 45, 60, 90];
export const DEFAULT_TARGET = 15;
