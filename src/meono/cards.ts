/**
 * Mèo Nổ (Exploding Kittens–style) cards: the base deck plus optional packs the host can enable.
 */
export type CardType =
  // base
  | "exploding"
  | "defuse"
  | "attack"
  | "skip"
  | "favor"
  | "shuffle"
  | "future"
  | "nope"
  | "taco"
  | "melon"
  | "potato"
  | "beard"
  | "rainbow"
  // "Mèo Tự Huỷ" pack
  | "imploding"
  | "reverse"
  | "bottom"
  | "feral"
  | "alter"
  | "targeted"
  // "Hỗn Loạn" pack
  | "superskip"
  | "swap"
  | "catomic";

export type Expansion = "imploding" | "chaos";
export const EXPANSIONS: Expansion[] = ["imploding", "chaos"];

export interface MCard {
  id: number;
  type: CardType;
  /** Mèo Tự Huỷ after its first draw: lies face up in the deck, visible to everyone. */
  faceUp?: boolean;
}

export const CAT_TYPES: CardType[] = ["taco", "melon", "potato", "beard", "rainbow"];
/** Wild cat: pairs / triples with any cat card. */
export const WILD_CAT: CardType = "feral";
export const KITTENS: CardType[] = ["exploding", "imploding"];

/** Cards played on your own turn on their own (they open a Nope window). */
export const ACTION_TYPES: CardType[] = [
  "attack",
  "skip",
  "favor",
  "shuffle",
  "future",
  "reverse",
  "bottom",
  "alter",
  "targeted",
  "superskip",
  "swap",
  "catomic",
];

export const BASE_COUNTS: Partial<Record<CardType, number>> = {
  exploding: 4,
  defuse: 6,
  attack: 4,
  skip: 4,
  favor: 4,
  shuffle: 4,
  future: 5,
  nope: 5,
  taco: 4,
  melon: 4,
  potato: 4,
  beard: 4,
  rainbow: 4,
};

export const PACK_COUNTS: Record<Expansion, Partial<Record<CardType, number>>> = {
  imploding: { imploding: 1, reverse: 4, bottom: 4, feral: 4, alter: 4, targeted: 3 },
  chaos: { superskip: 2, swap: 3, catomic: 1 },
};

export const ALL_TYPES = [...new Set([...Object.keys(BASE_COUNTS), ...Object.values(PACK_COUNTS).flatMap((c) => Object.keys(c))])] as CardType[];

export const MIN_PLAYERS = 2;
/** Seats in a Mèo Nổ room; the base game plays up to 5, the Mèo Tự Huỷ pack adds a 6th. */
export const MAX_SEATS = 6;
export const maxPlayers = (expansions: Expansion[]) => (expansions.includes("imploding") ? 6 : 5);
export const HAND_SIZE = 7;

export const cleanExpansions = (raw: unknown): Expansion[] =>
  Array.isArray(raw) ? EXPANSIONS.filter((e) => raw.includes(e)) : [];

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Setup: take the kittens and defuses out, deal 7 cards + 1 defuse each,
 * then shuffle (players − 1) kittens back in — with the Mèo Tự Huỷ pack one of
 * them is the Imploding Kitten — plus the spare defuses (at most 2 with 2–3
 * players, so the deck is not too safe).
 */
export function deal(
  players: string[],
  expansions: Expansion[] = [],
  random: () => number = Math.random,
): { hands: Record<string, MCard[]>; deck: MCard[] } {
  let id = 0;
  const counts: Partial<Record<CardType, number>> = { ...BASE_COUNTS };
  for (const e of expansions) for (const [t, n] of Object.entries(PACK_COUNTS[e])) counts[t as CardType] = (counts[t as CardType] ?? 0) + n!;
  // With 6 players the base deck runs short of defuses and kittens; the pack's extra cards cover it.
  const make = (type: CardType, n: number) => Array.from({ length: n }, () => ({ id: id++, type }));
  const base = shuffle(
    (Object.entries(counts) as [CardType, number][])
      .filter(([t]) => !KITTENS.includes(t) && t !== "defuse")
      .flatMap(([t, n]) => make(t, n)),
    random,
  );
  const defuses = make("defuse", Math.max(counts.defuse ?? 6, players.length));
  const bombs = players.length - 1;
  const implode = expansions.includes("imploding") ? 1 : 0;
  const kittens = [...make("exploding", Math.max(bombs - implode, 0)), ...make("imploding", implode)];

  const hands: Record<string, MCard[]> = {};
  players.forEach((p) => {
    hands[p] = [...base.splice(0, HAND_SIZE), defuses.pop()!];
  });
  const spareDefuses = defuses.slice(0, players.length <= 3 ? Math.min(2, defuses.length) : defuses.length);
  const deck = shuffle([...base, ...kittens, ...spareDefuses], random);
  return { hands, deck };
}
