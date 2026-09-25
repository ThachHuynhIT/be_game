import { describe, expect, it } from "vitest";
import { parseCards as c } from "../src/game/cards";
import { autoAction, newGame, pass, play } from "../src/game/game";

// Hands that do not trigger tới trắng. A holds 3♠.
const HANDS = {
  A: c("3s 4c 4d 5d 6h 8s 9c 10d Jh Qs Kc Ad 2h"),
  B: c("3c 4s 5h 6s 7s 8c 9d 10h Js Qc Kd 2s 2d"),
  C: c("3d 4h 5s 6c 7d 8d 8h 10s Jc Qd Kh As Ah"),
  D: c("3h 5c 6d 7h 7c 9s 9h 10c Jd Qh Ks Ac"),
};
const fresh = () =>
  newGame(["A", "B", "C", "D"], {
    hands: Object.fromEntries(Object.entries(HANDS).map(([k, v]) => [k, v.slice()])),
  });

describe("game flow", () => {
  it("first game: holder of 3♠ leads and must include it", () => {
    const g = fresh();
    expect(g.turn).toBe("A");
    expect(play(g, "A", c("4c"))).toEqual({ ok: false, error: expect.stringContaining("3♠") });
    expect(play(g, "A", c("3s")).ok).toBe(true);
    expect(g.turn).toBe("B");
    expect(g.mustInclude).toBeNull();
  });

  it("with fewer players the lowest dealt card leads", () => {
    const g = newGame(["B", "C"], { hands: { B: HANDS.B.slice(), C: HANDS.C.slice() } });
    expect(g.turn).toBe("B"); // 3♣ < 3♦
    expect(g.mustInclude).toBe(c("3c")[0]);
  });

  it("rejects out-of-turn moves, weaker cards and passing while leading", () => {
    const g = fresh();
    expect(play(g, "B", c("3c")).ok).toBe(false);
    expect(pass(g, "A").ok).toBe(false);
    play(g, "A", c("3s"));
    expect(play(g, "B", c("3c")).ok).toBe(true); // 3♣ > 3♠
    expect(play(g, "C", c("3s")).ok).toBe(false); // not in hand
  });

  it("passed players are locked out until the round ends; leader then opens a new round", () => {
    const g = fresh();
    play(g, "A", c("3s"));
    pass(g, "B");
    play(g, "C", c("3d"));
    pass(g, "D");
    // A has not passed and may still play; B is skipped.
    expect(g.turn).toBe("A");
    play(g, "A", c("4c"));
    expect(g.turn).toBe("C"); // B skipped (passed)
    pass(g, "C");
    // D passed earlier, B passed → everyone else passed, A opens a fresh round.
    expect(g.turn).toBe("A");
    expect(g.lastPlay).toBeNull();
    expect(g.passed).toEqual([]);
  });

  it("bomb (chặt heo) with 3 đôi thông", () => {
    const g = newGame(["A", "B"], {
      hands: {
        A: c("3s 2h 9d"),
        B: c("4s 4h 5s 5h 6c 6d Kd"),
      },
    });
    play(g, "A", c("3s"));
    pass(g, "B");
    play(g, "A", c("2h"));
    expect(play(g, "B", c("4s 4h 5s 5h 6c 6d")).ok).toBe(true);
    expect(g.chops).toEqual([{ from: "A", to: "B", points: 2 }]);
  });

  it("keeps the chop on the table while someone can still answer it", () => {
    const g = newGame(["A", "B", "C"], {
      hands: { A: c("3s 2s 9d"), B: c("4s 4h 5s 5h 6c 6d Kd"), C: c("7s 7c 7d 7h Qd") },
    });
    play(g, "A", c("3s"));
    pass(g, "B");
    pass(g, "C");
    play(g, "A", c("2s"));
    play(g, "B", c("4s 4h 5s 5h 6c 6d"));
    expect(g.lastPlay?.chop).toBe(true);
    expect(g.lastPlay?.chopPoints).toBe(1);
    expect(g.lastPlay?.choppedPlayer).toBe("A");
    // C holds tứ quý and may chặt chồng; A has nothing and was passed automatically.
    expect(g.turn).toBe("C");
    play(g, "C", c("7s 7c 7d 7h"));
    expect(g.chops).toEqual([
      { from: "A", to: "B", points: 1 },
      { from: "B", to: "C", points: 2 },
    ]);
  });

  it("burns a player holding 13 cards when someone goes out", () => {
    const g = newGame(["A", "B", "C"], {
      hands: {
        A: c("3s 5s"),
        B: c("4c 4d 5d 6h 8s 9c 10d Jh Qs Kc Ad 2c 7d"),
        C: c("4s 6s 7s 8c 9d 10c Js Qc Kd As 2d Kh 9h"),
      },
      starter: "A",
    });
    play(g, "A", c("3s"));
    pass(g, "B");
    play(g, "C", c("4s"));
    // A: 5♠ beats 4♠; B has not played a single card yet.
    play(g, "A", c("5s"));
    expect(g.burned).toEqual(["B"]);
    // Only C is left playing → game over, burned B last.
    expect(g.status).toBe("ended");
    expect(g.finished).toEqual(["A", "C", "B"]);
  });

  it("chặt chồng doubles every time", () => {
    const g = newGame(["A", "B", "C", "D"], {
      hands: {
        A: c("3s 2h 9d"),
        B: c("4s 4h 5s 5h 6c 6d Kd"),
        C: c("7s 7c 7d 7h Qd"),
        D: c("8s 8c 9s 9c 10s 10c Js Jc Ad"),
      },
      starter: "A",
    });
    play(g, "A", c("2h")); // heo đỏ
    play(g, "B", c("4s 4h 5s 5h 6c 6d")); // chặt: 2
    play(g, "C", c("7s 7c 7d 7h")); // chặt chồng: 4
    play(g, "D", c("8s 8c 9s 9c 10s 10c Js Jc")); // chặt chồng: 8
    expect(g.chops?.map((x) => [x.from, x.to, x.points])).toEqual([
      ["A", "B", 2],
      ["B", "C", 4],
      ["C", "D", 8],
    ]);
  });

  it("passes automatically for a player with nothing that beats the table", () => {
    const g = newGame(["A", "B", "C"], {
      hands: { A: c("3s 9d Kh"), B: c("4s 5d"), C: c("8s Ac") },
      starter: "A",
    });
    play(g, "A", c("Kh"));
    // B's best single is 5♦ → passed; C can beat with A♣.
    expect(g.turn).toBe("C");
    expect(g.passed).toEqual(["B"]);
    expect(g.autoPassed).toEqual(["B"]);
  });

  it("game ends when one player is left; ranks follow finishing order", () => {
    const g = newGame(["A", "B", "C"], {
      hands: { A: c("3s"), B: c("4s 9h"), C: c("5s 6s") },
    });
    play(g, "A", c("3s")); // A finishes
    expect(g.finished).toEqual(["A"]);
    expect(g.turn).toBe("B");
    play(g, "B", c("4s"));
    play(g, "C", c("5s"));
    pass(g, "B");
    // C leads the new round and plays out.
    expect(g.turn).toBe("C");
    play(g, "C", c("6s"));
    expect(g.status).toBe("ended");
    expect(g.finished).toEqual(["A", "C", "B"]);
  });

  it("when the round winner already finished, the next player leads", () => {
    const g = newGame(["A", "B", "C"], {
      hands: { A: c("2h"), B: c("3s 4s"), C: c("5s 6s") },
    });
    play(g, "B", c("3s")); // B holds lowest card
    play(g, "C", c("5s"));
    play(g, "A", c("2h")); // A goes out with the 2
    pass(g, "B");
    pass(g, "C");
    expect(g.lastPlay).toBeNull();
    expect(g.turn).toBe("B"); // seat after A
  });

  it("autoAction passes when possible, otherwise leads the lowest card", () => {
    const g = fresh();
    autoAction(g, "A");
    expect(g.lastPlay?.combo.cards).toEqual(c("3s"));
    autoAction(g, "B");
    expect(g.passed).toEqual(["B"]);
  });

  it("tới trắng ends the game immediately", () => {
    const g = newGame(["A", "B"], {
      hands: { A: c("2s 2c 2d 2h 3s 5h 7d 9c Js Kh 4d 6c 8h"), B: HANDS.B.slice() },
    });
    expect(g.status).toBe("ended");
    expect(g.instantWin).toEqual({ playerId: "A", reason: "fourTwos" });
    expect(g.finished[0]).toBe("A");
  });

  it("random deal gives 13 unique cards each", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = newGame(["A", "B", "C", "D"], { random });
    const all = Object.values(g.hands).flat();
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
  });
});
