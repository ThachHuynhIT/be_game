import { describe, expect, it } from "vitest";
import { MAX_WORDS, normalizeWord, syllablesOf } from "../src/noichu/board";
import { type NCState, forfeitPlayer, needOf, newNCGame, nextGameTickAt, playWord, tickGame } from "../src/noichu/game";
import { joinNC, ncCommand, ncSettingsOf, ncSummary, ncView, newNCRoom, nextNCTickAt, tickNC } from "../src/noichu/room";
import { hasWord, wordsStartingWith } from "../src/noichu/words";

const names = (id: string) => id;
const T = 1_000_000;

/** A fresh game with "a" to move (the opening word is deterministic: random() = 0). */
function game(opts: { turnMs?: number; dictionary?: boolean } = {}, ids = ["a", "b"]): NCState {
  const s = newNCGame(ids, T, opts, () => 0);
  s.players = ids.slice();
  s.turn = ids[0];
  return s;
}

/** A dictionary word that continues the chain and was not used yet. */
function nextWord(s: NCState, skip = 0): string {
  const used = new Set(s.chain.map((w) => w.word));
  return wordsStartingWith(needOf(s)!).filter((w) => !used.has(w))[skip];
}

describe("words", () => {
  it("normalises to NFC, lower case and single spaces; exactly two syllables of letters", () => {
    expect(normalizeWord("  HỌC   Sinh ")).toBe("học sinh");
    expect(normalizeWord("học sinh".normalize("NFD"))).toBe("học sinh"); // decomposed accents
    expect(normalizeWord("một")).toBeNull();
    expect(normalizeWord("một hai ba")).toBeNull();
    expect(normalizeWord("mot-hai")).toBeNull();
    expect(normalizeWord("mot 2")).toBeNull();
    expect(normalizeWord("abcdefghi xe")).toBeNull(); // a syllable longer than 8 letters
    expect(normalizeWord(42)).toBeNull();
    expect(normalizeWord("a ".repeat(30))).toBeNull();
  });

  it("the dictionary only holds normalised two-syllable words", () => {
    expect(hasWord("học sinh")).toBe(true);
    expect(hasWord("Học Sinh")).toBe(false);
    expect(hasWord("học")).toBe(false);
    expect(wordsStartingWith("học").length).toBeGreaterThan(5);
    for (const w of wordsStartingWith("bàn")) expect(normalizeWord(w)).toBe(w);
  });
});

describe("setup", () => {
  it("opens with a dictionary word and the first player on the clock", () => {
    const s = newNCGame(["a", "b", "c"], T, { turnMs: 15_000 }, () => 0);
    expect(s.players.slice().sort()).toEqual(["a", "b", "c"]);
    expect(s.turn).toBe(s.players[0]);
    expect(s.deadline).toBe(T + 15_000);
    expect(s.chain).toHaveLength(1);
    expect(s.chain[0].by).toBeNull();
    expect(hasWord(s.chain[0].word)).toBe(true);
    expect(wordsStartingWith(needOf(s)!).length).toBeGreaterThanOrEqual(8); // never a dead end
    expect(s.status).toBe("playing");
  });

  it("needs 2–8 players", () => {
    expect(() => newNCGame(["a"], T)).toThrow();
    expect(() => newNCGame(Array.from({ length: 9 }, (_, i) => `p${i}`), T)).toThrow();
  });
});

describe("playing a word", () => {
  it("accepts a continuation, moves the turn and restarts the clock", () => {
    const s = game({ turnMs: 20_000 });
    const w = nextWord(s);
    expect(playWord(s, "a", w, T + 5_000, names)).toEqual({ ok: true });
    expect(s.chain.map((x) => x.word)).toEqual([s.chain[0].word, w]);
    expect(s.chain[1].by).toBe("a");
    expect(s.counts).toEqual({ a: 1, b: 0 });
    expect(s.turn).toBe("b");
    expect(s.deadline).toBe(T + 5_000 + 20_000);
    expect(needOf(s)).toBe(syllablesOf(w)[1]);
  });

  it("accepts the word however it is typed", () => {
    const s = game();
    const w = nextWord(s);
    expect(playWord(s, "a", `  ${w.toUpperCase().replace(" ", "   ")} `, T, names).ok).toBe(true);
    expect(s.chain[1].word).toBe(w);
  });

  it("refuses without changing anything: wrong turn, format, start, repeat, unknown word", () => {
    const s = game();
    const before = JSON.stringify(s);
    const ok = nextWord(s);
    const cases: [string, string, unknown][] = [
      ["Chưa đến lượt bạn", "b", ok],
      ["Từ phải gồm đúng 2 tiếng, chỉ có chữ cái", "a", "một"],
      ["Từ phải gồm đúng 2 tiếng, chỉ có chữ cái", "a", "một hai ba"],
      ["Từ phải gồm đúng 2 tiếng, chỉ có chữ cái", "a", null],
      [`Từ phải bắt đầu bằng "${needOf(s)}"`, "a", "xe xe"],
      ["Từ này không có trong từ điển", "a", `${needOf(s)} qqqqq`],
    ];
    for (const [error, id, text] of cases) {
      expect(playWord(s, id, text, T, names), String(text)).toEqual({ ok: false, error });
      expect(JSON.stringify(s)).toBe(before);
    }
    playWord(s, "a", ok, T, names);
    const afterOk = JSON.stringify(s);
    // Walk back to the same word: now it is "already used".
    s.chain.push({ by: "b", word: `${syllablesOf(ok)[1]} ${syllablesOf(ok)[0]}`, at: T });
    s.turn = "a";
    expect(playWord(s, "a", s.chain[s.chain.length - 1].word, T, names).ok).toBe(false);
    expect(afterOk).not.toBe(before);
  });

  it("tone marks matter: 'mèo' is not 'meo'", () => {
    const s = game();
    s.chain = [{ by: null, word: "con mèo", at: T }];
    expect(needOf(s)).toBe("mèo");
    expect(playWord(s, "a", "meo nổ", T, names)).toEqual({ ok: false, error: 'Từ phải bắt đầu bằng "mèo"' });
    const real = wordsStartingWith("mèo")[0];
    expect(playWord(s, "a", real, T, names).ok).toBe(true);
  });

  it("a word cannot be used twice in one game", () => {
    const s = game();
    const w1 = nextWord(s);
    playWord(s, "a", w1, T, names);
    // b answers with a word that ends in the syllable that starts w1, then a would need w1 again.
    const back = wordsStartingWith(needOf(s)!).find((w) => syllablesOf(w)[1] === syllablesOf(w1)[0] && w !== w1);
    if (back) {
      expect(playWord(s, "b", back, T, names).ok).toBe(true);
      expect(playWord(s, "a", w1, T, names)).toEqual({ ok: false, error: "Từ này đã được dùng" });
    }
  });

  it("with the dictionary off any two syllables count, but the chain rule still applies", () => {
    const s = game({ dictionary: false });
    const need = needOf(s)!;
    expect(playWord(s, "a", `${need} qqqqq`, T, names).ok).toBe(true);
    expect(playWord(s, "b", "xyz abc", T, names).ok).toBe(false);
    expect(playWord(s, "b", "qqqqq zzz", T, names).ok).toBe(true);
  });

  it("a game from before the dictionary setting existed still checks words", () => {
    const s = game();
    delete s.dictionary;
    expect(playWord(s, "a", `${needOf(s)} qqqqq`, T, names).ok).toBe(false);
  });
});

describe("running out of time", () => {
  it("does nothing before the deadline, then the player on the clock is out", () => {
    const s = game({ turnMs: 10_000 }, ["a", "b", "c"]);
    expect(tickGame(s, T + 9_999, names)).toBe(false);
    expect(nextGameTickAt(s)).toBe(T + 10_000);
    expect(tickGame(s, T + 10_000, names)).toBe(true);
    expect(s.out).toEqual(["a"]);
    expect(s.turn).toBe("b");
    expect(s.deadline).toBe(T + 20_000);
    expect(s.status).toBe("playing");
  });

  it("the last one standing wins; the one who lasted longest is second", () => {
    const s = game({ turnMs: 10_000 }, ["a", "b", "c"]);
    playWord(s, "a", nextWord(s), T + 1_000, names); // b on the clock
    tickGame(s, s.deadline!, names); // b out
    expect(s.out).toEqual(["b"]);
    expect(s.turn).toBe("c");
    tickGame(s, s.deadline!, names); // c out → a wins
    expect(s.status).toBe("ended");
    expect(s.winner).toBe("a");
    expect(s.finished).toEqual(["a", "c", "b"]);
    expect(s.ranks).toEqual({ a: 0, c: 1, b: 2 });
    expect(s.endReason).toBe("last");
    expect(s.turn).toBeNull();
    expect(nextGameTickAt(s)).toBeNull();
    expect(tickGame(s, s.deadline ?? T + 99_999_999, names)).toBe(false);
  });

  it("an ended game takes no more words", () => {
    const s = game({ turnMs: 10_000 });
    tickGame(s, T + 10_000, names);
    expect(s.status).toBe("ended");
    expect(playWord(s, "b", "x y", T, names)).toEqual({ ok: false, error: "Ván đã kết thúc" });
  });
});

describe("leaving", () => {
  it("a kicked player is out; the clock moves on if it was their turn", () => {
    const s = game({}, ["a", "b", "c"]);
    expect(forfeitPlayer(s, "a", T + 100, names).ok).toBe(true);
    expect(s.out).toEqual(["a"]);
    expect(s.turn).toBe("b");
    expect(forfeitPlayer(s, "a", T + 100, names).ok).toBe(false);
    expect(forfeitPlayer(s, "zzz", T + 100, names).ok).toBe(false);
  });

  it("the other player wins when one of two leaves", () => {
    const s = game();
    forfeitPlayer(s, "b", T + 100, names);
    expect(s.status).toBe("ended");
    expect(s.winner).toBe("a");
    expect(s.endReason).toBe("forfeit");
  });
});

describe("word limit", () => {
  it("ends the game; the most words wins, equal counts share first place", () => {
    const s = game();
    while (s.chain.length < MAX_WORDS - 1) s.chain.push({ by: "a", word: `x${s.chain.length} y`, at: T });
    s.chain.push({ by: "b", word: "học sinh", at: T });
    s.counts = { a: 5, b: 5 };
    const w = nextWord(s);
    expect(playWord(s, "a", w, T, names).ok).toBe(true);
    expect(s.status).toBe("ended");
    expect(s.endReason).toBe("limit");
    expect(s.winner).toBe("a"); // 6 words vs 5
    expect(s.ranks).toEqual({ a: 0, b: 1 });

    const t = game();
    while (t.chain.length < MAX_WORDS - 1) t.chain.push({ by: "a", word: `x${t.chain.length} y`, at: T });
    t.chain.push({ by: "b", word: "học sinh", at: T });
    t.counts = { a: 4, b: 5 };
    playWord(t, "a", nextWord(t), T, names);
    expect(t.winner).toBeNull(); // 5 – 5
    expect(t.ranks).toEqual({ a: 0, b: 0 });
  });
});

describe("room", () => {
  function room2() {
    let n = 0;
    const room = newNCRoom("NC001");
    joinNC(room, "token-aaaa", "An", T, () => `p${++n}`, "token-aaaa");
    joinNC(room, "token-bbbb", "Bình", T, () => `p${++n}`, "token-bbbb");
    return room;
  }
  const tokenOf = (room: ReturnType<typeof room2>, id: string) => room.seats.find((p) => p?.id === id)!.token;

  it("host settings, start, words, view, scoring", () => {
    const room = room2();
    expect(ncCommand(room, "token-bbbb", { type: "settings", dictionary: false }, T).ok).toBe(false); // not host
    expect(ncCommand(room, "token-aaaa", { type: "settings", turnSeconds: 99 }, T).ok).toBe(false);
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: "yes" as never }, T).ok).toBe(false);
    expect(ncCommand(room, "token-aaaa", { type: "settings", turnSeconds: 15, dictionary: true, first: 3, second: 1 }, T).ok).toBe(true);
    expect(ncCommand(room, "token-bbbb", { type: "start" }, T).ok).toBe(false); // not host
    expect(ncCommand(room, "token-aaaa", { type: "start" }, T, () => 0).ok).toBe(true);
    const g = room.current!;
    expect(g.deadline).toBe(T + 15_000);
    expect(g.dictionary).toBe(true);
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: false }, T).ok).toBe(false); // mid-game
    expect(ncCommand(room, "token-aaaa", { type: "start" }, T).ok).toBe(false);

    const mover = g.turn!;
    const other = g.players.find((p) => p !== mover)!;
    expect(ncCommand(room, tokenOf(room, other), { type: "word", text: nextWord(g) }, T).ok).toBe(false);
    expect(ncCommand(room, tokenOf(room, mover), { type: "word", text: nextWord(g) }, T + 1).ok).toBe(true);

    const view = ncView(room, room.seats[0], T + 1);
    expect(view.game).toBe("noichu");
    expect(view.current!.chainLength).toBe(2);
    expect(view.current!.need).toBe(needOf(g));
    expect(view.current!.players.map((p) => p.seat)).toEqual([0, 1]);
    expect(JSON.stringify(view)).not.toContain("token-");
    expect(ncSummary(room, T).status).toBe("playing");

    // The player on the clock times out: the other wins and the points follow the settings (3 / −3).
    expect(tickNC(room, g.deadline! - 1)).toBe(false);
    expect(tickNC(room, g.deadline!)).toBe(true);
    expect(g.status).toBe("ended");
    expect(g.winner).toBe(mover);
    expect(room.history?.[0].results.map((r) => [r.id, r.delta])).toEqual([
      [mover, 3],
      [other, -3],
    ]);
    const winner = room.seats.find((p) => p?.id === mover)!;
    expect(winner.wins).toBe(1);
    expect(winner.points).toBe(3);
    expect(ncSummary(room, T).status).toBe("waiting");
    // …and a new game can start.
    expect(ncCommand(room, "token-aaaa", { type: "start" }, g.deadline! + 1).ok).toBe(true);
  });

  it("needs two players", () => {
    const room = newNCRoom("NC002");
    joinNC(room, "token-aaaa", "An", T, () => "p1", "token-aaaa");
    expect(ncCommand(room, "token-aaaa", { type: "start" }, T)).toEqual({ ok: false, error: "Cần đủ 2 người" });
  });

  it("holds up to 8 players", () => {
    const room = newNCRoom("NC003");
    for (let i = 0; i < 8; i++) expect(joinNC(room, `token-${i}xxxx`, `P${i}`, T, () => `p${i}`, `token-${i}xxxx`).ok).toBe(true);
    expect(joinNC(room, "token-9xxxxx", "P9", T, () => "p9", "token-9xxxxx")).toEqual({ ok: false, error: "Phòng đã đủ 8 người" });
    expect(ncCommand(room, "token-unknown", { type: "start" }, T)).toEqual({ ok: false, error: "Bạn không còn trong phòng" });
    expect(ncCommand(room, "token-0xxxx", { type: "start" }, T, () => 0).ok).toBe(true); // all 8 can play
    expect(room.current!.players).toHaveLength(8);
  });

  it("wakes the hub at the deadline and reads old rooms with defaults", () => {
    const room = room2();
    ncCommand(room, "token-aaaa", { type: "start" }, T, () => 0);
    expect(nextNCTickAt(room, T)).toBeLessThanOrEqual(room.current!.deadline!);
    expect(ncSettingsOf({ ...room, settings: undefined })).toMatchObject({ turnSeconds: 20, dictionary: true, first: 2, second: 1 });
  });

  it("kicking an offline player in a game puts them out", () => {
    const room = room2();
    ncCommand(room, "token-aaaa", { type: "start" }, T, () => 0);
    const g = room.current!;
    const later = T + 120_000; // past the presence timeout for both; only the host keeps pinging
    room.seats[0]!.lastSeen = later;
    const target = room.seats[1]!;
    expect(ncCommand(room, "token-aaaa", { type: "kick", playerId: target.id }, later).ok).toBe(true);
    expect(g.status).toBe("ended");
    expect(g.winner).toBe(room.seats[0]!.id);
    expect(target.kicked).toBe(true);
  });
});
