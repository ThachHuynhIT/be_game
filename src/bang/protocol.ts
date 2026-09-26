/**
 * Đấu Súng (Bang!-style) wire protocol. Copied verbatim to the portfolio (src/lib/bang/protocol.ts).
 */
import type { ChatMessage, GameRecord, Reaction } from "../game/protocol";
import type { CardKey, CharKey, EventKey, GearKey, Pack, Role, Suit } from "./cards";

export type { ChatMessage, GameRecord, Reaction };

/** WebSocket endpoint for Đấu Súng. */
export const BANG_WS_PATH = "/api/bang/ws";

export interface BangSettings {
  /** Expansion packs switched on (the base game is always in). */
  packs: Exclude<Pack, "base">[];
  turnSeconds: number;
  respondSeconds: number;
  /** Points each winner gets; the losers share the loss so a game sums to zero. */
  first: number;
  second: number;
}

/** A card lying in front of a player. */
export interface InPlayView {
  id: number;
  /** Armed & Dangerous cubes on it. */
  cubes?: number;
  /** Green card placed this turn: usable from the owner's next turn. */
  fresh?: boolean;
}

export interface BangPlayerView {
  id: string;
  /** null while that player is still choosing. */
  char: CharKey | null;
  life: number;
  max: number;
  /** Known to you: your own role, the Sheriff, the dead, and everyone once the game ends. */
  role: Role | null;
  handCount: number;
  /** Your own hand (everyone's during Lật Bài Ngửa). */
  hand: number[] | null;
  play: InPlayView[];
  gear: { key: GearKey; from?: string }[];
  gold: number;
  /** Cubes on the character card. */
  cubes: number;
  dead: boolean;
  /** Playing on as a ghost (Hồn Ma card or Thị Trấn Ma). */
  ghost: boolean;
  /** Abilities borrowed this turn (Vê Bắt Chước, Xám Nhiều Mặt). */
  borrowed: CharKey[];
  /** Distance from you to them (null for yourself / spectators / the dead). */
  dist: number | null;
}

/** What the game is waiting for right now (the head of the queue), public to everyone. */
export type PromptView =
  | {
      kind: "react";
      to: string;
      from: string | null;
      /** bang = shot (answer with Trượt!) · beat = Da Đỏ / Đấu Tay Đôi / Cơn Giận (answer with BANG!) · evade = Chuồn / Mích may cancel a card. */
      answer: "missed" | "bang" | "evade";
      /** What caused it, for the UI text. */
      cause: string;
      need: number;
      dmg: number;
      deadline: number;
    }
  | { kind: "save"; to: string; target: string; amount: number; deadline: number }
  | { kind: "store"; to: string; cards: number[]; deadline: number }
  | { kind: "pick"; to: string; from: string; mode: "take" | "discard"; cause: string; deadline: number }
  | { kind: "keep"; to: string; keep: number; count: number; cause: string; deadline: number; cards?: number[] }
  | { kind: "discard"; to: string; count: number; orLose: number; cause: string; deadline: number }
  | { kind: "copy"; to: string; options: CharKey[]; deadline: number }
  | { kind: "draw"; to: string; options: DrawMode[]; swap: boolean; blood: boolean; deadline: number };

/** Ways to take your phase-1 cards. */
export type DrawMode = "normal" | "jesse" | "pedro" | "pat" | "evelyn" | "liquor" | "peyote";

export interface BangGameView {
  status: "picking" | "playing" | "ended";
  /** Character choice at the start: your two options (empty once chosen). */
  picking: CharKey[];
  /** Who has chosen already. */
  picked: string[];
  players: BangPlayerView[];
  turn: string | null;
  step: "start" | "draw" | "play" | null;
  /** Your BANG! cards left this turn (Infinity is sent as 99). */
  bangsLeft: number;
  /** Your weapon reach. */
  range: number;
  deadline: number | null;
  prompt: PromptView | null;
  /** Queued prompts after the current one. */
  queued: number;
  deckCount: number;
  discardTop: number | null;
  discardCount: number;
  event: EventKey | null;
  eventsLeft: number;
  shop: GearKey[];
  shopDeck: number;
  /** Winners (ids) once ended. */
  winners: string[];
  finished: string[];
  /** Card just played / flipped, for animations. */
  last: { seq: number; player: string | null; card: number | null; kind: "play" | "flip" | "hit" | "die" | "event"; target?: string | null } | null;
  log: { id: number; at: number; text: string; tone?: string }[];
}

export interface BangSeatView {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  inGame: boolean;
  kicked: boolean;
  points: number;
  games: number;
  wins: number;
}

export interface BangRoomView {
  game: "bang";
  code: string;
  meId: string;
  role: "player" | "spectator";
  serverTime: number;
  settings: BangSettings;
  seats: (BangSeatView | null)[];
  current: BangGameView | null;
  /** Powers you can activate (character, Chảo Đãi Vàng, event powers). */
  abilities?: string[];
  history: GameRecord[];
  spectators: string[];
  reactions: Reaction[];
  chat?: ChatMessage[];
}

export interface BangRoomSummary {
  code: string;
  status: "waiting" | "playing";
  packs: Exclude<Pack, "base">[];
  players: { name: string; connected: boolean; points: number }[];
  spectators: number;
  games: number;
}

/** Choosing a card of another player: a random hand card, or a named card in front of them. */
export type PickSpec = { zone: "hand" } | { zone: "play"; card: number };

/**
 * Đấu Súng commands (acked like the other games):
 *   { type: "start" } · { type: "settings", packs?, turnSeconds?, respondSeconds?, first? } · { type: "kick", playerId }
 *   { type: "pick", char }                                  choose your character
 *   { type: "draw", mode?, target?, targets?, card?, color?, swap?, blood? }   phase 1
 *   { type: "play", card, target?, target2?, pick?, extra?, as?, mode? }       a card from your hand
 *   { type: "use", card, target?, pick? }                   a green / cube card in front of you
 *   { type: "ability", name, target?, cards?, card?, pick? } a character or event power
 *   { type: "buy", slot, target?, pick?, mode? }            Gold Rush shop
 *   { type: "respond", cards?, take?, card?, choice? }      answer the prompt addressed to you
 *   { type: "end", discard? }                               end your turn (discarding down to your limit)
 */
export type BangCommand =
  | { type: "start" }
  | { type: "settings"; packs?: string[]; turnSeconds?: number; respondSeconds?: number; first?: number; second?: number }
  | { type: "kick"; playerId: string }
  | { type: "pick"; char: CharKey }
  | { type: "draw"; mode?: DrawMode; target?: string; targets?: string[]; card?: number; color?: "red" | "black"; swap?: boolean; blood?: string }
  | { type: "play"; card: number; target?: string; target2?: string; pick?: PickSpec; extra?: number[]; as?: "bang"; mode?: string }
  | { type: "use"; card: number; target?: string; pick?: PickSpec }
  | { type: "ability"; name: string; target?: string; cards?: number[]; card?: number; pick?: PickSpec }
  | { type: "buy"; slot: number; target?: string; pick?: PickSpec; mode?: string }
  | { type: "respond"; cards?: number[]; take?: boolean; card?: number; choice?: string }
  | { type: "end"; discard?: number[] };

export type { CardKey, CharKey, EventKey, GearKey, Pack, Role, Suit };
