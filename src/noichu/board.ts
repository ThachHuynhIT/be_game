/** Static data for Nối Chữ — no imports, so it can be copied verbatim to zonenop-game/src/lib/noichu/. */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const TURN_SECONDS_OPTIONS = [10, 15, 20, 30];
export const DEFAULT_TURN_SECONDS = 20;

/** A game ends after this many words in the chain (including the opening word), so it always finishes. */
export const MAX_WORDS = 300;

/** A word is exactly two syllables of letters only; each syllable at most this long (Vietnamese syllables are ≤ 7). */
export const MAX_SYLLABLE_LENGTH = 8;

/** Tone marks matter: "mèo" does not continue "meo". */
export const syllablesOf = (word: string): [string, string] => {
  const [a = "", b = ""] = word.split(" ");
  return [a, b];
};

/** Lower-case, NFC, single spaces; null unless the text is exactly two syllables of letters. */
export function normalizeWord(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 40) return null;
  const w = text.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!/^\p{L}+ \p{L}+$/u.test(w)) return null;
  const [a, b] = syllablesOf(w);
  return a.length > MAX_SYLLABLE_LENGTH || b.length > MAX_SYLLABLE_LENGTH ? null : w;
}
