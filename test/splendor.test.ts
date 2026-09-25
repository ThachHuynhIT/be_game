import { describe, expect, it } from "vitest";
import { CARDS, CARD_BY_ID, GEMS, NOBLES, NOBLE_BY_ID } from "../src/splendor/cards";
import {
  ABSENT_MS,
  type SPState,
  buyCard,
  discardTokens,
  newSPGame,
  paymentFor,
  pointsOf,
  reserveCard,
  takeGems,
  tickGame,
} from "../src/splendor/game";
import { joinSP, newSPRoom, spCommand, spView } from "../src/splendor/room";

const names = (id: string) => id;
const never = () => false;
const T = 1_000_000;

function game(players = ["a", "b"]): SPState {
  const s = newSPGame(players, T, { target: 15 }, () => 0);
  s.players = players.slice();
  s.turn = players[0];
  return s;
}

describe("cards", () => {
  it("has 40 / 30 / 20 cards, evenly split by colour, and 10 nobles", () => {
    expect(CARDS.filter((c) => c.tier === 1)).toHaveLength(40);
    expect(CARDS.filter((c) => c.tier === 2)).toHaveLength(30);
    expect(CARDS.filter((c) => c.tier === 3)).toHaveLength(20);
    for (const g of GEMS) expect(CARDS.filter((c) => c.bonus === g)).toHaveLength(18);
    expect(NOBLES).toHaveLength(10);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(90);
  });

  it("deals 4 face-up cards per tier and players + 1 nobles", () => {
    const s = newSPGame(["a", "b", "c"], T, { target: 15 });
    expect(s.board.map((r) => r.length)).toEqual([4, 4, 4]);
    expect(s.nobleRow).toHaveLength(4);
    expect(s.bank.white).toBe(5);
    expect(s.bank.gold).toBe(5);
  });
});

describe("taking gems", () => {
  it("takes 3 different, or 2 of a colour only from a pile of 4+", () => {
    const s = game();
    expect(takeGems(s, "a", ["white", "white", "blue"], T, names).ok).toBe(false);
    expect(takeGems(s, "a", ["white", "blue"], T, names).ok).toBe(false);
    expect(takeGems(s, "a", ["white", "blue", "green"], T, names).ok).toBe(true);
    expect(s.tokens.a).toMatchObject({ white: 1, blue: 1, green: 1 });
    expect(s.turn).toBe("b");
    expect(takeGems(s, "b", ["white", "white"], T, names).ok).toBe(false); // pile of 3 left
    expect(takeGems(s, "b", ["red", "red"], T, names).ok).toBe(true);
  });

  it("makes you return tokens above 10", () => {
    const s = game();
    s.tokens.a = { white: 3, blue: 3, green: 3, red: 0, black: 0, gold: 0 };
    takeGems(s, "a", ["red", "black", "white"], T, names);
    expect(s.phase).toBe("discard");
    expect(s.discardNeed).toBe(2);
    expect(discardTokens(s, "a", { white: 1 }, T, names).ok).toBe(false);
    expect(discardTokens(s, "a", { white: 1, blue: 1 }, T, names).ok).toBe(true);
    expect(s.turn).toBe("b");
  });
});

describe("buying and reserving", () => {
  it("pays with bonuses first, then gems, then gold", () => {
    const s = game();
    const card = CARD_BY_ID[s.board[0][0]!];
    const [g] = Object.keys(card.cost) as (keyof typeof card.cost)[];
    s.tokens.a = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 5, ...{} };
    for (const [gem, n] of Object.entries(card.cost)) s.tokens.a[gem as typeof g] = Math.max(0, (n ?? 0) - 1);
    const pay = paymentFor(s, "a", card)!;
    expect(pay.gold).toBe(Object.keys(card.cost).length);
    expect(buyCard(s, "a", card.id, T, names).ok).toBe(true);
    expect(s.owned.a).toEqual([card.id]);
    expect(s.board[0]).not.toContain(card.id);
    expect(s.board[0]).toHaveLength(4);
  });

  it("reserves a face-up card or a blind one, with a gold token, max 3", () => {
    const s = game(["a"].concat("b"));
    const id = s.board[1][0]!;
    expect(reserveCard(s, "a", { card: id }, T, names).ok).toBe(true);
    expect(s.tokens.a.gold).toBe(1);
    s.turn = "a";
    expect(reserveCard(s, "a", { tier: 3 }, T, names).ok).toBe(true);
    s.turn = "a";
    reserveCard(s, "a", { tier: 1 }, T, names);
    s.turn = "a";
    expect(reserveCard(s, "a", { tier: 1 }, T, names)).toEqual({ ok: false, error: "Chỉ giữ tối đa 3 thẻ" });
    // A reserved card can be bought later.
    s.tokens.a = { white: 9, blue: 9, green: 9, red: 9, black: 9, gold: 0 };
    expect(buyCard(s, "a", id, T, names).ok).toBe(true);
    expect(s.reserved.a).not.toContain(id);
  });

  it("hides other players' reserved cards", () => {
    let n = 0;
    const room = newSPRoom("GEMSS");
    joinSP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinSP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    spCommand(room, "token-aaaa", { type: "start" }, T);
    const g = room.current!;
    const turnToken = g.turn === "p1" ? "token-aaaa" : "token-bbbb";
    expect(spCommand(room, turnToken, { type: "reserve", tier: 2 }, T).ok).toBe(true);
    const owner = g.players.find((p) => g.reserved[p].length)!;
    const ownerSeat = room.seats.find((p) => p?.id === owner)!;
    const otherSeat = room.seats.find((p) => p && p.id !== owner)!;
    expect(spView(room, ownerSeat, T).current!.players.find((p) => p.id === owner)!.reserved[0]).toBeTypeOf("number");
    expect(spView(room, otherSeat, T).current!.players.find((p) => p.id === owner)!.reserved).toEqual([null]);
  });
});

describe("nobles and the end", () => {
  it("a noble visits when bonuses match; reaching the target finishes the round", () => {
    const s = game(["a", "b"]);
    const noble = NOBLE_BY_ID[s.nobleRow[0]];
    // Give "a" enough owned cards for the noble.
    for (const [gem, need] of Object.entries(noble.req)) {
      s.owned.a.push(...CARDS.filter((c) => c.bonus === gem && c.tier === 1).slice(0, need).map((c) => c.id));
    }
    s.owned.a.push(...CARDS.filter((c) => c.tier === 3 && c.points === 5).slice(0, 3).map((c) => c.id));
    takeGems(s, "a", ["white", "blue", "green"], T, names);
    expect(s.nobles.a).toEqual([noble.id]);
    expect(pointsOf(s, "a")).toBeGreaterThanOrEqual(15);
    expect(s.endTriggered).toBe(true);
    expect(s.status).toBe("playing"); // b still gets a turn
    takeGems(s, "b", ["white", "blue", "green"], T, names);
    expect(s.status).toBe("ended");
    expect(s.finished[0]).toBe("a");
  });
});

describe("timers", () => {
  it("plays for an offline player", () => {
    const s = game();
    tickGame(s, T + ABSENT_MS + 1, names, (id) => id === "a");
    expect(s.turn).toBe("b");
    expect(Object.values(s.tokens.a).reduce((x, y) => x + y, 0)).toBe(3);
    expect(tickGame(s, T + ABSENT_MS + 2, names, never)).toBe(false);
  });
});

describe("room settings", () => {
  it("target, turn time and points apply to the next game and scoring", () => {
    let n = 0;
    const room = newSPRoom("GEMST");
    joinSP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinSP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(spCommand(room, "token-aaaa", { type: "settings", target: 13 }, T).ok).toBe(false);
    expect(spCommand(room, "token-aaaa", { type: "settings", target: 10, turnSeconds: 60, first: 3, second: 1 }, T).ok).toBe(true);
    spCommand(room, "token-aaaa", { type: "start" }, T);
    expect(room.current?.target).toBe(10);
    expect(room.current?.deadline).toBe(T + 60_000);
    // Force an end and check the scoring.
    const g = room.current!;
    g.endTriggered = true;
    g.turn = g.players[g.players.length - 1];
    g.owned[g.turn].push(...CARDS.filter((c) => c.tier === 3 && c.points === 5).slice(0, 2).map((c) => c.id));
    const token = room.seats.find((p) => p?.id === g.turn)!.token;
    expect(spCommand(room, token, { type: "take", gems: ["white", "blue", "green"] }, T).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(room.history?.[0].results.map((r) => r.delta)).toEqual([3, -3]);
  });
});
