import { describe, expect, it } from "vitest";
import { type DictionaryMode, MAX_SYLLABLE_LENGTH, MAX_WORDS, dictionaryModeOf, normalizeWord, syllablesOf } from "../src/noichu/board";
import { type NCState, forfeitPlayer, needOf, newNCGame, nextGameTickAt, playWord, tickGame } from "../src/noichu/game";
import { joinNC, ncCommand, ncSettingsOf, ncSummary, ncView, newNCRoom, nextNCTickAt, tickNC } from "../src/noichu/room";
import { EXTRA_WORDS, LOAN_SYLLABLES } from "../src/noichu/extra";
import { hasWord, isSyllable, wordsStartingWith } from "../src/noichu/words";

const names = (id: string) => id;
const T = 1_000_000;

/** A fresh game with "a" to move (the opening word is deterministic: random() = 0). */
function game(opts: { turnMs?: number; dictionary?: DictionaryMode | boolean } = {}, ids = ["a", "b"]): NCState {
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
    expect(normalizeWord("abcdefghijk xe")).toBeNull(); // a syllable longer than 10 letters
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

describe("extra words", () => {
  it("every extra word is a normalised two-syllable word", () => {
    expect(EXTRA_WORDS.length).toBeGreaterThan(1000); // a floor that catches a broken expansion
    for (const w of EXTRA_WORDS) expect(normalizeWord(w), w).toBe(w);
    expect(new Set(EXTRA_WORDS).size).toBe(EXTRA_WORDS.length);
  });

  it("fills the gaps the Viet74K headword list leaves", () => {
    for (const w of ["con mèo", "con chó", "cái ghế", "quả cam", "trái tim", "cây cầu", "hoa hồng", "việt nam", "đà nẵng", "trà sữa", "phở bò", "ăn cơm", "chú bác"]) {
      expect(hasWord(w), w).toBe(true);
    }
    expect(hasWord("con bàn")).toBe(false); // classifiers only go with nouns they suit
    expect(hasWord("chí thì")).toBe(false); // no sentence fragments
  });

  it("a chain can now run through them: con mèo → mèo …", () => {
    const s = game();
    s.chain = [{ by: null, word: "con mèo", at: T }];
    expect(wordsStartingWith("mèo").length).toBeGreaterThan(0);
    expect(playWord(s, "a", wordsStartingWith("mèo")[0], T, names).ok).toBe(true);
  });
});

describe("loan words", () => {
  it("loan tokens are plain lower-case letters that normalizeWord accepts", () => {
    expect(LOAN_SYLLABLES.length).toBeGreaterThan(150);
    for (const w of LOAN_SYLLABLES) {
      expect(w, w).toMatch(/^\p{L}+$/u);
      expect(w, w).toBe(w.toLowerCase());
      expect(w.length, w).toBeLessThanOrEqual(MAX_SYLLABLE_LENGTH);
    }
  });

  it("longer loan words fit, but the length cap still exists", () => {
    expect(MAX_SYLLABLE_LENGTH).toBe(10);
    expect(normalizeWord("instagram story")).toBe("instagram story");
    expect(normalizeWord("hamburger kfc")).toBe("hamburger kfc");
    expect(normalizeWord("abcdefghijk xe")).toBeNull(); // 11 letters
  });

  it("strict knows common loan phrases, loose also takes any real syllable with a loan token", () => {
    expect(hasWord("trang web")).toBe(true);
    expect(hasWord("chơi game")).toBe(true);
    expect(hasWord("bi a")).toBe(true);
    expect(isSyllable("zalo")).toBe(true);
    expect(isSyllable("web")).toBe(true);
    const phrase = "bật stream"; // not in any list
    expect(hasWord(phrase)).toBe(false);
    const strict = game({ dictionary: "strict" });
    strict.chain = [{ by: null, word: "mở bật", at: T }];
    expect(playWord(strict, "a", phrase, T, names)).toEqual({ ok: false, error: "Từ này không có trong từ điển" });
    const loose = game({ dictionary: "loose" });
    loose.chain = [{ by: null, word: "mở bật", at: T }];
    expect(playWord(loose, "a", phrase, T, names)).toEqual({ ok: true });
  });

  it("loan tokens do not open the door to gibberish", () => {
    for (const junk of ["zzzz wwww", "asdf ghjk", "xin chaof", "qqqqq zalo"]) {
      const [a, b] = junk.split(" ");
      expect(isSyllable(a) && isSyllable(b), junk).toBe(false);
    }
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

  it("there is no mode without a check: gibberish is refused in strict and loose alike", () => {
    for (const dictionary of ["strict", "loose"] as const) {
      const s = game({ dictionary });
      expect(playWord(s, "a", `${needOf(s)} qqqqq`, T, names).ok, dictionary).toBe(false);
      expect(playWord(s, "a", "hello world", T, names).ok, dictionary).toBe(false);
    }
  });

  it("loose mode accepts any pair of real Vietnamese syllables but still refuses gibberish", () => {
    const s = game({ dictionary: "loose" });
    s.chain = [{ by: null, word: "mở đôi", at: T }];
    // "đôi mắt" is not a headword, but both syllables are real Vietnamese
    expect(hasWord("đôi mắt")).toBe(false);
    expect(playWord(s, "a", "đôi mắt", T, names)).toEqual({ ok: true });
    // the chain rule and the format still apply, and so does "not used before"
    expect(playWord(s, "b", "xe hơi", T, names).ok).toBe(false);
    expect(playWord(s, "b", "mắt qqqq", T, names)).toEqual({ ok: false, error: '"qqqq" không phải tiếng Việt' });
    expect(playWord(s, "b", "mắt kính", T, names).ok).toBe(true);
    expect(s.chain.map((w) => w.word)).toEqual(["mở đôi", "đôi mắt", "mắt kính"]);
    // strict refuses the same word
    const strict = game({ dictionary: "strict" });
    strict.chain = [{ by: null, word: "mở đôi", at: T }];
    expect(playWord(strict, "a", "đôi mắt", T, names)).toEqual({ ok: false, error: "Từ này không có trong từ điển" });
  });

  it("reads the boolean the first version stored", () => {
    expect(dictionaryModeOf(true)).toBe("strict");
    expect(dictionaryModeOf(false)).toBe("loose"); // "no check" no longer exists: the most permissive mode is loose
    expect(dictionaryModeOf("off")).toBe("loose");
    expect(dictionaryModeOf(undefined)).toBe("strict");
    expect(dictionaryModeOf("loose")).toBe("loose");
    expect(dictionaryModeOf("nonsense")).toBe("strict");
    expect(game({ dictionary: false }).dictionary).toBe("loose");
    const old = game();
    old.dictionary = false; // a game saved by the first version, when false meant "no check": now loose
    expect(playWord(old, "a", `${needOf(old)} qqqqq`, T, names)).toEqual({ ok: false, error: '"qqqqq" không phải tiếng Việt' });
    old.chain = [{ by: null, word: "mở đôi", at: T }];
    expect(playWord(old, "a", "đôi mắt", T, names)).toEqual({ ok: true });
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
    expect(ncCommand(room, "token-bbbb", { type: "settings", dictionary: "loose" }, T).ok).toBe(false); // not host
    expect(ncCommand(room, "token-aaaa", { type: "settings", turnSeconds: 99 }, T).ok).toBe(false);
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: "yes" as never }, T).ok).toBe(false);
    expect(ncCommand(room, "token-aaaa", { type: "settings", turnSeconds: 15, dictionary: "loose", first: 3, second: 1 }, T).ok).toBe(true);
    expect(ncCommand(room, "token-bbbb", { type: "start" }, T).ok).toBe(false); // not host
    expect(ncCommand(room, "token-aaaa", { type: "start" }, T, () => 0).ok).toBe(true);
    const g = room.current!;
    expect(g.deadline).toBe(T + 15_000);
    expect(g.dictionary).toBe("loose");
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: "loose" }, T).ok).toBe(false); // mid-game
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

  it("accepts the old boolean setting and reads old saved settings", () => {
    const room = room2();
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: false as never }, T).ok).toBe(true);
    expect(ncSettingsOf(room).dictionary).toBe("loose");
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: true as never }, T).ok).toBe(true);
    expect(ncSettingsOf(room).dictionary).toBe("strict");
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: "maybe" as never }, T).ok).toBe(false);
    expect(ncCommand(room, "token-aaaa", { type: "settings", dictionary: "off" as never }, T).ok).toBe(false); // no such mode any more
    room.settings = { ...ncSettingsOf(room), dictionary: false as never }; // saved by the first version
    expect(ncSettingsOf(room).dictionary).toBe("loose");
    ncCommand(room, "token-aaaa", { type: "start" }, T, () => 0);
    expect(room.current!.dictionary).toBe("loose");
    expect(ncView(room, room.seats[0], T).current!.dictionary).toBe("loose");
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
    expect(ncSettingsOf({ ...room, settings: undefined })).toMatchObject({ turnSeconds: 20, dictionary: "strict", first: 2, second: 1 });
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
