/**
 * Card encoding for Tiến Lên Miền Nam.
 *
 * A card is an integer 0..51 = rank * 4 + suit, so comparing two card ids
 * directly compares them by game strength (rank first, then suit).
 *   rank: 0 = "3" … 11 = "A", 12 = "2" (heo)
 *   suit: 0 = ♠ (bích) < 1 = ♣ (chuồn) < 2 = ♦ (rô) < 3 = ♥ (cơ)
 */
export type Card = number;

export const RANK_LABELS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const;
export const SUIT_SYMBOLS = ["♠", "♣", "♦", "♥"] as const;

export const RANK_TWO = 12;
export const THREE_OF_SPADES: Card = 0;

export const rankOf = (c: Card) => Math.floor(c / 4);
export const suitOf = (c: Card) => c % 4;
export const isRed = (c: Card) => suitOf(c) >= 2;
export const cardLabel = (c: Card) => `${RANK_LABELS[rankOf(c)]}${SUIT_SYMBOLS[suitOf(c)]}`;

export const makeCard = (rank: number, suit: number): Card => rank * 4 + suit;

export function newDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Fisher–Yates shuffle; `random` is injectable so tests can be deterministic. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sortCards = (cards: Card[]) => cards.slice().sort((a, b) => a - b);

/** Parse labels like "3♠", "10♥", "2♦" (also accepts s/c/d/h letters). Handy for tests. */
export function parseCard(label: string): Card {
  const suitChar = label.slice(-1);
  const rankStr = label.slice(0, -1).toUpperCase();
  const letterSuits = "scdh";
  let suit = SUIT_SYMBOLS.indexOf(suitChar as (typeof SUIT_SYMBOLS)[number]);
  if (suit < 0) suit = letterSuits.indexOf(suitChar.toLowerCase());
  const rank = RANK_LABELS.indexOf(rankStr as (typeof RANK_LABELS)[number]);
  if (suit < 0 || rank < 0) throw new Error(`Bad card label: ${label}`);
  return makeCard(rank, suit);
}

export const parseCards = (labels: string) => labels.trim().split(/\s+/).map(parseCard);
