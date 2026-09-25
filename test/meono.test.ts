import { describe, expect, it } from "vitest";
import { BASE_COUNTS, type CardType, type MCard, deal } from "../src/meono/cards";
import {
  CHOICE_MS,
  type MeoState,
  NOPE_WINDOW_MS,
  TURN_MS,
  alterFuture,
  drawCard,
  giveCard,
  implodingAt,
  insertKitten,
  newMeoGame,
  playCards,
  playNope,
  tickGame,
} from "../src/meono/game";
import { type MeoRoom, joinMeo, meoCommand, meoView, newMeoRoom, tickMeo } from "../src/meono/room";
import { meonoAdapter } from "../src/server/adapters";
import { createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";

const names = (id: string) => id;
const never = () => false;
const T = 1_000_000;
let nextId = 1000;
const card = (type: CardType, extra: Partial<MCard> = {}): MCard => ({ id: nextId++, type, ...extra });

/** A game with hand-made hands and deck (top first); A starts. */
function rig(hands: Record<string, CardType[]>, deck: CardType[], expansions: MeoState["expansions"] = []): MeoState {
  const players = Object.keys(hands);
  const s = newMeoGame(players, T, expansions, () => 0);
  s.hands = Object.fromEntries(players.map((p) => [p, hands[p].map((t) => card(t))]));
  s.deck = deck.map((t) => card(t));
  s.turn = players[0];
  return s;
}
const ids = (s: MeoState, p: string, ...types: CardType[]) => {
  const pool = s.hands[p].slice();
  return types.map((t) => {
    const i = pool.findIndex((c) => c.type === t);
    const [c] = pool.splice(i, 1);
    return c.id;
  });
};
// Well past any Nope window, but before the turn timer.
const settle = (s: MeoState) => tickGame(s, T + NOPE_WINDOW_MS * 2 + 500, names, never, () => 0);

describe("deal", () => {
  it("gives 7 + a defuse each and puts players − 1 kittens in the deck", () => {
    const { hands, deck } = deal(["a", "b", "c", "d"], [], Math.random);
    for (const h of Object.values(hands)) {
      expect(h).toHaveLength(8);
      expect(h.filter((c) => c.type === "defuse")).toHaveLength(1);
      expect(h.some((c) => c.type === "exploding")).toBe(false);
    }
    expect(deck.filter((c) => c.type === "exploding")).toHaveLength(3);
    const total = Object.values(hands).flat().length + deck.length;
    // All base cards minus the kittens that stayed out.
    const base = Object.values(BASE_COUNTS).reduce((a, b) => a + b!, 0);
    expect(total).toBe(base - 1);
  });

  it("the Mèo Tự Huỷ pack replaces one kitten with the imploding one and allows 6 players", () => {
    const { deck } = deal(["a", "b", "c", "d", "e", "f"], ["imploding"], Math.random);
    expect(deck.filter((c) => c.type === "imploding")).toHaveLength(1);
    expect(deck.filter((c) => c.type === "exploding")).toHaveLength(4);
    expect(() => newMeoGame(["a", "b", "c", "d", "e", "f"], T, [])).toThrow();
  });
});

describe("turns, nope and kittens", () => {
  it("drawing a normal card ends the turn", () => {
    const s = rig({ A: ["taco"], B: ["melon"] }, ["skip", "exploding"]);
    expect(drawCard(s, "A", T, names).ok).toBe(true);
    expect(s.turn).toBe("B");
    expect(s.hands.A.map((c) => c.type)).toContain("skip");
  });

  it("an action waits for the Nope window; odd nopes cancel, even nopes let it through", () => {
    const s = rig({ A: ["skip", "skip"], B: ["nope", "nope"], C: ["nope"] }, ["taco", "taco", "exploding", "exploding"]);
    playCards(s, "A", ids(s, "A", "skip"), {}, T, names);
    expect(s.turn).toBe("A"); // not resolved yet
    playNope(s, "B", ids(s, "B", "nope")[0], T + 100, names);
    settle(s);
    expect(s.turn).toBe("A"); // noped → A still has to draw
    playCards(s, "A", ids(s, "A", "skip"), {}, T + 5000, names);
    playNope(s, "B", ids(s, "B", "nope")[0], T + 5100, names);
    playNope(s, "C", ids(s, "C", "nope")[0], T + 5200, names);
    tickGame(s, T + 5200 + NOPE_WINDOW_MS + 1, names, never);
    expect(s.turn).toBe("B"); // nope-noped → skip goes through
  });

  it("defuse lets you hide the kitten; without one you explode and the game can end", () => {
    const s = rig({ A: ["defuse"], B: ["taco"] }, ["exploding", "taco", "exploding"]);
    drawCard(s, "A", T, names);
    expect(s.choice?.kind).toBe("defuse");
    expect(insertKitten(s, "A", 1, T, names).ok).toBe(true);
    expect(s.deck.map((c) => c.type)).toEqual(["taco", "exploding", "exploding"]);
    expect(s.turn).toBe("B");
    drawCard(s, "B", T, names); // taco
    drawCard(s, "A", T, names); // exploding, no defuse left
    expect(s.status).toBe("ended");
    expect(s.finished).toEqual(["B", "A"]);
  });

  it("attacks stack: attacked player attacking passes turns + 2", () => {
    const s = rig({ A: ["attack"], B: ["attack"], C: ["taco"] }, ["taco", "taco", "taco", "taco", "taco", "exploding"]);
    playCards(s, "A", ids(s, "A", "attack"), {}, T, names);
    settle(s);
    expect([s.turn, s.turnsLeft]).toEqual(["B", 2]);
    playCards(s, "B", ids(s, "B", "attack"), {}, T, names);
    settle(s);
    expect([s.turn, s.turnsLeft]).toEqual(["C", 4]);
  });

  it("pairs steal at random, triples take the named card, Mèo Hoang is wild", () => {
    const s = rig({ A: ["taco", "feral", "melon", "melon", "melon"], B: ["defuse", "skip"] }, ["taco", "exploding"], ["imploding"]);
    playCards(s, "A", ids(s, "A", "taco", "feral"), { target: "B" }, T, names);
    settle(s);
    expect(s.hands.B).toHaveLength(1);
    const want = s.hands.B[0].type;
    playCards(s, "A", ids(s, "A", "melon", "melon", "melon"), { target: "B", named: want }, T, names);
    settle(s);
    expect(s.hands.B).toHaveLength(0);
    const lone = rig({ A: ["taco"], B: ["melon"] }, ["taco", "exploding"]);
    expect(playCards(lone, "A", ids(lone, "A", "taco"), {}, T, names).ok).toBe(false);
  });

  it("favor makes the target choose a card to give", () => {
    const s = rig({ A: ["favor"], B: ["defuse", "skip"] }, ["taco", "exploding"]);
    playCards(s, "A", ids(s, "A", "favor"), { target: "B" }, T, names);
    settle(s);
    expect(s.choice).toMatchObject({ kind: "favor", from: "B", to: "A" });
    expect(giveCard(s, "B", ids(s, "B", "skip")[0], T, names).ok).toBe(true);
    expect(s.hands.A.map((c) => c.type)).toEqual(["skip"]);
  });

  it("five different cards take a chosen card from the discard pile", () => {
    const s = rig({ A: ["taco", "melon", "potato", "beard", "rainbow"], B: ["taco"] }, ["taco", "exploding"]);
    s.discard.push(card("defuse"));
    playCards(s, "A", ids(s, "A", "taco", "melon", "potato", "beard", "rainbow"), { named: "defuse" }, T, names);
    settle(s);
    expect(s.hands.A.map((c) => c.type)).toEqual(["defuse"]);
  });

  it("an idle turn times out into a draw; absent players are played at once", () => {
    const s = rig({ A: ["taco"], B: ["melon"] }, ["skip", "skip", "exploding"]);
    expect(tickGame(s, T + TURN_MS - 1, names, never)).toBe(false);
    tickGame(s, T + TURN_MS, names, never);
    expect(s.turn).toBe("B");
    tickGame(s, T + TURN_MS + 1, names, (id) => id === "B");
    expect(s.turn).toBe("A");
  });
});

describe("expansion cards", () => {
  it("Mèo Tự Huỷ: first draw flips it face up (public position), second draw eliminates even with a defuse", () => {
    const s = rig({ A: ["defuse"], B: ["defuse"], C: ["taco"] }, ["imploding", "taco", "taco"], ["imploding"]);
    drawCard(s, "A", T, names);
    expect(s.choice?.kind).toBe("implode");
    insertKitten(s, "A", 0, T, names);
    expect(implodingAt(s)).toBe(0);
    expect(s.hands.A.map((c) => c.type)).toEqual(["defuse"]); // no defuse spent
    drawCard(s, "B", T, names);
    expect(s.out).toEqual(["B"]);
  });

  it("Đảo chiều reverses play and ends the turn", () => {
    const s = rig({ A: ["reverse"], B: ["taco"], C: ["taco"] }, ["taco", "taco", "exploding", "exploding"], ["imploding"]);
    playCards(s, "A", ids(s, "A", "reverse"), {}, T, names);
    settle(s);
    expect(s.turn).toBe("C");
  });

  it("Rút từ đáy draws the bottom card", () => {
    const s = rig({ A: ["bottom"], B: ["taco"] }, ["exploding", "melon"], ["imploding"]);
    playCards(s, "A", ids(s, "A", "bottom"), {}, T, names);
    settle(s);
    expect(s.hands.A.map((c) => c.type)).toEqual(["melon"]);
    expect(s.turn).toBe("B");
  });

  it("Sửa tương lai reorders the top three", () => {
    const s = rig({ A: ["alter"], B: ["taco"] }, ["exploding", "taco", "melon", "potato"], ["imploding"]);
    playCards(s, "A", ids(s, "A", "alter"), {}, T, names);
    settle(s);
    expect(s.choice?.kind).toBe("alter");
    const c = s.choice as { cards: MCard[] };
    const order = [c.cards[1].id, c.cards[2].id, c.cards[0].id];
    expect(alterFuture(s, "A", order, T, names).ok).toBe(true);
    expect(s.deck.map((x) => x.type)).toEqual(["taco", "melon", "exploding", "potato"]);
  });

  it("Tấn công chỉ định picks the victim", () => {
    const s = rig({ A: ["targeted"], B: ["taco"], C: ["taco"] }, ["taco", "taco", "exploding"], ["imploding"]);
    playCards(s, "A", ids(s, "A", "targeted"), { target: "C" }, T, names);
    settle(s);
    expect([s.turn, s.turnsLeft]).toEqual(["C", 2]);
  });

  it("Siêu bỏ lượt ends every remaining turn; Bom Mèo Nguyên Tử puts all kittens on top", () => {
    const s = rig({ A: ["attack"], B: ["superskip", "catomic"], C: ["taco"] }, ["taco", "exploding", "melon", "exploding"], ["chaos"]);
    playCards(s, "A", ids(s, "A", "attack"), {}, T, names);
    settle(s);
    expect([s.turn, s.turnsLeft]).toEqual(["B", 2]);
    playCards(s, "B", ids(s, "B", "superskip"), {}, T, names);
    settle(s);
    expect([s.turn, s.turnsLeft]).toEqual(["C", 1]);
    s.turn = "B";
    playCards(s, "B", ids(s, "B", "catomic"), {}, T, names);
    settle(s);
    expect(s.deck.slice(0, 2).map((c) => c.type)).toEqual(["exploding", "exploding"]);
  });
});

describe("Mèo Nổ room", () => {
  it("host sets packs, starts, and a finished game is scored", () => {
    const room = newMeoRoom("MEOWS");
    const a = joinMeo(room, "token-meo-a1", "An", T, () => "a");
    const b = joinMeo(room, "token-meo-b1", "Bình", T, () => "b");
    expect(a.ok && b.ok).toBe(true);
    expect(meoCommand(room, "token-meo-b1", { type: "settings", expansions: ["imploding"] }, T).ok).toBe(false);
    expect(meoCommand(room, "token-meo-a1", { type: "settings", expansions: ["imploding", "bogus" as never] }, T).ok).toBe(true);
    expect(room.expansions).toEqual(["imploding"]);
    expect(meoCommand(room, "token-meo-a1", { type: "start" }, T).ok).toBe(true);
    expect(room.current?.expansions).toEqual(["imploding"]);
    const v = meoView(room, room.seats[0], T);
    expect(v.hand).toHaveLength(8);
    expect(meoView(room, null, T).hand).toEqual([]);
    // Let the clock run: everyone keeps heartbeating, turns time out into draws until someone explodes.
    for (let t = T; room.current!.status === "playing" && t < T + 5 * 3_600_000; t += Math.max(TURN_MS, CHOICE_MS) + 1) {
      room.seats.forEach((p) => p && (p.lastSeen = t));
      tickMeo(room, t);
    }
    expect(room.current!.status).toBe("ended");
    expect(room.history).toHaveLength(1);
    expect(room.history![0].results.reduce((s, r) => s + r.delta, 0)).toBe(0);
  });

  it("plays through the hub with the meono adapter", async () => {
    const hub = createRoomHub(createMemoryRoomStore<MeoRoom>(), meonoAdapter);
    const code = await hub.createRoom();
    const res = await hub.mutate(code, (room, now) => [
      meonoAdapter.join(room, "token-hub-aaa", "A", now, () => "A"),
      meonoAdapter.join(room, "token-hub-bbb", "B", now, () => "B"),
      meonoAdapter.command(room, "token-hub-aaa", { type: "start" }, now),
    ]);
    expect(res.found && res.result.every((r) => r.ok)).toBe(true);
    const loaded = await hub.store.load(code);
    const view = meonoAdapter.view(loaded!.state, "token-hub-bbb", "player", Date.now()) as { hand: unknown[]; current: { status: string } };
    expect(view.hand).toHaveLength(8);
    expect(view.current.status).toBe("playing");
  });
});

describe("settings", () => {
  it("host sets turn / Nope timers and points for the next game", () => {
    let n = 0;
    const room = newMeoRoom("SETMN");
    joinMeo(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinMeo(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(meoCommand(room, "token-bbbb", { type: "settings", turnSeconds: 45 }, T).ok).toBe(false);
    expect(meoCommand(room, "token-aaaa", { type: "settings", turnSeconds: 12 }, T).ok).toBe(false);
    expect(meoCommand(room, "token-aaaa", { type: "settings", turnSeconds: 45, nopeSeconds: 5, first: 3, second: 1, expansions: ["chaos"] }, T).ok).toBe(true);
    meoCommand(room, "token-aaaa", { type: "start" }, T);
    expect(room.current?.turnDeadline).toBe(T + 45_000);
    expect(room.current?.nopeMs).toBe(5_000);
    expect(room.current?.expansions).toEqual(["chaos"]);
    expect(meoView(room, room.seats[0], T).settings).toEqual({ turnSeconds: 45, nopeSeconds: 5, first: 3, second: 1 });
  });
});

describe("hiding the kitten", () => {
  it("keeps it out of the top and bottom 10% when the deck is big enough", async () => {
    const { insertRange } = await import("../src/meono/game");
    expect(insertRange(5)).toEqual([0, 5]); // too small: anywhere
    expect(insertRange(9)).toEqual([0, 9]);
    expect(insertRange(10)).toEqual([1, 9]);
    expect(insertRange(40)).toEqual([4, 36]);
  });

  it("rejects a position in the forbidden zone and accepts one inside", () => {
    const s = rig({ A: ["skip"], B: ["skip"] }, Array.from({ length: 30 }, () => "taco"));
    s.choice = { kind: "defuse", player: "A", kitten: card("exploding"), deadline: T + CHOICE_MS };
    expect(insertKitten(s, "A", 0, T, names).ok).toBe(false);
    expect(insertKitten(s, "A", 30, T, names).ok).toBe(false);
    expect(insertKitten(s, "A", 3, T, names).ok).toBe(true);
    expect(s.deck[3].type).toBe("exploding");
  });

  it("the timeout hides it inside the allowed zone too", () => {
    const s = rig({ A: ["skip"], B: ["skip"] }, Array.from({ length: 30 }, () => "taco"));
    s.choice = { kind: "defuse", player: "A", kitten: card("exploding"), deadline: T + 1 };
    tickGame(s, T + 2, names, never, () => 0);
    expect(s.deck.findIndex((c) => c.type === "exploding")).toBe(3);
  });
});
