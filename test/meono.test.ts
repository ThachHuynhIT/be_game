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
import { digDeeper, forfeitPlayer, playClairvoyance } from "../src/meono/game";
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
    const s = rig({ A: ["attack"], B: ["superskip", "catomic"], C: ["taco"] }, ["taco", "exploding", "melon", "exploding"], ["streaking"]);
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
    expect(meoCommand(room, "token-aaaa", { type: "settings", turnSeconds: 45, nopeSeconds: 5, first: 3, second: 1, expansions: ["streaking"] }, T).ok).toBe(true);
    meoCommand(room, "token-aaaa", { type: "start" }, T);
    expect(room.current?.turnDeadline).toBe(T + 45_000);
    expect(room.current?.nopeMs).toBe(5_000);
    expect(room.current?.expansions).toEqual(["streaking"]);
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

describe("Streaking Kittens pack", () => {
  it("Mèo Chạy Rông lets you keep a drawn Mèo Nổ in your hand", () => {
    const s = rig({ A: ["streaking"], B: ["skip"] }, ["exploding", "taco"], ["streaking"]);
    drawCard(s, "A", T, names);
    expect(s.out).toEqual([]);
    expect(s.hands.A.map((c) => c.type).sort()).toEqual(["exploding", "streaking"]);
    expect(s.choice).toBeNull();
    expect(s.turn).toBe("B");
  });

  it("losing the Streaking Kitten means dealing with the held Mèo Nổ", () => {
    const s = rig({ A: ["streaking", "exploding", "defuse"], B: ["taco", "taco"] }, ["taco"], ["streaking"]);
    s.turn = "B";
    // B's pair steals the first card of A's hand — the Streaking Kitten.
    playCards(s, "B", ids(s, "B", "taco", "taco"), { target: "A" }, T, names);
    tickGame(s, T + NOPE_WINDOW_MS * 2 + 500, names, never, () => 0);
    expect(s.hands.B.some((c) => c.type === "streaking")).toBe(true);
    expect(s.choice).toMatchObject({ kind: "defuse", player: "A", endsTurn: false });
    insertKitten(s, "A", 0, T, names);
    expect(s.turn).toBe("B"); // A's forced defuse doesn't touch B's turn
  });

  it("Xem tương lai ×5 shows five cards", () => {
    const s = rig({ A: ["future5"], B: ["skip"] }, ["taco", "melon", "potato", "beard", "rainbow", "skip"], ["streaking"]);
    playCards(s, "A", ids(s, "A", "future5"), {}, T, names);
    settle(s);
    expect(s.future?.cards.map((c) => c.type)).toEqual(["taco", "melon", "potato", "beard", "rainbow"]);
  });

  it("Dọn rác: everyone puts a card back, then the deck is shuffled", () => {
    const s = rig({ A: ["garbage", "taco"], B: ["melon"] }, ["skip"], ["streaking"]);
    playCards(s, "A", ids(s, "A", "garbage"), {}, T, names);
    settle(s);
    expect(s.choice).toMatchObject({ kind: "offer", mode: "garbage", player: "A" });
    giveCard(s, "A", ids(s, "A", "taco")[0], T, names);
    expect(s.choice).toMatchObject({ kind: "offer", player: "B" });
    giveCard(s, "B", ids(s, "B", "melon")[0], T, names);
    expect(s.choice).toBeNull();
    expect(s.deck.map((c) => c.type).sort()).toEqual(["melon", "skip", "taco"]);
  });

  it("Đánh dấu reveals a card of the target; Lời nguyền makes their hand blind", () => {
    let n = 0;
    const room = newMeoRoom("MARKS");
    joinMeo(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinMeo(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    meoCommand(room, "token-aaaa", { type: "settings", expansions: ["streaking"] }, T);
    meoCommand(room, "token-aaaa", { type: "start" }, T);
    const g = room.current!;
    const [a, b] = ["p1", "p2"];
    g.turn = a;
    g.hands[a] = [card("mark"), card("curse")];
    g.hands[b] = [card("taco"), card("melon")];
    meoCommand(room, "token-aaaa", { type: "mplay", cards: [g.hands[a][0].id], target: b }, T);
    tickMeo(room, T + 8_000);
    const seenByA = meoView(room, room.seats[0], T + 8_000).seats.find((x) => x?.id === b)!;
    expect(seenByA.marked).toHaveLength(1);
    meoCommand(room, "token-aaaa", { type: "mplay", cards: [g.hands[a][0].id], target: b }, T + 8_000);
    tickMeo(room, T + 16_000);
    const bView = meoView(room, room.seats[1], T + 16_000);
    expect(bView.hand.every((c) => (c.type as string) === "hidden" && c.id < 0)).toBe(true);
    expect(bView.seats.find((x) => x?.id === b)?.cursed).toBe(true);
    // A's turn ends → B's turn → B plays blind (a cat alone is refused, but the id is translated).
    meoCommand(room, "token-aaaa", { type: "draw" }, T + 16_000);
    expect(g.turn).toBe(b);
    expect(meoCommand(room, "token-bbbb", { type: "mplay", cards: [-1] }, T + 16_000)).toEqual({ ok: false, error: "Lá mèo phải đánh theo đôi hoặc bộ ba" });
    meoCommand(room, "token-bbbb", { type: "draw" }, T + 16_000);
    expect(g.cursed).toEqual([]);
  });
});

describe("Barking Kittens pack", () => {
  it("Mèo Sủa: whoever holds the other one loses a defuse, or explodes", () => {
    const s = rig({ A: ["barking"], B: ["barking", "defuse"], C: ["barking"] }, ["taco"], ["barking"]);
    // Only two exist in a real deck; here B is found first.
    playCards(s, "A", ids(s, "A", "barking"), {}, T, names);
    settle(s);
    expect(s.hands.B.map((c) => c.type)).toEqual([]);
    expect(s.out).toEqual([]);
    const t = rig({ A: ["barking"], B: ["barking"] }, ["taco"], ["barking"]);
    playCards(t, "A", ids(t, "A", "barking"), {}, T, names);
    settle(t);
    expect(t.out).toEqual(["B"]);
  });

  it("Để đó cho tui: the target's next draw goes to you", () => {
    const s = rig({ A: ["ilt"], B: ["skip"] }, ["taco", "melon"], ["barking"]);
    playCards(s, "A", ids(s, "A", "ilt"), { target: "B" }, T, names);
    settle(s);
    drawCard(s, "A", T, names); // A draws taco normally
    drawCard(s, "B", T, names); // B draws melon… for A
    expect(s.hands.A.map((c) => c.type).sort()).toEqual(["melon", "taco"]);
    expect(s.hands.B.map((c) => c.type)).toEqual(["skip"]);
  });

  it("Sửa tương lai ngay can be played on someone else's turn", () => {
    const s = rig({ A: ["skip"], B: ["alternow"] }, ["taco", "melon", "potato", "beard"], ["barking"]);
    expect(playCards(s, "B", ids(s, "B", "alternow"), {}, T, names).ok).toBe(true);
    settle(s);
    expect(s.choice).toMatchObject({ kind: "alter", player: "B" });
    const order = (s.choice as { cards: MCard[] }).cards.map((c) => c.id).reverse();
    alterFuture(s, "B", order, T, names);
    expect(s.deck.slice(0, 3).map((c) => c.type)).toEqual(["potato", "melon", "taco"]);
    expect(s.turn).toBe("A");
  });

  it("Chôn bài hides the top card anywhere and ends the turn", () => {
    const s = rig({ A: ["bury"], B: ["skip"] }, ["exploding", "taco", "melon"], ["barking"]);
    playCards(s, "A", ids(s, "A", "bury"), {}, T, names);
    settle(s);
    expect(s.choice?.kind).toBe("bury");
    insertKitten(s, "A", 2, T, names);
    expect(s.deck.map((c) => c.type)).toEqual(["taco", "melon", "exploding"]);
    expect(s.turn).toBe("B");
  });

  it("Tự tấn công adds two turns; Chia sẻ tương lai shows the next player", () => {
    const s = rig({ A: ["personal", "share"], B: ["skip"] }, ["taco", "melon", "potato", "beard"], ["barking"]);
    playCards(s, "A", ids(s, "A", "personal"), {}, T, names);
    settle(s);
    expect(s.turnsLeft).toBe(3);
    playCards(s, "A", ids(s, "A", "share"), {}, T, names);
    tickGame(s, T + 2 * (NOPE_WINDOW_MS * 2 + 500), names, never, () => 0);
    const c = s.choice as { kind: string; cards: MCard[] };
    alterFuture(s, "A", c.cards.map((x) => x.id), T, names);
    expect(s.shared?.player).toBe("B");
    expect(s.shared?.cards.map((x) => x.type)).toEqual(["taco", "melon", "potato"]);
  });
});

describe("Zombie Kittens pack", () => {
  it("Mèo Xác Sống brings an exploded player back with 2 cards from the discard pile", () => {
    const s = rig({ A: ["zombie"], B: ["skip"], C: ["skip"] }, ["taco"], ["zombie"]);
    s.out = ["C"];
    s.hands.C = [];
    s.discard = [card("melon"), card("exploding"), card("potato")];
    expect(playCards(s, "A", ids(s, "A", "zombie"), { target: "B" }, T, names).ok).toBe(false);
    expect(playCards(s, "A", ids(s, "A", "zombie"), { target: "C" }, T, names).ok).toBe(true);
    settle(s);
    expect(s.out).toEqual([]);
    expect(s.hands.C.map((c) => c.type).sort()).toEqual(["melon", "potato"]);
  });

  it("kicked players can't be revived", () => {
    const s = rig({ A: ["zombie"], B: ["skip"], C: ["skip"] }, ["taco"], ["zombie"]);
    forfeitPlayer(s, "C", T, names);
    expect(playCards(s, "A", ids(s, "A", "zombie"), { target: "C" }, T, names).ok).toBe(false);
  });

  it("Đào sâu: keep the top card, or skip it and take the next", () => {
    const s = rig({ A: ["dig"], B: ["dig"] }, ["exploding", "taco", "melon"], ["zombie"]);
    playCards(s, "A", ids(s, "A", "dig"), {}, T, names);
    settle(s);
    expect(s.choice?.kind).toBe("dig");
    digDeeper(s, "A", false, T, names);
    expect(s.hands.A.map((c) => c.type)).toEqual(["taco"]);
    expect(s.deck[0].type).toBe("exploding");
    expect(s.turn).toBe("B");
  });

  it("Nhân bản copies the action played just before", () => {
    const s = rig({ A: ["personal", "clone"], B: ["skip"] }, ["taco"], ["zombie", "barking"]);
    playCards(s, "A", ids(s, "A", "personal"), {}, T, names);
    settle(s);
    expect(s.turnsLeft).toBe(3);
    playCards(s, "A", ids(s, "A", "clone"), {}, T, names);
    tickGame(s, T + 2 * (NOPE_WINDOW_MS * 2 + 500), names, never, () => 0);
    expect(s.turnsLeft).toBe(5);
    const t = rig({ A: ["clone"], B: ["skip"] }, ["taco"], ["zombie"]);
    expect(playCards(t, "A", ids(t, "A", "clone"), {}, T, names).ok).toBe(false);
  });

  it("Nuôi xác sống sends a card of each player to the discard pile; Đào mộ gives one back to each", () => {
    const s = rig({ A: ["feed", "taco", "grave"], B: ["melon"] }, ["skip"], ["zombie"]);
    playCards(s, "A", ids(s, "A", "feed"), {}, T, names);
    settle(s);
    giveCard(s, "A", ids(s, "A", "taco")[0], T, names);
    giveCard(s, "B", ids(s, "B", "melon")[0], T, names);
    expect(s.discard.map((c) => c.type)).toEqual(["feed", "taco", "melon"]);
    playCards(s, "A", ids(s, "A", "grave"), {}, T, names);
    tickGame(s, T + 2 * (NOPE_WINDOW_MS * 2 + 500), names, never, () => 0);
    expect(s.hands.A).toHaveLength(1);
    expect(s.hands.B).toHaveLength(1);
  });

  it("Xác sống tấn công adds a turn per eliminated player", () => {
    const s = rig({ A: ["deadattack"], B: ["skip"], C: ["skip"], D: ["skip"] }, ["taco"], ["zombie"]);
    s.out = ["C", "D"];
    playCards(s, "A", ids(s, "A", "deadattack"), {}, T, names);
    settle(s);
    expect(s.turn).toBe("B");
    expect(s.turnsLeft).toBe(4);
  });

  it("Thấu thị reveals where another player hides their kitten", () => {
    const s = rig({ A: ["defuse"], B: ["clairvoyance"] }, ["exploding", "taco", "melon", "potato"], ["zombie"]);
    drawCard(s, "A", T, names);
    expect(s.choice?.kind).toBe("defuse");
    expect(playClairvoyance(s, "B", ids(s, "B", "clairvoyance")[0], T, names).ok).toBe(true);
    insertKitten(s, "A", 2, T, names);
    expect(s.visions?.B.text).toContain("lá thứ 3");
  });
});
