import { describe, expect, it } from "vitest";
import { BOARD, CHANCE, CHEST, GO_SALARY, JAIL_POS } from "../src/typhu/board";
import {
  ABSENT_MS,
  STEP_MS,
  type TPState,
  answerTrade,
  build,
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
  sellHouse,
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
  it("has 40 squares with 22 cities, 4 airports, 2 utilities and 16-card decks", () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD.filter((b) => b.kind === "prop")).toHaveLength(22);
    expect(BOARD.filter((b) => b.kind === "air")).toHaveLength(4);
    expect(BOARD.filter((b) => b.kind === "util")).toHaveLength(2);
    expect(BOARD[JAIL_POS].kind).toBe("jail");
    expect(BOARD[30].kind).toBe("gotojail");
    expect(CHANCE).toHaveLength(16);
    expect(CHEST).toHaveLength(16);
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
    rollDice(s, "a", T, names, dice(1, 1)); // → 8 Châu Đốc
    skipBuy(s, "a", T, names);
    rollDice(s, "a", T, names, dice(2, 2));
    expect(s.ps.a.pos).toBe(JAIL_POS);
    expect(s.ps.a.jail).toBe(1);
    expect(s.phase).toBe("end");
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
    s.deeds[39] = { owner: "b", houses: 5, mortgaged: false };
    s.deeds[37] = { owner: "b", houses: 5, mortgaged: false };
    s.deeds[1] = { owner: "a", houses: 0, mortgaged: false };
    s.ps.a.cash = 100;
    s.ps.a.pos = 33;
    rollDice(s, "a", T, names, dice(2, 4)); // → 39 with a hotel: 2000
    expect(s.phase).toBe("debt");
    expect(payDebt(s, "a", T, names).ok).toBe(false);
    expect(declareBankrupt(s, "a", T, names).ok).toBe(true);
    expect(s.ps.a.bankrupt).toBe(true);
    expect(s.deeds[1].owner).toBe("b");
    expect(s.ps.b.cash).toBe(1600);
    expect(s.turn).toBe("b");
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
    expect(typhuAdapter.lastRecord(room)?.id).toBe("QWERT-1");
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
