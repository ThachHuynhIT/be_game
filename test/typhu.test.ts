import { describe, expect, it } from "vitest";
import { BOARD, CHANCE, CHEST, GO_SALARY, JAIL_POS, boardOf, groupPositions, jailPos } from "../src/typhu/board";
import {
  ABSENT_MS,
  LOG_LIMIT,
  STEP_MS,
  type TPState,
  answerTrade,
  build,
  buildBlocker,
  buySquare,
  declareBankrupt,
  endTurn,
  mortgage,
  newTPGame,
  payDebt,
  payJail,
  proposeTrade,
  rentFor,
  rollDice,
  sellBlocker,
  sellHouse,
  sellLand,
  skipBuy,
  tickGame,
  unmortgage,
} from "../src/typhu/game";
import { joinTP, newTPRoom, tickTP, tpCommand, tpView } from "../src/typhu/room";
import { typhuAdapter } from "../src/server/adapters";
import { createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";

const names = (id: string) => id;
const never = () => false;
const T = 1_000_000;

/** Dice that roll the given faces in order (then 1s). */
function dice(...faces: number[]) {
  const q = [...faces];
  return () => ((q.length ? q.shift()! : 1) - 1) / 6 + 0.01;
}

function game(players = ["a", "b"], cash = 1500): TPState {
  const s = newTPGame(players, T, { startCash: cash, timeLimitMin: 0 }, () => 0);
  s.turn = players[0];
  return s;
}

describe("board", () => {
  it("has 40 squares with 22 cities, 4 airports, 2 utilities and 31 + 32 card decks", () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD.filter((b) => b.kind === "prop")).toHaveLength(22);
    expect(BOARD.filter((b) => b.kind === "air")).toHaveLength(4);
    expect(BOARD.filter((b) => b.kind === "util")).toHaveLength(2);
    expect(BOARD[JAIL_POS].kind).toBe("jail");
    expect(BOARD[30].kind).toBe("gotojail");
    expect(CHANCE).toHaveLength(31);
    expect(CHEST).toHaveLength(32);
  });
});

describe("moving and buying", () => {
  it("rolls, moves, offers to buy and charges rent to the next visitor", () => {
    const s = game();
    expect(rollDice(s, "a", T, names, dice(1, 2)).ok).toBe(true); // → 3 Bạc Liêu
    expect(s.ps.a.pos).toBe(3);
    expect(s.phase).toBe("buy");
    expect(buySquare(s, "a", T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1440);
    expect(s.phase).toBe("end");
    expect(endTurn(s, "a", T, names).ok).toBe(true);
    expect(s.turn).toBe("b");
    rollDice(s, "b", T, names, dice(1, 2));
    expect(s.ps.b.cash).toBe(1496);
    expect(s.ps.a.cash).toBe(1444);
  });

  it("pays the salary when passing Khởi hành", () => {
    const s = game();
    s.ps.a.pos = 38;
    rollDice(s, "a", T, names, dice(2, 3)); // → 3
    expect(s.ps.a.pos).toBe(3);
    expect(s.ps.a.cash).toBe(1500 + GO_SALARY);
  });

  it("gives another roll on doubles and jails on the third", () => {
    const s = game();
    rollDice(s, "a", T, names, dice(3, 3)); // → 6 Cần Thơ
    skipBuy(s, "a", T, names);
    expect(s.phase).toBe("roll");
    rollDice(s, "a", T, names, dice(1, 1)); // → 8 An Giang
    skipBuy(s, "a", T, names);
    rollDice(s, "a", T, names, dice(2, 2));
    expect(s.ps.a.pos).toBe(JAIL_POS);
    expect(s.ps.a.jail).toBe(1);
    expect(s.phase).toBe("end");
  });

  it("each building on a lot costs more than the last; selling returns half of that building", () => {
    const s = game(["a", "b"], 5000);
    s.deeds[37] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[39] = { owner: "a", houses: 0, mortgaged: false };
    s.phase = "end";
    const base = (BOARD[39] as { house: number }).house; // 200
    const paid: number[] = [];
    for (let n = 0; n < 5; n++)
      for (const pos of [37, 39]) {
        const before = s.ps.a.cash;
        expect(build(s, "a", pos, T, names).ok).toBe(true);
        if (pos === 39) paid.push(before - s.ps.a.cash);
      }
    expect(paid).toEqual([base, base * 1.25, base * 1.5, base * 1.75, base * 2]);
    const before = s.ps.a.cash;
    expect(sellHouse(s, "a", 39, T, names).ok).toBe(true);
    expect(s.ps.a.cash - before).toBe(base); // half of the hotel's 2× price
  });

  it("doubles rent on a full colour set and uses the house table after building", () => {
    const s = game();
    s.deeds[1] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[3] = { owner: "a", houses: 0, mortgaged: false };
    expect(rentFor(s, 1, 7)).toBe(4);
    s.phase = "end";
    expect(build(s, "a", 1, T, names).ok).toBe(true);
    expect(build(s, "a", 1, T, names)).toEqual({ ok: false, error: "Phải xây đều các ô trong nhóm" });
    expect(build(s, "a", 3, T, names).ok).toBe(true);
    expect(rentFor(s, 1, 7)).toBe(10);
    expect(sellHouse(s, "a", 1, T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1500 - 100 + 25);
  });

  it("charges airports by count and utilities by dice", () => {
    const s = game();
    s.deeds[5] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[15] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[12] = { owner: "a", houses: 0, mortgaged: false };
    expect(rentFor(s, 5, 0)).toBe(50);
    expect(rentFor(s, 5, 0, "air2")).toBe(100);
    expect(rentFor(s, 12, 8)).toBe(32);
    s.deeds[28] = { owner: "a", houses: 0, mortgaged: false };
    expect(rentFor(s, 12, 8)).toBe(80);
  });

  it("mortgaged land earns no rent and costs 10% to lift", () => {
    const s = game();
    s.deeds[39] = { owner: "a", houses: 0, mortgaged: false };
    expect(mortgage(s, "a", 39, T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1700);
    expect(rentFor(s, 39, 0)).toBe(0);
    expect(unmortgage(s, "a", 39, T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1480);
  });

  it("other players' houses on the same colour don't block my mortgage or house sale", () => {
    const s = game();
    s.deeds[37] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[39] = { owner: "b", houses: 3, mortgaged: false };
    expect(mortgage(s, "a", 37, T, names).ok).toBe(true);
    s.deeds[1] = { owner: "a", houses: 1, mortgaged: false };
    s.deeds[3] = { owner: "b", houses: 3, mortgaged: false };
    expect(sellHouse(s, "a", 1, T, names).ok).toBe(true);
    // My own houses in the group still do.
    s.deeds[37] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[39] = { owner: "a", houses: 1, mortgaged: false };
    expect(mortgage(s, "a", 37, T, names).ok).toBe(false);
  });
});

describe("jail", () => {
  it("frees on doubles, or after the third failed roll with a fine", () => {
    const s = game();
    s.ps.a.pos = JAIL_POS;
    s.ps.a.jail = 1;
    rollDice(s, "a", T, names, dice(1, 2));
    expect(s.ps.a.jail).toBe(2);
    expect(s.phase).toBe("end");
    s.phase = "roll";
    rollDice(s, "a", T, names, dice(1, 2));
    s.phase = "roll";
    rollDice(s, "a", T, names, dice(1, 3)); // third try: pay 50 and move 4 → 14
    expect(s.ps.a.jail).toBe(0);
    expect(s.ps.a.pos).toBe(14);
    expect(s.ps.a.cash).toBe(1450);
  });

  it("lets you pay the fine or use a card before rolling", () => {
    const s = game();
    s.ps.a.jail = 1;
    s.ps.a.pos = JAIL_POS;
    s.ps.a.jailCards = ["chance"];
    const before = s.chance.length;
    expect(payJail(s, "a", true, T, names).ok).toBe(true);
    expect(s.chance).toHaveLength(before + 1);
    expect(s.ps.a.jail).toBe(0);
    s.ps.a.jail = 1;
    expect(payJail(s, "a", false, T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1450);
  });
});

describe("cards", () => {
  it("applies the next Cơ hội card (goes to jail)", () => {
    const s = game();
    s.chance = [CHANCE.findIndex((c) => c.effect.kind === "jail")];
    rollDice(s, "a", T, names, dice(3, 4)); // → 7 Cơ hội
    expect(s.ps.a.pos).toBe(JAIL_POS);
    expect(s.ps.a.jail).toBe(1);
    expect(s.lastCard?.deck).toBe("chance");
  });

  it("birthday: everyone else pays", () => {
    const s = game(["a", "b", "c"]);
    s.chest = [CHEST.findIndex((c) => c.effect.kind === "each")];
    rollDice(s, "a", T, names, dice(1, 1)); // → 2 Khí vận
    expect(s.ps.a.cash).toBe(1520);
    expect(s.ps.b.cash).toBe(1490);
  });
});

describe("debt and bankruptcy", () => {
  it("opens a debt, settles after mortgaging, and bankrupts to the creditor", () => {
    const s = game(["a", "b", "c"]);
    s.rules = { ...s.rules!, bankruptTo: "creditor" };
    s.deeds[39] = { owner: "b", houses: 5, mortgaged: false };
    s.deeds[37] = { owner: "b", houses: 5, mortgaged: false };
    s.deeds[1] = { owner: "a", houses: 0, mortgaged: false };
    s.ps.a.cash = 100;
    s.ps.a.pos = 33;
    rollDice(s, "a", T, names, dice(2, 4)); // → 39 with a hotel: 2800
    expect(s.phase).toBe("debt");
    expect(payDebt(s, "a", T, names).ok).toBe(false);
    expect(declareBankrupt(s, "a", T, names).ok).toBe(true);
    expect(s.ps.a.bankrupt).toBe(true);
    expect(s.deeds[1].owner).toBe("b");
    expect(s.ps.b.cash).toBe(1600);
    expect(s.turn).toBe("b");
  });

  it("by default a bankrupt player's land goes back on the market; the creditor gets the cash", () => {
    const s = game(["a", "b", "c"]);
    s.deeds[39] = { owner: "b", houses: 5, mortgaged: false };
    s.deeds[1] = { owner: "a", houses: 0, mortgaged: true };
    s.ps.a.cash = 100;
    s.ps.a.pos = 33;
    rollDice(s, "a", T, names, dice(2, 4));
    declareBankrupt(s, "a", T, names);
    expect(s.deeds[1]).toBeUndefined();
    expect(s.ps.b.cash).toBe(1600);
    // Land that's free again can be bought normally.
    s.turn = "c";
    s.ps.c.pos = 1;
    s.phase = "buy";
    expect(buySquare(s, "c", T, names).ok).toBe(true);
    expect(s.deeds[1].owner).toBe("c");
  });

  it("ends the game when one player is left", () => {
    const s = game();
    s.ps.a.cash = 10;
    s.ps.a.pos = 1;
    rollDice(s, "a", T, names, dice(1, 2)); // → 4 thuế 200
    expect(s.phase).toBe("debt");
    declareBankrupt(s, "a", T, names);
    expect(s.status).toBe("ended");
    expect(s.finished).toEqual(["b", "a"]);
  });

  it("time limit ranks by net worth", () => {
    const s = newTPGame(["a", "b"], T, { startCash: 1500, timeLimitMin: 20 }, () => 0);
    s.deeds[39] = { owner: "b", houses: 0, mortgaged: false };
    tickGame(s, T + 20 * 60_000, names, never);
    expect(s.status).toBe("ended");
    expect(s.finished).toEqual(["b", "a"]);
  });
});

describe("house rules", () => {
  // Brown group: 1, 3 · light blue: 6, 8, 9
  const own = (s: TPState, id: string, ...pos: number[]) => pos.forEach((p) => (s.deeds[p] = { owner: id, houses: 0, mortgaged: false }));

  it("even rule: must build evenly", () => {
    const s = game();
    own(s, "a", 6, 8, 9);
    expect(build(s, "a", 6, T, names).ok).toBe(true);
    expect(build(s, "a", 6, T, names).ok).toBe(false);
    expect(buildBlocker(s, "a", 6)).toBe("Phải xây đều các ô trong nhóm");
  });

  it("chain rule: 2nd house needs 2 lots with a house, 4th needs all at 3, hotel needs all at 4", () => {
    const s = game();
    s.ps.a.cash = 100_000;
    s.rules = { ...s.rules!, buildRule: "chain" };
    own(s, "a", 6, 8, 9);
    expect(build(s, "a", 6, T, names).ok).toBe(true);
    expect(buildBlocker(s, "a", 6)).toMatch(/Nhà 2/);
    expect(build(s, "a", 8, T, names).ok).toBe(true);
    expect(build(s, "a", 6, T, names).ok).toBe(true); // 2 lots have a house → house 2 ok, lot 9 still empty
    expect(buildBlocker(s, "a", 6)).toMatch(/Nhà 3/);
    expect(build(s, "a", 8, T, names).ok).toBe(true);
    expect(build(s, "a", 6, T, names).ok).toBe(true); // 3 houses
    expect(buildBlocker(s, "a", 6)).toMatch(/Nhà 4/); // lot 9 has none
    for (let i = 0; i < 3; i++) build(s, "a", 9, T, names);
    build(s, "a", 8, T, names);
    expect(s.deeds[9].houses).toBe(3);
    expect(build(s, "a", 6, T, names).ok).toBe(true); // all at ≥3 → house 4
    expect(buildBlocker(s, "a", 6)).toMatch(/Khách sạn/);
    build(s, "a", 8, T, names);
    build(s, "a", 9, T, names);
    expect(build(s, "a", 6, T, names).ok).toBe(true);
    expect(s.deeds[6].houses).toBe(5);
    // Selling must keep the chain valid: lot 9 can't drop below 4 while 6 has a hotel.
    expect(sellBlocker(s, "a", 9)).not.toBeNull();
    expect(sellHouse(s, "a", 6, T, names).ok).toBe(true);
  });

  it("without the full-group rule a single lot can get its first house", () => {
    const s = game();
    s.rules = { ...s.rules!, needGroup: false, buildRule: "chain" };
    own(s, "a", 6);
    expect(build(s, "a", 6, T, names).ok).toBe(true);
    expect(buildBlocker(s, "a", 6)).toMatch(/Nhà 2/);
    const strict = game();
    own(strict, "a", 6);
    expect(buildBlocker(strict, "a", 6)).toBe("Cần sở hữu cả nhóm màu mới được xây");
  });

  it("land can be sold back to the bank for 70% of its price when the rule is on", () => {
    const s = game();
    own(s, "a", 6, 8, 9);
    build(s, "a", 6, T, names);
    expect(sellLand(s, "a", 8, T, names).ok).toBe(false); // houses in the group
    sellHouse(s, "a", 6, T, names);
    const cash = s.ps.a.cash;
    expect(sellLand(s, "a", 8, T, names).ok).toBe(true);
    expect(s.deeds[8]).toBeUndefined();
    expect(s.ps.a.cash).toBe(cash + Math.floor(((BOARD[8] as { price: number }).price * 7) / 10));
    s.rules = { ...s.rules!, sellLand: false };
    expect(sellLand(s, "a", 9, T, names).ok).toBe(false);
  });

  it("mortgaged land can be sold: the bank pays the sale price minus the mortgage already taken", () => {
    const s = game();
    own(s, "a", 8);
    const price = (BOARD[8] as { price: number }).price;
    expect(mortgage(s, "a", 8, T, names).ok).toBe(true);
    const cash = s.ps.a.cash;
    expect(sellLand(s, "a", 8, T, names).ok).toBe(true);
    expect(s.deeds[8]).toBeUndefined();
    expect(s.ps.a.cash).toBe(cash + Math.floor((price * 7) / 10) - price / 2);
  });

  it("settings carry the house rules into the game and the view lists what I can do", () => {
    let n = 0;
    const room = newTPRoom("RULES");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(tpCommand(room, "token-aaaa", { type: "settings", buildRule: "chain", needGroup: false, sellLand: false, bankruptTo: "creditor" }, T).ok).toBe(true);
    expect(tpCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    expect(room.current!.rules).toMatchObject({ buildRule: "chain", needGroup: false, sellLand: false, bankruptTo: "creditor" });
    room.current!.deeds[6] = { owner: "p1", houses: 0, mortgaged: false };
    const v = tpView(room, room.seats[0], T);
    expect(v.current!.manage![6]).toEqual({ build: null, sell: "Không có nhà để bán", sellLand: "Luật bàn không cho bán đất", landPrice: 70 });
    expect(tpView(room, room.seats[1], T).current!.manage![6]).toBeUndefined();
  });
});

describe("table settings", () => {
  const withRules = (rules: Partial<TPState["rules"] & object>) => {
    const s = game();
    s.rules = { ...s.rules!, ...rules };
    return s;
  };

  it("pays the chosen salary for passing Khởi hành", () => {
    const s = withRules({ goSalary: 300 });
    s.ps.a.pos = 38;
    rollDice(s, "a", T, names, dice(1, 2)); // 38 → 1, passing GO
    expect(s.ps.a.cash).toBe(1500 + 300);
  });

  it("flat house prices when rising costs are off", () => {
    const s = withRules({ risingCost: false });
    s.deeds[1] = { owner: "a", houses: 1, mortgaged: false };
    s.deeds[3] = { owner: "a", houses: 1, mortgaged: false };
    s.phase = "end";
    expect(build(s, "a", 1, T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1500 - (BOARD[1] as { house: number }).house);
  });

  it("unmortgage fee and land sale price follow the table", () => {
    const s = withRules({ unmortgageFee: 30, landSalePct: 90 });
    s.deeds[39] = { owner: "a", houses: 0, mortgaged: false };
    expect(mortgage(s, "a", 39, T, names).ok).toBe(true); // +200
    expect(unmortgage(s, "a", 39, T, names).ok).toBe(true); // −260
    expect(s.ps.a.cash).toBe(1500 + 200 - 260);
    expect(sellLand(s, "a", 39, T, names).ok).toBe(true);
    expect(s.ps.a.cash).toBe(1500 + 200 - 260 + 360);
  });

  it("without the full-group rule, building evenly only compares the lots I own", () => {
    const s = withRules({ needGroup: false });
    s.deeds[6] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[8] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[9] = { owner: "b", houses: 0, mortgaged: false };
    s.phase = "end";
    for (let i = 0; i < 2; i++) {
      expect(build(s, "a", 6, T, names).ok).toBe(true);
      expect(build(s, "a", 8, T, names).ok).toBe(true);
    }
    expect(s.deeds[6].houses).toBe(2);
    expect(buildBlocker(s, "a", 6)).toBeNull();
    expect(build(s, "a", 6, T, names).ok).toBe(true);
    expect(buildBlocker(s, "a", 6)).toBe("Phải xây đều các ô trong nhóm");
  });

  it("selling land while in debt pays the debt once there's enough cash", () => {
    let n = 0;
    const room = newTPRoom("DEBTL");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(tpCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    const g = room.current!;
    g.turn = "p1";
    g.deeds[39] = { owner: "p1", houses: 0, mortgaged: false };
    g.ps.p1.cash = 10;
    g.phase = "debt";
    g.debt = { amount: 100, to: "p2", reason: "tiền thuê" };
    expect(tpCommand(room, "token-aaaa", { type: "sellland", pos: 39 }, T).ok).toBe(true);
    expect(g.debt).toBeNull();
    expect(g.ps.p2.cash).toBe(1500 + 100);
  });

  it("owners in jail collect no rent when jailRent is off", () => {
    const s = withRules({ jailRent: false });
    s.deeds[3] = { owner: "b", houses: 0, mortgaged: false };
    s.ps.b.jail = 1;
    rollDice(s, "a", T, names, dice(1, 2)); // → 3
    expect(s.ps.a.cash).toBe(1500);
    const on = game();
    on.deeds[3] = { owner: "b", houses: 0, mortgaged: false };
    on.ps.b.jail = 1;
    rollDice(on, "a", T, names, dice(1, 2));
    expect(on.ps.a.cash).toBeLessThan(1500);
  });

  it("no extra roll on a double when doubleRoll is off", () => {
    const s = withRules({ doubleRoll: false });
    rollDice(s, "a", T, names, dice(2, 2)); // → 4 thuế
    expect(s.rollAgain).toBe(false);
    expect(s.doubles).toBe(0);
  });

  it("room settings validate and reach the game", () => {
    let n = 0;
    const room = newTPRoom("KNOBS");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(tpCommand(room, "token-aaaa", { type: "settings", goSalary: 150 }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "settings", unmortgageFee: 15 }, T).ok).toBe(false);
    expect(
      tpCommand(room, "token-aaaa", { type: "settings", goSalary: 400, risingCost: false, unmortgageFee: 0, landSalePct: 50, jailRent: false, doubleRoll: false }, T).ok,
    ).toBe(true);
    expect(tpCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    expect(room.current!.rules).toMatchObject({ goSalary: 400, risingCost: false, unmortgageFee: 0, landSalePct: 50, jailRent: false, doubleRoll: false });
  });

  it("older saved games without the new fields get the defaults", () => {
    const s = game();
    s.rules = { buildRule: "even", needGroup: true, sellLand: true, bankruptTo: "bank" } as TPState["rules"];
    s.ps.a.pos = 38;
    rollDice(s, "a", T, names, dice(1, 2));
    expect(s.ps.a.cash).toBe(1500 + GO_SALARY);
  });
});

describe("trade", () => {
  it("swaps land and cash when accepted", () => {
    const s = game();
    s.deeds[1] = { owner: "a", houses: 0, mortgaged: false };
    s.deeds[3] = { owner: "b", houses: 0, mortgaged: false };
    expect(proposeTrade(s, "a", { to: "b", give: { props: [1], cash: 50 }, get: { props: [3], cash: 0 } }, T, names).ok).toBe(true);
    expect(answerTrade(s, "a", true, T, names).ok).toBe(false);
    expect(answerTrade(s, "b", true, T, names).ok).toBe(true);
    expect(s.deeds[1].owner).toBe("b");
    expect(s.deeds[3].owner).toBe("a");
    expect(s.ps.a.cash).toBe(1450);
    expect(s.ps.b.cash).toBe(1550);
  });

  it("trades built lots with their houses", () => {
    const s = game();
    s.deeds[1] = { owner: "a", houses: 3, mortgaged: false };
    s.deeds[3] = { owner: "a", houses: 3, mortgaged: false };
    expect(proposeTrade(s, "a", { to: "b", give: { props: [1], cash: 0 }, get: { props: [], cash: 100 } }, T, names).ok).toBe(true);
    expect(answerTrade(s, "b", true, T, names).ok).toBe(true);
    expect(s.deeds[1]).toEqual({ owner: "b", houses: 3, mortgaged: false });
    expect(s.deeds[3].owner).toBe("a");
  });

  it("rejects land you don't own and expires", () => {
    const s = game();
    s.deeds[3] = { owner: "b", houses: 0, mortgaged: false };
    expect(proposeTrade(s, "a", { to: "b", give: { props: [3], cash: 0 }, get: { props: [], cash: 0 } }, T, names).ok).toBe(false);
    proposeTrade(s, "a", { to: "b", give: { props: [], cash: 10 }, get: { props: [3], cash: 0 } }, T, names);
    tickGame(s, T + 31_000, names, never);
    expect(s.trade).toBeNull();
  });
});

describe("timers", () => {
  it("auto-plays on timeout and quickly for offline players", () => {
    const s = game();
    tickGame(s, T + STEP_MS + 1, names, never, dice(1, 2));
    expect(s.ps.a.pos).toBe(3);
    const off = game();
    const gone = (id: string) => id === "a";
    tickGame(off, T + ABSENT_MS + 1, names, gone, dice(1, 2));
    expect(off.phase).toBe("buy");
    expect(tickGame(off, T + ABSENT_MS + 2, names, gone)).toBe(false);
    tickGame(off, T + 2 * ABSENT_MS + 2, names, gone);
    tickGame(off, T + 3 * ABSENT_MS + 3, names, gone);
    // Rolled, skipped the purchase and ended the turn.
    expect(off.turn).toBe("b");
    expect(off.deeds[3]).toBeUndefined();
  });
});

describe("room", () => {
  it("runs through join, settings, start and a command", () => {
    let n = 0;
    const room = newTPRoom("ABCDE");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(tpCommand(room, "token-bbbb", { type: "settings", startCash: 2000 }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "settings", startCash: 2000, timeLimit: 0 }, T).ok).toBe(true);
    expect(tpCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(true);
    const v = tpView(room, room.seats[0], T);
    expect(v.current?.players.map((p) => p.cash)).toEqual([2000, 2000]);
    const turnToken = room.current!.turn === "p1" ? "token-aaaa" : "token-bbbb";
    expect(tpCommand(room, turnToken, { type: "roll" }, T).ok).toBe(true);
    expect(tickTP(room, T + 1)).toBe(false);
  });

  it("scores a finished game through the hub adapter", async () => {
    const store = createMemoryRoomStore();
    const hub = createRoomHub(store, typhuAdapter);
    expect(hub).toBeTruthy();
    let n = 0;
    const room = newTPRoom("QWERT");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    tpCommand(room, "token-aaaa", { type: "start" }, T);
    const g = room.current!;
    const loser = g.turn!;
    const token = loser === "p1" ? "token-aaaa" : "token-bbbb";
    g.ps[loser].cash = 0;
    g.debt = { amount: 200, to: null, reason: "thuế" };
    g.phase = "debt";
    g.turn = loser;
    expect(tpCommand(room, token, { type: "bankrupt" }, T).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(room.history?.[0].results.map((r) => r.delta)).toEqual([2, -2]);
    expect(typhuAdapter.lastRecord(room)?.id).toMatch(/^QWERT-1-[0-9]+$/);
  });
});

describe("settings", () => {
  it("double salary on landing exactly on Khởi hành", () => {
    const s = newTPGame(["a", "b"], T, { startCash: 1500, timeLimitMin: 0, doubleGo: true }, () => 0);
    s.turn = "a";
    s.ps.a.pos = 36;
    rollDice(s, "a", T, names, dice(1, 3)); // → 0
    expect(s.ps.a.cash).toBe(1500 + GO_SALARY * 2);
  });

  it("taxes feed the Nghỉ chân pot, collected by whoever lands there", () => {
    const s = newTPGame(["a", "b"], T, { startCash: 1500, timeLimitMin: 0, parkingPot: true }, () => 0);
    s.turn = "a";
    s.ps.a.pos = 1;
    rollDice(s, "a", T, names, dice(1, 2)); // → 4 thuế 200
    expect(s.pot).toBe(200);
    endTurn(s, "a", T, names);
    s.ps.b.pos = 15;
    rollDice(s, "b", T, names, dice(2, 3)); // → 20 Nghỉ chân
    expect(s.ps.b.cash).toBe(1700);
    expect(s.pot).toBe(0);
  });

  it("host settings validate and apply to the next game", () => {
    let n = 0;
    const room = newTPRoom("SETTP");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    expect(tpCommand(room, "token-aaaa", { type: "settings", stepSeconds: 7 }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "settings", first: 2, second: 3 }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "settings", stepSeconds: 45, doubleGo: true, parkingPot: true, first: 6, second: 2 }, T).ok).toBe(true);
    tpCommand(room, "token-aaaa", { type: "start" }, T);
    expect(room.current?.deadline).toBe(T + 45_000);
    expect(room.current?.doubleGo).toBe(true);
    expect(room.current?.pot).toBe(0);
    expect(tpView(room, room.seats[0], T).settings.first).toBe(6);
  });
});

describe("token picking", () => {
  it("lets a player pick an emoji and colour nobody else holds", () => {
    let n = 0;
    const room = newTPRoom("PICK");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    const seatPiece = (token: string) => tpView(room, room.seats[token === "token-aaaa" ? 0 : 1], T).seats.find((s) => s?.id === (token === "token-aaaa" ? "p1" : "p2"))!.piece;
    expect(seatPiece("token-aaaa")).toEqual({ emoji: "🛵", color: "#ef4444" });
    expect(seatPiece("token-bbbb")).toEqual({ emoji: "🐃", color: "#3b82f6" });
    // Bình's starting emoji / colour are taken for An.
    expect(tpCommand(room, "token-aaaa", { type: "pick", emoji: "🐃", color: "#06b6d4" }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "pick", emoji: "🚗", color: "#3b82f6" }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "pick", emoji: "💩", color: "#06b6d4" }, T).ok).toBe(false);
    expect(tpCommand(room, "token-aaaa", { type: "pick", emoji: "🚗", color: "#06b6d4" }, T).ok).toBe(true);
    expect(seatPiece("token-aaaa")).toEqual({ emoji: "🚗", color: "#06b6d4" });
    // An's old starting piece is free again; a third player never gets a duplicate.
    expect(tpCommand(room, "token-bbbb", { type: "pick", emoji: "🛵", color: "#ef4444" }, T).ok).toBe(true);
    joinTP(room, "token-cccc", "Cường", T, () => `p${++n}`);
    const c = tpView(room, room.seats[2], T).seats.find((s) => s?.id === "p3")!.piece;
    expect([c.emoji, c.color]).not.toContain("🚗");
    expect(c.emoji === "🛵" || c.color === "#ef4444" || c.color === "#06b6d4" || c.emoji === "🚗").toBe(false);
  });
});

describe("unique pieces", () => {
  it("re-rolls a colliding piece at random and keeps everyone different", () => {
    let n = 0;
    const room = newTPRoom("UNIQ");
    joinTP(room, "token-aaaa", "An", T, () => `p${++n}`);
    joinTP(room, "token-bbbb", "Bình", T, () => `p${++n}`);
    // Simulate an old/raced state: both hold the same piece.
    room.seats[0]!.piece = { emoji: "🚗", color: "#06b6d4" };
    room.seats[1]!.piece = { emoji: "🚗", color: "#06b6d4" };
    joinTP(room, "token-cccc", "Cường", T, () => `p${++n}`);
    const ps = tpView(room, room.seats[2], T).seats.flatMap((s) => (s ? [s.piece] : []));
    expect(new Set(ps.map((p) => p.emoji)).size).toBe(3);
    expect(new Set(ps.map((p) => p.color)).size).toBe(3);
  });
});

describe("building without the full group", () => {
  it("stops at 3 houses until the whole colour group is owned", () => {
    const s = game();
    s.rules = { ...s.rules!, needGroup: false };
    s.ps.a.cash = 100000;
    for (const p of [16, 18]) s.deeds[p] = { owner: "a", houses: 0, mortgaged: false }; // orange has 3 lots; 19 is not mine
    for (let i = 0; i < 3; i++) {
      expect(build(s, "a", 16, T, names).ok).toBe(true);
      expect(build(s, "a", 18, T, names).ok).toBe(true);
    }
    expect(buildBlocker(s, "a", 16)).toContain("tối đa 3 nhà");
    expect(build(s, "a", 16, T, names).ok).toBe(false);
    s.deeds[19] = { owner: "a", houses: 0, mortgaged: false };
    for (const p of [19, 19, 19]) build(s, "a", p, T, names);
    expect(buildBlocker(s, "a", 16)).toBeNull();
  });
});

describe("maps and cards", () => {
  const sizes = { std: 40, large: 48, huge: 56 } as const;

  it("bigger maps keep the corners and stay consistent", () => {
    for (const [map, n] of Object.entries(sizes) as ["std" | "large" | "huge", number][]) {
      const b = boardOf(map);
      expect(b).toHaveLength(n);
      const side = n / 4;
      expect([b[0].kind, b[side].kind, b[2 * side].kind, b[3 * side].kind]).toEqual(["go", "jail", "parking", "gotojail"]);
      expect(jailPos(b)).toBe(side);
      const names = b.filter((q) => q.kind === "prop" || q.kind === "air" || q.kind === "util").map((q) => q.name);
      expect(new Set(names).size).toBe(names.length);
      // standard squares keep their relative order
      const stdNames = boardOf("std").map((q) => q.name);
      expect(b.map((q) => q.name).filter((x) => stdNames.includes(x) && !["Khí vận", "Cơ hội"].includes(x))).toEqual(
        stdNames.filter((x) => !["Khí vận", "Cơ hội"].includes(x)),
      );
    }
    expect(groupPositions("brown", boardOf("large"))).toHaveLength(3);
  });

  it("plays whole games to the end on every map, drawing every kind of card", () => {
    for (const map of ["std", "large", "huge"] as const) {
      let seed = 7;
      const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const s = newTPGame(["a", "b", "c"], T, { startCash: 1500, timeLimitMin: 5, map, rules: { needGroup: false, buildRule: "chain" } }, random);
      let now = T;
      for (let i = 0; i < 6000 && s.status === "playing"; i++) {
        now += 31_000;
        tickGame(s, now, names, never, random);
      }
      expect(s.status).toBe("ended");
      expect(s.log.length).toBeLessThanOrEqual(LOG_LIMIT);
      for (const id of s.players) expect(s.ps[id].pos).toBeLessThan(boardOf(map).length);
    }
  });

  it("every card effect works", () => {
    const kinds = new Set([...CHANCE, ...CHEST].map((c) => c.effect.kind));
    for (const k of ["forward", "rollagain", "perprop", "nearestfree", "poorest", "richest"]) expect(kinds.has(k as never)).toBe(true);
    expect(CHANCE.length).toBeGreaterThanOrEqual(30);
    expect(CHEST.length).toBeGreaterThanOrEqual(30);
    for (const map of ["std", "large", "huge"] as const) {
      const board = boardOf(map);
      for (const deck of ["chance", "chest"] as const) {
        const cards = deck === "chance" ? CHANCE : CHEST;
        const at = board.findIndex((q) => q.kind === deck);
        for (let ci = 0; ci < cards.length; ci++) {
          const s = newTPGame(["a", "b", "c"], T, { startCash: 1500, timeLimitMin: 0, map }, () => 0);
          s.deeds[1] = { owner: "a", houses: 0, mortgaged: false };
          s.ps.b.cash = 100;
          s.ps.c.cash = 3000;
          s.turn = "a";
          s.phase = "roll";
          s[deck] = [ci];
          s.ps.a.pos = (at - 3 + board.length) % board.length;
          expect(rollDice(s, "a", T, names, dice(1, 2)).ok).toBe(true);
          expect(Number.isFinite(s.ps.a.cash)).toBe(true);
          expect(s.ps.a.pos).toBeLessThan(board.length);
        }
      }
    }
  });
});
