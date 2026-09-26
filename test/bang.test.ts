import { describe, expect, it } from "vitest";
import { CARDS, CARD_PACK, type CardKey, type CharKey, EXPANSIONS, type Pack, ROLES_FOR, type Role, type Suit, deckFor } from "../src/bang/cards";
import { type BangState, distance, kill, newBangGame, pickCharacter, run, startTurn, tickGame } from "../src/bang/game";
import { abilityList, buyGear, drawCommand, endTurn, playCard, respond, useAbility, useCard } from "../src/bang/actions";
import { type BangRoom, bangCommand, bangView, joinBang, newBangRoom, tickBang } from "../src/bang/room";

const names = (id: string) => id;
const E = (r: { ok: boolean; error?: string }) => (r.ok ? "" : (r.error ?? ""));
const T = 1_000_000;
const IDS = "abcdefgh";

/** A game past character choice, with empty hands and a's turn in the play phase. */
function rig(chars: CharKey[], roles: Role[], packs: Pack[] = [], random = () => 0.3): BangState {
  const players = chars.map((_, i) => IDS[i]);
  const s = newBangGame(players, T, { packs }, random);
  players.forEach((id, i) => (s.picks[id] = [chars[i]]));
  for (const id of players) pickCharacter(s, id, s.picks[id][0], T, names, random);
  // Reset to a clean table.
  const all = deckFor(s.packs);
  players.forEach((id, i) => {
    const p = s.ps[id];
    p.role = roles[i];
    p.hand = [];
    p.play = [];
    p.gold = 0;
    p.cubes = 0;
    p.dead = false;
    p.max = charLife(p.char) + (roles[i] === "sheriff" ? 1 : 0);
    p.life = p.max;
  });
  s.deck = all.slice();
  s.discard = [];
  s.queue = [];
  s.event = null;
  s.events = [];
  s.log = [];
  s.three = players.length === 3;
  startTurn(s, "a", T, false);
  s.turn!.step = "play";
  s.deadline = T + 60_000;
  return s;
}

import { CHARACTERS } from "../src/bang/cards";
const charLife = (k: CharKey) => CHARACTERS[k].life;

/** Move a card of `key` (optionally a given suit) into a player's hand. */
function give(s: BangState, id: string, key: CardKey, suit?: Suit): number {
  const c = s.deck.find((x) => CARDS[x].key === key && (!suit || CARDS[x].suit === suit));
  if (c === undefined) throw new Error(`no ${key} left`);
  s.deck.splice(s.deck.indexOf(c), 1);
  s.ps[id].hand.push(c);
  return c;
}
function put(s: BangState, id: string, key: CardKey): number {
  const c = give(s, id, key);
  s.ps[id].hand.splice(s.ps[id].hand.indexOf(c), 1);
  s.ps[id].play.push({ id: c });
  return c;
}
/** Put a card of the given suit (and rank range) on top of the deck. */
function top(s: BangState, suit: Suit, test: (rank: number) => boolean = () => true) {
  const c = s.deck.find((x) => CARDS[x].suit === suit && test(CARDS[x].rank));
  if (c === undefined) throw new Error("no such card");
  s.deck.splice(s.deck.indexOf(c), 1);
  s.deck.unshift(c);
}
const hand = (s: BangState, id: string) => s.ps[id].hand;

/** Every card of the packs is in exactly one place. */
function conserved(s: BangState) {
  const seen: number[] = [...s.deck, ...s.discard];
  for (const id of s.order) seen.push(...s.ps[id].hand, ...s.ps[id].play.map((c) => c.id));
  for (const q of s.queue) {
    if (q.kind === "store" || q.kind === "keep") seen.push(...q.cards);
    if (q.kind === "pokerEnd") seen.push(...q.pool);
  }
  const expected = deckFor(s.packs);
  expect(seen.length).toBe(expected.length);
  expect(new Set(seen).size).toBe(expected.length);
}

describe("cards", () => {
  it("has 80 base cards and 40 Dodge City cards", () => {
    expect(CARDS.filter((c) => CARD_PACK[c.id] === "base")).toHaveLength(80);
    expect(CARDS.filter((c) => CARD_PACK[c.id] === "dodge")).toHaveLength(40);
    expect(CARDS.filter((c) => CARD_PACK[c.id] === "base" && c.key === "bang")).toHaveLength(25);
    expect(CARDS.filter((c) => CARD_PACK[c.id] === "base" && c.key === "missed")).toHaveLength(12);
  });

  it("deals the right roles for 3–8 players", () => {
    for (let n = 3; n <= 8; n++) expect(ROLES_FOR[n]).toHaveLength(n);
    expect(ROLES_FOR[4].filter((r) => r === "sheriff")).toHaveLength(1);
  });
});

describe("setup", () => {
  it("lets everyone pick one of two characters, then deals life-sized hands", () => {
    const s = newBangGame(["a", "b", "c", "d"], T, { packs: ["dodge"] }, () => 0.1);
    expect(s.status).toBe("picking");
    for (const id of s.order) expect(s.picks[id]).toHaveLength(2);
    for (const id of s.order) expect(pickCharacter(s, id, s.picks[id][0], T, names).ok).toBe(true);
    expect(s.status).toBe("playing");
    const sheriff = s.order.find((id) => s.ps[id].role === "sheriff")!;
    expect(s.ps[sheriff].max).toBe(CHARACTERS[s.ps[sheriff].char].life + 1);
    expect(s.turn?.player).toBe(sheriff);
    conserved(s);
  });

  it("auto-picks for players who don't choose in time", () => {
    const s = newBangGame(["a", "b", "c"], T, { packs: [] }, () => 0.1);
    tickGame(s, T + 31_000, names, () => false, () => 0.1);
    expect(s.status).toBe("playing");
  });
});

describe("BANG! and Trượt!", () => {
  it("shoots within range only, once per turn", () => {
    const s = rig(["willy", "bart", "suzy", "kit"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    s.ps.a.char = "sid";
    const b1 = give(s, "a", "bang");
    const b2 = give(s, "a", "bang");
    expect(distance(s, "a", "c")).toBe(2);
    expect(playCard(s, "a", { card: b1, target: "c" }, T, names).ok).toBe(false);
    expect(playCard(s, "a", { card: b1, target: "b" }, T, names).ok).toBe(true);
    // b had nothing to answer with: hit at once (Bart draws 1).
    expect(s.ps.b.life).toBe(3);
    expect(hand(s, "b")).toHaveLength(1);
    expect(E(playCard(s, "a", { card: b2, target: "d" }, T, names))).toMatch(/đủ BANG/);
    conserved(s);
  });

  it("waits for an answer when the target holds a Trượt!", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const b = give(s, "a", "bang");
    const m = give(s, "b", "missed");
    playCard(s, "a", { card: b, target: "b" }, T, names);
    expect(s.queue[0]).toMatchObject({ kind: "react", to: "b", answer: "missed" });
    expect(respond(s, "a", { cards: [m] }, T, names).ok).toBe(false);
    expect(respond(s, "b", { cards: [m] }, T, names).ok).toBe(true);
    expect(s.ps.b.life).toBe(4);
    expect(s.queue).toHaveLength(0);
    conserved(s);
  });

  it("Sờ Lép needs two Trượt! and Súng Liên Thanh shoots without limit", () => {
    const s = rig(["slab", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    put(s, "a", "volcanic");
    const [b1, b2] = [give(s, "a", "bang"), give(s, "a", "bang")];
    const m = give(s, "b", "missed");
    playCard(s, "a", { card: b1, target: "b" }, T, names);
    // One Trượt! is not enough, so b cannot answer at all: auto-hit.
    expect(s.ps.b.life).toBe(3);
    expect(hand(s, "b")).toContain(m);
    expect(playCard(s, "a", { card: b2, target: "b" }, T, names).ok).toBe(true);
  });

  it("Thùng Gỗ turns a ♥ into a Trượt!", () => {
    const s = rig(["sid", "kit", "pixie", "rose"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    put(s, "b", "barrel");
    const b = give(s, "a", "bang");
    top(s, "H");
    playCard(s, "a", { card: b, target: "b" }, T, names);
    expect(s.ps.b.life).toBe(4);
    expect(s.queue).toHaveLength(0);
    conserved(s);
  });

  it("Ngựa Hoang pushes a player out of range; Ống Ngắm brings them back", () => {
    const s = rig(["sid", "kit", "suzy", "rose"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    put(s, "b", "mustang");
    expect(distance(s, "a", "b")).toBe(2);
    put(s, "a", "scope");
    expect(distance(s, "a", "b")).toBe(1);
  });
});

describe("life and death", () => {
  it("drinks a Bia automatically to survive, but not with two players left", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    s.ps.b.life = 1;
    give(s, "b", "beer");
    const b = give(s, "a", "bang");
    playCard(s, "a", { card: b, target: "b" }, T, names);
    expect(s.ps.b.dead).toBe(false);
    expect(s.ps.b.life).toBe(1);
  });

  it("pays 3 cards for an Outlaw, and the Sheriff who kills a Deputy loses everything", () => {
    const s = rig(["sid", "kit", "suzy", "paul", "jesse"], ["sheriff", "outlaw", "deputy", "renegade", "outlaw"]);
    s.ps.b.life = 1;
    const b = give(s, "a", "bang");
    playCard(s, "a", { card: b, target: "b" }, T, names);
    expect(s.ps.b.dead).toBe(true);
    expect(hand(s, "a")).toHaveLength(3);
    s.ps.c.life = 1;
    kill(s, "c", "a", T, names, () => 0.3);
    expect(hand(s, "a")).toHaveLength(0);
    conserved(s);
  });

  it("Outlaws win when the Sheriff falls; the Renegade only if he is the last one", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    kill(s, "a", "b", T, names, () => 0.3);
    expect(s.status).toBe("ended");
    expect(s.winners.sort()).toEqual(["b", "c"]);

    const r = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    kill(r, "b", "d", T, names, () => 0.3);
    kill(r, "c", "d", T, names, () => 0.3);
    expect(r.status).toBe("playing");
    kill(r, "a", "d", T, names, () => 0.3);
    expect(r.winners).toEqual(["d"]);
  });

  it("the law wins once every Outlaw and the Renegade are gone", () => {
    const s = rig(["sid", "kit", "suzy", "paul", "jesse"], ["sheriff", "outlaw", "deputy", "renegade", "outlaw"]);
    for (const id of ["b", "d", "e"]) kill(s, id, "a", T, names, () => 0.3);
    expect(s.winners.sort()).toEqual(["a", "c"]);
  });

  it("Kền Kền takes the dead player's cards", () => {
    const s = rig(["sid", "vulture", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    give(s, "c", "beer");
    put(s, "c", "mustang");
    s.ps.c.life = 0;
    kill(s, "c", null, T, names, () => 0.3);
    expect(hand(s, "b")).toHaveLength(2);
    conserved(s);
  });
});

describe("turn structure", () => {
  it("draws 2, forces discarding down to the life total, and passes the turn", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    for (let i = 0; i < 7; i++) give(s, "a", "bang");
    expect(E(endTurn(s, "a", {}, T, names))).toMatch(/Phải bỏ 2 lá/);
    expect(endTurn(s, "a", { discard: hand(s, "a").slice(0, 2) }, T, names).ok).toBe(true);
    // b is Kít Soi Bài: sees 3, keeps 2.
    expect(s.turn?.player).toBe("b");
    expect(s.queue[0]).toMatchObject({ kind: "keep", to: "b", keep: 2 });
    const look = (s.queue[0] as { cards: number[] }).cards;
    expect(respond(s, "b", { cards: look.slice(1) }, T, names).ok).toBe(true);
    expect(hand(s, "b")).toHaveLength(2);
    expect(s.deck[0]).toBe(look[0]);
    conserved(s);
  });

  it("Nhà Giam skips the turn unless the draw! is ♥", () => {
    const s = rig(["sid", "paul", "suzy", "pixie"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const j = give(s, "a", "jail");
    expect(playCard(s, "a", { card: j, target: "b" }, T, names).ok).toBe(true);
    top(s, "S");
    endTurn(s, "a", {}, T, names);
    expect(s.turn?.player).toBe("c");
    expect(s.ps.b.play).toHaveLength(0);
    conserved(s);
  });

  it("Thuốc Nổ explodes on ♠ 2–9", () => {
    const s = rig(["sid", "paul", "suzy", "pixie"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    put(s, "b", "dynamite");
    top(s, "S", (r) => r >= 2 && r <= 9);
    endTurn(s, "a", {}, T, names);
    // Phôn Né Tránh has 3 life: 3 damage kills him.
    expect(s.ps.b.dead).toBe(true);
    expect(s.turn?.player).toBe("c");
  });

  it("green cards are usable from the owner's next turn", () => {
    const s = rig(["sid", "kit", "suzy", "pixie"], ["sheriff", "outlaw", "outlaw", "renegade"], ["dodge"]);
    const k = give(s, "a", "knife");
    expect(playCard(s, "a", { card: k }, T, names).ok).toBe(true);
    expect(E(useCard(s, "a", { card: k, target: "b" }, T, names))).toMatch(/lượt sau/);
    // A green Trượt! works on someone else's turn once it is ready.
    const plate = put(s, "b", "ironplate");
    const b = give(s, "a", "bang");
    playCard(s, "a", { card: b, target: "b" }, T, names);
    expect(s.queue[0]).toMatchObject({ kind: "react", to: "b" });
    expect(respond(s, "b", { cards: [plate] }, T, names).ok).toBe(true);
    expect(s.ps.b.life).toBe(4);
  });
});

describe("brown cards", () => {
  it("Đấu Tay Đôi alternates until someone has no BANG!", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const d = give(s, "a", "duel");
    const b1 = give(s, "b", "bang");
    playCard(s, "a", { card: d, target: "b" }, T, names);
    expect(s.queue[0]).toMatchObject({ to: "b", answer: "bang" });
    respond(s, "b", { cards: [b1] }, T, names);
    // a has no BANG! left: loses 1.
    expect(s.ps.a.life).toBe(4);
    conserved(s);
  });

  it("Da Đỏ! hits everyone without a BANG!", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const i = give(s, "a", "indians");
    const bb = give(s, "c", "bang");
    playCard(s, "a", { card: i }, T, names);
    expect(s.ps.b.life).toBe(3);
    expect(s.queue[0]).toMatchObject({ to: "c" });
    respond(s, "c", { cards: [bb] }, T, names);
    expect(s.ps.d.life).toBe(2);
    expect(s.ps.c.life).toBe(4);
  });

  it("Tạp Hoá lets everyone pick in turn", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const g = give(s, "a", "generalstore");
    playCard(s, "a", { card: g }, T, names);
    for (const id of ["a", "b", "c", "d"]) {
      expect(s.queue[0]).toMatchObject({ kind: "store", to: id });
      respond(s, id, {}, T, names);
    }
    // (Su Xinh also refilled her empty hand before picking.)
    for (const id of ["a", "b", "d"]) expect(hand(s, id)).toHaveLength(1);
    conserved(s);
  });

  it("Hoảng Loạn steals within distance 1; Chuồn cancels it", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["valley"]);
    const [p1, p2] = [give(s, "a", "panic"), give(s, "a", "panic")];
    const hat = put(s, "b", "mustang");
    expect(playCard(s, "a", { card: p1, target: "c", pick: { zone: "hand" } }, T, names).ok).toBe(false);
    expect(E(playCard(s, "a", { card: p1, target: "b", pick: { zone: "play", card: hat } }, T, names))).toMatch(/khoảng cách/);
    const b = give(s, "a", "bang");
    s.ps.b.play = [];
    s.discard.push(hat);
    const esc = give(s, "b", "escape");
    give(s, "b", "beer");
    expect(playCard(s, "a", { card: p2, target: "b", pick: { zone: "hand" } }, T, names).ok).toBe(true);
    expect(s.queue[0]).toMatchObject({ kind: "react", to: "b", answer: "evade" });
    respond(s, "b", { cards: [esc] }, T, names);
    expect(hand(s, "b")).toHaveLength(1);
    expect(s.queue).toHaveLength(0);
    expect(hand(s, "a")).toContain(b);
    conserved(s);
  });

  it("Cứu Nguy blocks damage for someone else", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["valley"]);
    const b = give(s, "a", "bang");
    give(s, "c", "saved");
    playCard(s, "a", { card: b, target: "b" }, T, names);
    expect(s.queue[0]).toMatchObject({ kind: "save", to: "c", target: "b" });
    respond(s, "c", {}, T, names);
    expect(s.ps.b.life).toBe(4);
    conserved(s);
  });

  it("Dodge City cards cost one more card", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["dodge"]);
    s.ps.a.life = 2;
    const w = give(s, "a", "whisky");
    expect(playCard(s, "a", { card: w }, T, names).ok).toBe(false);
    const x = give(s, "a", "bang");
    expect(playCard(s, "a", { card: w, extra: [x] }, T, names).ok).toBe(true);
    expect(s.ps.a.life).toBe(4);
    expect(hand(s, "a")).toHaveLength(0);
  });
});

describe("expansions", () => {
  it("Giữa Trưa hurts everyone at the start of their turn", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["highnoon"]);
    s.event = "highnoon";
    endTurn(s, "a", {}, T, names);
    expect(s.ps.b.life).toBe(3);
  });

  it("Phục Kích makes every distance 1", () => {
    const s = rig(["sid", "kit", "suzy", "paul", "jesse", "pixie"], ["sheriff", "outlaw", "outlaw", "renegade", "outlaw", "deputy"], ["fistful"]);
    // 3 seats away, +1 for Phôn Né Tránh.
    expect(distance(s, "a", "d")).toBe(4);
    s.event = "ambush";
    expect(distance(s, "a", "d")).toBe(1);
  });

  it("Cò Quay Nga goes round until someone has no Trượt!", () => {
    const s = rig(["sid", "kit", "pixie", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["fistful"]);
    s.events = ["roulette"];
    give(s, "a", "missed");
    give(s, "b", "missed");
    startTurn(s, "a", T, false);
    run(s, T, names);
    let guard = 0;
    while (s.queue[0]?.kind === "react" && guard++ < 10) {
      const q = s.queue[0];
      respond(s, q.to, { cards: hand(s, q.to).slice(0, 1) }, T, names);
    }
    expect(s.event).toBe("roulette");
    expect(s.ps.c.life).toBe(1);
    expect(s.ps.a.life).toBe(5);
  });

  it("Cơn Sốt Vàng: gold for discarded cards, and the shop", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["goldrush"]);
    expect(s.shop).toHaveLength(3);
    s.ps.a.gold = 10;
    const slot = s.shop.findIndex((k) => k === "unionpacific" || k === "pickaxe" || k === "ace" || k === "horseshoe");
    if (slot >= 0) expect(buyGear(s, "a", { slot }, T, names).ok).toBe(true);
    const a1 = give(s, "a", "bang");
    endTurn(s, "a", { discard: [a1] }, T, names);
    expect(s.ps.a.gold).toBeGreaterThanOrEqual(1);
  });

  it("Đai Đạn spends a cube for an extra BANG!", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["armed"]);
    const bd = give(s, "a", "bandolier");
    playCard(s, "a", { card: bd }, T, names);
    expect(s.ps.a.play[0].cubes).toBe(2);
    const [b1, b2] = [give(s, "a", "bang"), give(s, "a", "bang")];
    playCard(s, "a", { card: b1, target: "b" }, T, names);
    expect(playCard(s, "a", { card: b2, target: "b" }, T, names).ok).toBe(false);
    expect(useCard(s, "a", { card: bd }, T, names).ok).toBe(true);
    expect(playCard(s, "a", { card: b2, target: "b" }, T, names).ok).toBe(true);
  });

  it("character powers show up for their owner", () => {
    const s = rig(["chuck", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"], ["dodge"]);
    expect(abilityList(s, "a")).toContain("chuck");
    expect(useAbility(s, "a", { name: "chuck" }, T, names).ok).toBe(true);
    expect(hand(s, "a")).toHaveLength(2);
    expect(s.ps.a.life).toBe(4);
  });
});

describe("timeouts", () => {
  it("answers for absent players and ends their turn", () => {
    const s = rig(["sid", "kit", "suzy", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    for (let i = 0; i < 8; i++) give(s, "a", "bang");
    tickGame(s, T + 61_000, names, () => false);
    expect(s.turn?.player).not.toBe("a");
    expect(hand(s, "a").length).toBeLessThanOrEqual(5);
    conserved(s);
  });
});

describe("prompt clocks", () => {
  it("starts a queued prompt's clock only when it reaches the front", () => {
    const s = rig(["sid", "kit", "pixie", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const g = give(s, "a", "gatling");
    const mb = give(s, "b", "missed");
    give(s, "c", "missed");
    give(s, "d", "missed");
    playCard(s, "a", { card: g }, T, names);
    expect(s.queue[0]).toMatchObject({ to: "b" });
    respond(s, "b", { cards: [mb] }, T + 10_000, names);
    expect(s.queue[0]).toMatchObject({ to: "c" });
    // c's 15 s started at +10 s: at +20 s nothing is due yet.
    tickGame(s, T + 20_000, names, () => false);
    expect(s.queue[0]).toMatchObject({ to: "c" });
    tickGame(s, T + 26_000, names, () => false);
    expect(s.queue[0]).toMatchObject({ to: "d" });
  });

  it("passes a Tạp Hoá on when the picker dies", () => {
    const s = rig(["sid", "kit", "pixie", "paul"], ["sheriff", "outlaw", "outlaw", "renegade"]);
    const g = give(s, "a", "generalstore");
    playCard(s, "a", { card: g }, T, names);
    respond(s, "a", {}, T, names);
    kill(s, "b", null, T, names, () => 0.3);
    expect(s.queue[0]).toMatchObject({ kind: "store", to: "c" });
    conserved(s);
  });
});

describe("room", () => {
  it("hides roles and hands from other players", () => {
    const room: BangRoom = newBangRoom("BANG1");
    const toks = ["tok-aaaaaaaa", "tok-bbbbbbbb", "tok-cccccccc", "tok-dddddddd"];
    let n = 0;
    for (const t of toks) joinBang(room, t, `P${n}`, T, () => `p${n++}`);
    expect(bangCommand(room, toks[0], { type: "start" }, T).ok).toBe(true);
    const g = room.current!;
    for (const id of g.order) pickCharacter(g, id, g.picks[id][0], T, names);
    const view = bangView(room, room.seats[1], T);
    const cur = view.current!;
    const me = cur.players.find((p) => p.id === view.meId)!;
    expect(me.role).not.toBeNull();
    expect(me.hand).not.toBeNull();
    for (const p of cur.players) {
      if (p.id === view.meId) continue;
      expect(p.hand).toBeNull();
      if (g.ps[p.id].role !== "sheriff") expect(p.role).toBeNull();
    }
  });
});

// ─── Random games: nothing crashes, cards are conserved, games end ─

function bot(s: BangState, id: string, rnd: () => number) {
  const p = s.ps[id];
  const others = s.order.filter((o) => o !== id);
  const pickOne = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const head = s.queue[0];
  if (head && "to" in head && head.to === id && head.kind !== "hurt" && head.kind !== "pokerEnd") {
    if (head.kind === "draw") {
      drawCommand(s, id, pickOne(head.options), { target: pickOne(others), targets: [pickOne(others)], card: s.ps[pickOne(others)].play[0]?.id, color: rnd() < 0.5 ? "red" : "black" }, T, names, rnd);
      if (s.queue[0] === head) drawCommand(s, id, "normal", {}, T, names, rnd);
      return;
    }
    const r = rnd();
    const res =
      head.kind === "react"
        ? respond(s, id, r < 0.6 ? { cards: p.hand.slice(0, 1).concat(r < 0.3 ? p.hand.slice(1, 2) : []) } : { take: true }, T, names, rnd)
        : respond(s, id, { cards: p.hand.slice(0, 2), card: head.kind === "store" ? head.cards[0] : undefined, choice: head.kind === "copy" ? head.options[0] : undefined }, T, names, rnd);
    if (!res.ok) tickGame(s, s.deadline! + 1, names, () => true, rnd);
    return;
  }
  if (s.turn?.player === id && s.turn.step === "play" && !s.queue.length) {
    for (let i = 0; i < 4; i++) {
      const card = pickOne(p.hand);
      if (card === undefined) break;
      const target = pickOne(others);
      const tp = s.ps[target];
      const pick = rnd() < 0.5 || !tp.play.length ? ({ zone: "hand" } as const) : ({ zone: "play", card: tp.play[0].id } as const);
      playCard(s, id, { card, target, target2: pickOne(others), pick, extra: rnd() < 0.3 ? [pickOne(p.hand)] : undefined, as: rnd() < 0.1 ? "bang" : undefined, mode: rnd() < 0.5 ? "take" : undefined }, T, names, rnd);
      if (s.queue.length || s.turn?.player !== id) return;
    }
    const inplay = p.play.find((c) => rnd() < 0.3 && c);
    if (inplay) useCard(s, id, { card: inplay.id, target: pickOne(others), pick: { zone: "hand" } }, T, names, rnd);
    if (s.queue.length || s.turn?.player !== id) return;
    const ab = abilityList(s, id);
    if (ab.length && rnd() < 0.3) useAbility(s, id, { name: pickOne(ab), target: pickOne(others), cards: p.hand.slice(0, 2), card: p.hand[0] }, T, names, rnd);
    if (s.queue.length || s.turn?.player !== id) return;
    if (s.shop.length && p.gold > 1 && rnd() < 0.5) buyGear(s, id, { slot: 0, target: pickOne(others), mode: "beer", pick: { zone: "hand" } }, T, names, rnd);
    if (s.queue.length || s.turn?.player !== id) return;
    const over = p.hand.length - Math.max(0, p.life);
    endTurn(s, id, { discard: over > 0 ? p.hand.slice(0, over) : [] }, T, names, rnd);
    if (s.turn?.player === id && s.turn.step === "play" && !s.queue.length) tickGame(s, s.deadline! + 1, names, () => true, rnd);
  }
}

function seeded(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

describe("random games", () => {
  it("play to the end with every pack, conserving cards", () => {
    let ended = 0;
    for (let g = 0; g < 150; g++) {
      const rnd = seeded(g + 7);
      const n = 3 + (g % 6);
      const packs = EXPANSIONS.filter(() => rnd() < 0.6);
      const players = IDS.slice(0, n).split("");
      const s = newBangGame(players, T, { packs }, rnd);
      for (const id of players) pickCharacter(s, id, s.picks[id][Math.floor(rnd() * 2)], T, names, rnd);
      for (let step = 0; step < 4000 && s.status === "playing"; step++) {
        const who = s.queue[0] && "to" in s.queue[0] ? s.queue[0].to : s.turn?.player;
        if (!who) break;
        const before = JSON.stringify([s.queue.length, s.turn, s.logSeq]);
        bot(s, who, rnd);
        if (JSON.stringify([s.queue.length, s.turn, s.logSeq]) === before) tickGame(s, (s.deadline ?? T) + 1, names, () => true, rnd);
        run(s, T, names, rnd);
      }
      conserved(s);
      if (s.status === "ended") ended += 1;
    }
    expect(ended).toBeGreaterThan(100);
  });
});

void tickBang;
