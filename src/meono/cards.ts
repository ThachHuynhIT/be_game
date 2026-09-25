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
  // "Streaking Kittens" pack (the old "Hỗn Loạn" cards are part of it)
  | "superskip"
  | "swap"
  | "catomic"
  | "streaking"
  | "future5"
  | "garbage"
  | "mark"
  | "curse"
  // "Barking Kittens" pack
  | "barking"
  | "potluck"
  | "ilt"
  | "alternow"
  | "bury"
  | "personal"
  | "share"
  // "Zombie Kittens" pack
  | "zombie"
  | "feed"
  | "dig"
  | "clone"
  | "grave"
  | "deadattack"
  | "clairvoyance"
  // "Attacking Kittens" / "Defending Kittens" packs
  | "slap"
  | "annoy"
  | "steal"
  | "rollcall"
  | "corn";

export type Expansion = "imploding" | "streaking" | "barking" | "attacking" | "defending" | "zombie";
export const EXPANSIONS: Expansion[] = ["imploding", "streaking", "barking", "attacking", "defending", "zombie"];
/** Packs the host can tick in the "custom" preset. */
export const SELECTABLE_PACKS: Expansion[] = ["imploding", "streaking", "barking", "attacking", "defending", "zombie"];

export interface MCard {
  id: number;
  type: CardType;
  /** Mèo Tự Huỷ after its first draw: lies face up in the deck, visible to everyone. */
  faceUp?: boolean;
  /** Đánh dấu: this card is shown to everyone while it stays in a hand. */
  marked?: boolean;
  /** View only: Nổi cáu made this card unusable for now. */
  annoyed?: boolean;
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
  "future5",
  "garbage",
  "mark",
  "curse",
  "barking",
  "potluck",
  "ilt",
  "alternow",
  "bury",
  "personal",
  "share",
  "zombie",
  "feed",
  "dig",
  "clone",
  "grave",
  "deadattack",
  "slap",
  "annoy",
  "steal",
  "rollcall",
  "corn",
];

/** Thấu thị: played while someone else is hiding a Mèo Nổ (see game.ts playClairvoyance). */
export const CLAIRVOYANCE: CardType = "clairvoyance";

/** “Now” cards: playable at any moment, even on someone else's turn (like Không!). */
export const NOW_TYPES: CardType[] = ["alternow"];

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
  // Streaking also adds one extra Mèo Nổ to the deck (see deal()).
  streaking: { streaking: 1, superskip: 1, future5: 1, swap: 3, garbage: 1, catomic: 1, mark: 3, curse: 2 },
  barking: { barking: 2, potluck: 2, ilt: 3, alternow: 2, bury: 2, personal: 3, share: 2 },
  zombie: { zombie: 4, feed: 3, dig: 4, clone: 3, grave: 2, deadattack: 2, clairvoyance: 2 },
  // Attacking also adds two Mèo Nổ (see deal()).
  attacking: { slap: 4, steal: 4, annoy: 3, alter: 2, defuse: 1 },
  defending: { reverse: 2, future: 2, future5: 2, alter: 2, shuffle: 2, bottom: 1, annoy: 1, rollcall: 1, corn: 1 },
};

export const ALL_TYPES = [...new Set([...Object.keys(BASE_COUNTS), ...Object.values(PACK_COUNTS).flatMap((c) => Object.keys(c))])] as CardType[];

export const MIN_PLAYERS = 2;
/** Seats in a Mèo Nổ room (7 with Attacking Kittens). */
export const MAX_SEATS = 7;
/** Base 5; any pack 6; Attacking Kittens 7. */
export const maxPlayers = (expansions: Expansion[]) => (expansions.includes("attacking") ? 7 : expansions.length ? 6 : 5);
export const HAND_SIZE = 7;

/** Host-selectable packs; "chaos" was the old name of (part of) the Streaking pack. */
export const cleanExpansions = (raw: unknown): Expansion[] =>
  Array.isArray(raw) ? SELECTABLE_PACKS.filter((e) => raw.includes(e) || (e === "streaking" && raw.includes("chaos"))) : [];

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
  const bombs = players.length - 1 + (expansions.includes("streaking") ? 1 : 0) + (expansions.includes("attacking") ? 2 : 0);
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

/** Ready-made pack combinations the host picks from, each with the player counts it suits. */
export interface Preset {
  id: string;
  name: string;
  emoji: string;
  group: "basic" | "advanced" | "chaos";
  packs: Expansion[];
  minPlayers: number;
  maxPlayers: number;
}

export const PRESETS: Preset[] = [
  { id: "classic", name: "Classic", emoji: "🐱", group: "basic", packs: [], minPlayers: 2, maxPlayers: 5 },
  { id: "runaway", name: "Runaway Cats", emoji: "🏃", group: "basic", packs: ["streaking"], minPlayers: 2, maxPlayers: 5 },
  { id: "implosion", name: "Implosion", emoji: "🌀", group: "basic", packs: ["imploding"], minPlayers: 2, maxPlayers: 6 },
  { id: "zombie", name: "Zombie Apocalypse", emoji: "🧟", group: "basic", packs: ["zombie"], minPlayers: 2, maxPlayers: 5 },
  { id: "war", name: "War of Cats", emoji: "⚔️🛡️", group: "basic", packs: ["attacking", "defending"], minPlayers: 3, maxPlayers: 7 },
  { id: "catchaos", name: "Cat Chaos", emoji: "🏃🌀", group: "basic", packs: ["streaking", "imploding"], minPlayers: 3, maxPlayers: 6 },
  { id: "ultimatechaos", name: "Ultimate Chaos", emoji: "🔥", group: "basic", packs: ["streaking", "imploding", "barking"], minPlayers: 3, maxPlayers: 6 },
  { id: "aggressive", name: "Aggressive Cats", emoji: "⚔️🏃", group: "advanced", packs: ["attacking", "streaking"], minPlayers: 3, maxPlayers: 7 },
  { id: "defchaos", name: "Defensive Chaos", emoji: "🛡️🌀", group: "advanced", packs: ["defending", "imploding"], minPlayers: 2, maxPlayers: 6 },
  { id: "catfight", name: "Cat Fight", emoji: "🐶⚔️", group: "advanced", packs: ["barking", "attacking"], minPlayers: 3, maxPlayers: 7 },
  { id: "zombiewar", name: "Zombie War", emoji: "🧟⚔️", group: "advanced", packs: ["zombie", "attacking"], minPlayers: 3, maxPlayers: 7 },
  { id: "undead", name: "Undead Defense", emoji: "🧟🛡️", group: "advanced", packs: ["zombie", "defending"], minPlayers: 2, maxPlayers: 6 },
  { id: "zombierun", name: "Zombie Run", emoji: "🧟🏃", group: "advanced", packs: ["zombie", "streaking"], minPlayers: 3, maxPlayers: 6 },
  { id: "ultimatewar", name: "Ultimate War", emoji: "🔥", group: "chaos", packs: ["attacking", "defending", "streaking", "imploding"], minPlayers: 4, maxPlayers: 7 },
  { id: "zombiechaos", name: "Zombie Apocalypse Chaos", emoji: "☠️", group: "chaos", packs: ["zombie", "streaking", "imploding", "barking"], minPlayers: 4, maxPlayers: 7 },
  { id: "everything", name: "Everything", emoji: "💀", group: "chaos", packs: ["streaking", "imploding", "barking", "attacking", "zombie", "defending"], minPlayers: 4, maxPlayers: 7 },
];
export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
