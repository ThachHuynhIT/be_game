import { type Card, RANK_TWO, rankOf, sortCards } from "./cards";

export type ComboType = "single" | "pair" | "triple" | "quad" | "straight" | "pairSeq";

export interface Combo {
  type: ComboType;
  /** Number of cards in the combo. */
  length: number;
  /** Strongest card — used to compare combos of the same type and length. */
  top: Card;
  cards: Card[];
}

export const COMBO_NAMES: Record<ComboType, string> = {
  single: "Rác",
  pair: "Đôi",
  triple: "Sám cô",
  quad: "Tứ quý",
  straight: "Sảnh",
  pairSeq: "Đôi thông",
};

export function comboName(c: Combo): string {
  if (c.type === "pairSeq") return `${c.length / 2} đôi thông`;
  if (c.type === "straight") return `Sảnh ${c.length}`;
  return COMBO_NAMES[c.type];
}

const allSameRank = (cards: Card[]) => cards.every((c) => rankOf(c) === rankOf(cards[0]));

/** Identify what combo a set of cards forms, or null if it is not a legal combo. */
export function detectCombo(input: Card[]): Combo | null {
  if (input.length === 0 || new Set(input).size !== input.length) return null;
  const cards = sortCards(input);
  const n = cards.length;
  const top = cards[n - 1];
  const make = (type: ComboType): Combo => ({ type, length: n, top, cards });

  if (n === 1) return make("single");
  if (n <= 4 && allSameRank(cards)) {
    return make(n === 2 ? "pair" : n === 3 ? "triple" : "quad");
  }

  const ranks = cards.map(rankOf);
  if (ranks.includes(RANK_TWO)) return null; // 2 never appears in a straight / đôi thông

  // Straight: ≥3 distinct consecutive ranks.
  if (n >= 3 && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) {
    return make("straight");
  }

  // Đôi thông: ≥3 consecutive pairs.
  if (n >= 6 && n % 2 === 0) {
    let ok = true;
    for (let i = 0; i < n; i += 2) {
      if (ranks[i] !== ranks[i + 1]) ok = false;
      if (i > 0 && ranks[i] !== ranks[i - 2] + 1) ok = false;
    }
    if (ok) return make("pairSeq");
  }
  return null;
}

const isSingleTwo = (c: Combo) => c.type === "single" && rankOf(c.top) === RANK_TWO;
const isPairTwo = (c: Combo) => c.type === "pair" && rankOf(c.top) === RANK_TWO;
const isPairSeq = (c: Combo, pairs: number) => c.type === "pairSeq" && c.length === pairs * 2;

/**
 * Can `next` be played on top of `prev`?
 * Normal rule: same type, same length, higher top card.
 * Chặt (bombs):
 *   3 đôi thông  → chặt 1 heo
 *   tứ quý       → chặt heo, đôi heo, 3 đôi thông
 *   4 đôi thông  → chặt heo, đôi heo, 3 đôi thông, tứ quý
 */
export function canBeat(prev: Combo | null, next: Combo): boolean {
  if (!prev) return true;
  if (prev.type === next.type && prev.length === next.length) return next.top > prev.top;

  if (isPairSeq(next, 3)) return isSingleTwo(prev);
  if (next.type === "quad") return isSingleTwo(prev) || isPairTwo(prev) || isPairSeq(prev, 3);
  if (isPairSeq(next, 4)) {
    return isSingleTwo(prev) || isPairTwo(prev) || isPairSeq(prev, 3) || prev.type === "quad";
  }
  return false;
}

/** Is this combo a "chặt" (bomb) over the previous one, rather than a normal beat? */
export function isChop(prev: Combo | null, next: Combo): boolean {
  return !!prev && canBeat(prev, next) && (prev.type !== next.type || prev.length !== next.length);
}
