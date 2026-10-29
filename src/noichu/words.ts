import { syllablesOf } from "./board";
import { WORDS_TEXT } from "./dict/words";
import { EXTRA_WORDS } from "./extra";

/**
 * The dictionary: the Viet74K list (dict/README.md has its source and licence) plus our own extra phrases
 * (extra.ts). Static data, built once per process: the game state never holds it, only chosen words.
 */

let words: Set<string> | null = null;
/** Dictionary words by their first syllable. */
let byFirst: Map<string, string[]> | null = null;
/** Every syllable that occurs in the dictionary: the real Vietnamese syllables (loose mode). */
let syllables: Set<string> | null = null;
/** Words whose last syllable begins at least MIN_CONTINUATIONS other words: good opening words. */
let openers: string[] | null = null;

const MIN_CONTINUATIONS = 8;

function load() {
  if (words) return;
  words = new Set([...WORDS_TEXT.split("\n"), ...EXTRA_WORDS]);
  const list = [...words];
  syllables = new Set(list.flatMap((w) => syllablesOf(w)));
  byFirst = new Map();
  for (const w of list) {
    const first = syllablesOf(w)[0];
    const bucket = byFirst.get(first);
    if (bucket) bucket.push(w);
    else byFirst.set(first, [w]);
  }
  openers = list.filter((w) => (byFirst!.get(syllablesOf(w)[1])?.length ?? 0) >= MIN_CONTINUATIONS);
}

export function hasWord(word: string): boolean {
  load();
  return words!.has(word);
}

/** Whether `syllable` is a real Vietnamese syllable, judged by the dictionary (loose mode). */
export function isSyllable(syllable: string): boolean {
  load();
  return syllables!.has(syllable);
}

/** Dictionary words that start with `syllable` (do not modify the returned array). */
export function wordsStartingWith(syllable: string): readonly string[] {
  load();
  return byFirst!.get(syllable) ?? [];
}

/** A random opening word that has plenty of continuations. */
export function randomOpeningWord(random: () => number): string {
  load();
  return openers![Math.min(openers!.length - 1, Math.floor(random() * openers!.length))];
}
