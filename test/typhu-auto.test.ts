import { describe, expect, it } from "vitest";
import { BOARD, groupPositions, houseCost } from "../src/typhu/board";
import { ABSENT_MS, AUTO_BUY_BELOW, AUTO_KEEP_CASH, type TPState, buildBlocker, newTPGame, proposeTrade, rulesOf, tickGame } from "../src/typhu/game";
import { joinTP, newTPRoom, tickTP, tpCommand, tpView } from "../src/typhu/room";

const names = (id: string) => id;
const never = () => false;
const T = 1_000_000;
const isA = (id: string) => id === "a";

/** Dice that roll the given faces in order (then 1s). */
function dice(...faces: number[]) {
  const q = [...faces];
  return () => ((q.length ? q.shift()! : 1) - 1) / 6 + 0.01;
}

function game(cash = 1500): TPState {
  const s = newTPGame(["a", "b"], T, { startCash: cash, timeLimitMin: 0 }, () => 0);
  s.turn = "a";
  return s;
}

/** One auto step for "a" (auto-play on), ABSENT_MS after the current phase began. */
const step = (s: TPState, random = dice(1, 1)) => tickGame(s, s.phaseAt + ABSENT_MS, names, never, random, isA);

/** Put "a" three squares before `target` so a roll of 1 + 2 lands there. */
function landOn(s: TPState, target: number) {
  s.ps.a.pos = (target - 3 + BOARD.length) % BOARD.length;
  step(s, dice(1, 2));
  expect(s.ps.a.pos).toBe(target);
}

describe("Cờ Tỷ Phú auto-play (Ctrl+Shift+Y)", () => {
  it("buys a cheap square while keeping the reserve", () => {
    const s = game();
    const cheap = BOARD.findIndex((b, i) => i >= 3 && b.kind === "prop" && b.price < AUTO_BUY_BELOW);
    landOn(s, cheap);
    expect(s.phase).toBe("buy");
    step(s);
    expect(s.deeds[cheap]?.owner).toBe("a");
  });

  it("skips a square at or above AUTO_BUY_BELOW", () => {
    const s = game();
    const dear = BOARD.findIndex((b) => b.kind === "prop" && b.price >= AUTO_BUY_BELOW);
    expect(dear).toBeGreaterThan(0);
    landOn(s, dear);
    step(s);
    expect(s.deeds[dear]).toBeUndefined();
    expect(s.phase).toBe("end");
  });

  it("skips a purchase that would leave AUTO_KEEP_CASH or less", () => {
    const cheap = BOARD.findIndex((b, i) => i >= 3 && b.kind === "prop" && b.price < AUTO_BUY_BELOW);
    const price = (BOARD[cheap] as { price: number }).price;
    const s = game(AUTO_KEEP_CASH + price); // after buying exactly AUTO_KEEP_CASH would be left
    landOn(s, cheap);
    step(s);
    expect(s.deeds[cheap]).toBeUndefined();
  });

  it("builds evenly on a full colour group at the end of the turn, keeps the reserve, then ends the turn", () => {
    const s = game(1000);
    const group = groupPositions("brown");
    for (const pos of group) s.deeds[pos] = { owner: "a", houses: 0, mortgaged: false };
    s.phase = "end";
    step(s);
    const houses = group.map((p) => s.deeds[p].houses);
    expect(Math.min(...houses)).toBeGreaterThan(0);
    expect(Math.max(...houses) - Math.min(...houses)).toBeLessThanOrEqual(1); // even-build rule
    expect(s.ps.a.cash).toBeGreaterThan(AUTO_KEEP_CASH);
    // It stopped only because of the reserve (or the hotel cap): every build still allowed would cut into it.
    for (const p of group) {
      if (buildBlocker(s, "a", p)) continue;
      const cost = houseCost(BOARD[p] as Extract<(typeof BOARD)[number], { kind: "prop" }>, s.deeds[p].houses + 1, rulesOf(s));
      expect(s.ps.a.cash - cost).toBeLessThanOrEqual(AUTO_KEEP_CASH);
    }
    expect(s.turn).toBe("b");
  });

  it("does not build without the full group when the table needs it", () => {
    const s = game(1000);
    const [first] = groupPositions("brown");
    s.deeds[first] = { owner: "a", houses: 0, mortgaged: false };
    s.phase = "end";
    step(s);
    expect(s.deeds[first].houses).toBe(0);
    expect(s.turn).toBe("b");
  });

  it("an offline player (no auto-play) is still only moved along: no purchase, no building", () => {
    const s = game();
    const cheap = BOARD.findIndex((b, i) => i >= 3 && b.kind === "prop" && b.price < AUTO_BUY_BELOW);
    s.ps.a.pos = cheap - 3;
    tickGame(s, s.phaseAt + ABSENT_MS, names, isA, dice(1, 2));
    tickGame(s, s.phaseAt + ABSENT_MS, names, isA);
    expect(s.deeds[cheap]).toBeUndefined();
  });

  it("an offer to an auto-playing player waits for an answer (it only expires for offline players)", () => {
    const s = game();
    s.turn = "b";
    s.deeds[1] = { owner: "b", houses: 0, mortgaged: false };
    expect(proposeTrade(s, "b", { to: "a", give: { props: [1], cash: 0 }, get: { props: [], cash: 10 } }, T, names).ok).toBe(true);
    tickGame(s, T + ABSENT_MS + 1, names, never, Math.random, isA);
    expect(s.trade).not.toBeNull();
  });
});

describe("Cờ Tỷ Phú auto-play through the room", () => {
  it("toggles with { type: 'auto' }, plays the player's turn while they stay online, and only they see the flag", () => {
    let id = 0;
    const room = newTPRoom("AUTO1");
    joinTP(room, "token-aaaaaaaa", "An", T, () => `p${id++}`, "token-aaaaaaaa");
    joinTP(room, "token-bbbbbbbb", "Bình", T, () => `p${id++}`, "token-bbbbbbbb");
    expect(tpCommand(room, "token-aaaaaaaa", { type: "start" }, T).ok).toBe(true);
    const g = room.current!;
    const turnToken = room.seats.find((p) => p?.id === g.turn)!.token;
    const otherToken = turnToken === "token-aaaaaaaa" ? "token-bbbbbbbb" : "token-aaaaaaaa";

    expect(tpCommand(room, turnToken, { type: "auto", on: true }, T + 1).ok).toBe(true);
    const me = room.seats.find((p) => p?.token === turnToken)!;
    const other = room.seats.find((p) => p?.token === otherToken)!;
    expect(tpView(room, me, T + 1).auto).toBe(true);
    expect(tpView(room, other, T + 1).auto).toBeUndefined();

    // Both stay online (heartbeats); the auto player's turn still moves on, one step per ABSENT_MS.
    const before = g.phaseAt;
    me.lastSeen = other.lastSeen = T + ABSENT_MS;
    expect(tickTP(room, T + ABSENT_MS + 1)).toBe(true);
    expect(g.phaseAt).toBeGreaterThan(before);

    expect(tpCommand(room, turnToken, { type: "auto", on: false }, T + ABSENT_MS + 2).ok).toBe(true);
    expect(tpView(room, me, T + ABSENT_MS + 2).auto).toBeUndefined();
  });
});
