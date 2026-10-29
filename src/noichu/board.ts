/** Static data for Nối Chữ — no imports, so it can be copied verbatim to zonenop-game/src/lib/noichu/. */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const TURN_SECONDS_OPTIONS = [10, 15, 20, 30];
export const DEFAULT_TURN_SECONDS = 20;

/**
 * How strictly a word is checked (there is no "no check": gibberish is always refused):
 *   strict — it must be in the dictionary (default);
 *   loose  — the dictionary or any pair of real Vietnamese syllables (accepts "đôi mắt", still refuses "qqqqq").
 */
export type DictionaryMode = "strict" | "loose";
export const DICTIONARY_MODES: readonly DictionaryMode[] = ["strict", "loose"];
export const DEFAULT_DICTIONARY_MODE: DictionaryMode = "strict";

/**
 * Reads a mode from a setting or saved state. Earlier versions stored a boolean (true = check, false = no check)
 * and, briefly, "off": with no "no check" mode left, those mean the most permissive one, loose.
 */
export function dictionaryModeOf(value: unknown): DictionaryMode {
  if (value === "strict" || value === "loose") return value;
  if (value === false || value === "off") return "loose";
  return DEFAULT_DICTIONARY_MODE;
}

/** A game ends after this many words in the chain (including the opening word), so it always finishes. */
export const MAX_WORDS = 300;

/** A word is exactly two syllables of letters only; each at most this long (Vietnamese syllables are ≤ 7, loan words like "instagram" are longer). */
export const MAX_SYLLABLE_LENGTH = 10;

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
