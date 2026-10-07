import { CARD_TYPES, CHARACTERS, type CardKey, type CharKey, GEAR, type GearKey, SHOP_SLOTS, cardDef, typeOf } from "./cards";
import {
  type BangState,
  type DrawArgs,
  type NameOf,
  type QEntry,
  type Random,
  type Result,
  OK,
  abilities,
  alive,
  avoided,
  beatCards,
  beerSideEffects,
  beerWorks,
  cardName,
  distance,
  done,
  draw,
  drawPhase,
  dropGroup,
  effSuit,
  fail,
  flip,
  fromHand,
  fromPlay,
  gearActive,
  handLimit,
  has,
  hasAb,
  hasGear,
  heal,
  henryPunish,
  inPlay,
  isInteractive,
  keyOf,
  later,
  livingIds,
  log,
  mark,
  missedCards,
  newGroup,
  now_,
  passTurn,
  present,
  run,
  salvage,
  shot,
  suzy,
  takeTop,
  toDiscard,
  took,
  until,
  weaponRange,
} from "./game";
import type { DrawMode, PickSpec } from "./protocol";

/**
 * Đấu Súng: everything a player can do — play a card, use a card in front of them,
 * character / event powers, the Gold Rush shop, answering prompts, ending the turn —
 * plus what the server does for players who time out.
 */

type React = Extract<QEntry, { kind: "react" }>;

export interface PlayArgs {
  card: number;
  target?: string;
  target2?: string;
  pick?: PickSpec;
  extra?: number[];
  as?: "bang";
  mode?: string;
}

// ─── Shared checks ─────────────────────────────────────────────────

/** Every successful action pushes the play-phase clock back (rejected commands don't). */
function busy(s: BangState, now: number, turn: BangState["turn"], res: Result): Result {
  if (res.ok && turn && s.turn === turn) turn.deadline = now + s.turnMs;
  return res;
}

/** It's your turn, you're in the play phase and nothing is waiting. */
function myMove(s: BangState, id: string): string | null {
  if (s.status !== "playing") return "Ván chưa bắt đầu hoặc đã kết thúc";
  if (s.turn?.player !== id) return "Chưa tới lượt bạn";
  if (!present(s, id)) return "Bạn đã bị loại";
  if (s.turn.step !== "play") return "Hãy rút bài trước";
  if (s.queue.length) return "Đang chờ người khác trả lời";
  return null;
}

const ATTACKS = new Set<CardKey>(["bang", "punch", "fanning", "quickshot", "flintlock", "springfield", "gatling", "indians", "duel", "tomahawk", "derringer", "knife", "pepperbox", "buffalo", "howitzer"]);

/** Is `target` immune to this card played by `by`? (Thổ Dân Trẻ, Tẩu Hoà Bình, Bà Á-bi.) */
function immune(s: BangState, by: string, target: string, card: number | null): string | null {
  if (card === null || by === target) return null;
  const d = cardDef(card);
  if (d.suit === "D" && hasAb(s, target, "apache")) return "Thổ Dân Trẻ không bị ảnh hưởng bởi lá ♦";
  if (d.suit === "D" && hasGear(s, target, "calumet")) return "Người đó có Tẩu Hoà Bình (miễn lá ♦)";
  if (d.rank >= 11 && ATTACKS.has(d.key) && hasAb(s, target, "abigail")) return "Bà Á-bi không bị ảnh hưởng bởi lá tấn công J–A";
  return null;
}

type Reach = "range" | "dist1" | "dist2" | "any" | "anyone";

/** Validate a target for a card with the given reach. */
function checkTarget(s: BangState, by: string, target: string | undefined, reach: Reach, card: number | null, bangShot = false): string | null {
  if (!target || !s.ps[target]) return "Hãy chọn người";
  if (reach === "anyone") return alive(s, target) ? null : "Người đó đã chết";
  if (target === by) return "Không chọn chính mình";
  if (!present(s, target)) return "Người đó đã bị loại";
  const bell = !!s.turn?.bellTower;
  // Súng Săn Lớn: the next BANG! ignores the target's Mustang-type cards.
  const d = distance(s, by, target, bangShot && !!s.turn?.bigFifty && s.turn.player === by);
  if (!bell) {
    if (reach === "range" && d > weaponRange(s, by)) return `Ngoài tầm súng (khoảng cách ${d}, tầm ${weaponRange(s, by)})`;
    if (reach === "dist1" && d > 1) return `Phải ở khoảng cách 1 (đang là ${d})`;
    if (reach === "dist2" && d > 2) return `Phải ở khoảng cách tối đa 2 (đang là ${d})`;
  }
  return immune(s, by, target, card);
}

/** The card chosen from another player: a random hand card or a named card in front of them. */
function checkPick(s: BangState, target: string, pick: PickSpec | undefined, zones: ("hand" | "play")[] = ["hand", "play"]): string | null {
  const p = s.ps[target];
  if (!pick) return "Chọn lá muốn lấy";
  if (pick.zone === "hand") return zones.includes("hand") && p.hand.length ? null : "Người đó không có bài trên tay";
  if (pick.zone === "play") return zones.includes("play") && p.play.some((c) => c.id === pick.card) ? null : "Không có lá đó trước mặt họ";
  return "Lựa chọn không hợp lệ";
}

function takeByPick(s: BangState, target: string, pick: PickSpec, random: Random): number | null {
  const p = s.ps[target];
  if (pick.zone === "hand") {
    if (!p.hand.length) return null;
    return p.hand.splice(Math.floor(random() * p.hand.length), 1)[0];
  }
  return fromPlay(s, target, pick.card)?.id ?? null;
}

/** A shot counts toward the BANG! limit — how many are left this turn? */
export function bangsLeft(s: BangState, id: string): number {
  const t = s.turn;
  if (!t || t.player !== id) return 0;
  if (has(s, "sermon")) return 0;
  if (hasAb(s, id, "willy") || inPlay(s, id, "volcanic")) return 99;
  return Math.max(0, 1 + t.extraBangs + (has(s, "shootout") ? 1 : 0) - t.bangs);
}

/** Chuồn / Mích Phòng Thủ may cancel a brown card aimed at `target`: returns the prompt, or null. */
function evadeWindow(s: BangState, by: string, target: string, cause: string, group: number, now: number): React | null {
  const p = s.ps[target];
  const escape = p.hand.some((c) => keyOf(c) === "escape");
  const mick = hasAb(s, target, "mick") && missedCards(s, target).length > 0;
  if (!escape && !mick) return null;
  return { kind: "react", to: target, from: by, answer: "evade", cause, need: 1, dmg: 0, group, deadline: until(s, now) };
}

/** Queue a stealing / discarding card aimed at one player, behind an evade window. */
function aimedEffect(s: BangState, by: string, key: Extract<QEntry, { kind: "effect" }>["key"], target: string, pick: PickSpec | undefined, cause: string, now: number, card: number | null) {
  const group = newGroup(s);
  const ev = evadeWindow(s, by, target, cause, group, now);
  const effect: QEntry = { kind: "effect", by, key, target, ...(pick ? { pick } : {}), group, card };
  later(s, ...(ev ? [ev, effect] : [effect]));
}

function place(s: BangState, owner: string, card: number) {
  const t = typeOf(card);
  s.ps[owner].play.push({ id: card, ...(t.color === "green" ? { fresh: true } : {}), ...(t.load ? { cubes: t.load } : {}) });
}

/** Mục Sư Al draws when someone else puts a card in front of themselves. */
function preacher(s: BangState, by: string, random: Random) {
  for (const id of s.order) if (id !== by && present(s, id) && hasAb(s, id, "alpreacher")) draw(s, id, 1, random);
}

/** Add cubes: to cube cards first (4 per card max), then the character card. */
function addCubes(s: BangState, id: string, n: number) {
  const p = s.ps[id];
  for (let i = 0; i < n; i++) {
    const card = p.play.find((c) => typeOf(c.id).load && (c.cubes ?? 0) < 4);
    if (card) card.cubes = (card.cubes ?? 0) + 1;
    else if (p.cubes < 4) p.cubes += 1;
  }
}

/** Spend cubes from anywhere you have them (character first). */
function spendCubes(s: BangState, id: string, n: number): boolean {
  const p = s.ps[id];
  const total = p.cubes + p.play.reduce((t, c) => t + (c.cubes ?? 0), 0);
  if (total < n) return false;
  let left = n;
  const fromChar = Math.min(p.cubes, left);
  p.cubes -= fromChar;
  left -= fromChar;
  for (const c of p.play) {
    const take = Math.min(c.cubes ?? 0, left);
    c.cubes = (c.cubes ?? 0) - take;
    left -= take;
  }
  return true;
}

// ─── Playing a card from your hand ─────────────────────────────────

export function playCard(s: BangState, id: string, a: PlayArgs, now: number, names: NameOf, random: Random = Math.random): Result {
  const turn = s.turn;
  return busy(s, now, turn, playCardInner(s, id, a, now, names, random));
}

function playCardInner(s: BangState, id: string, a: PlayArgs, now: number, names: NameOf, random: Random): Result {
  const bad = myMove(s, id);
  if (bad) return fail(bad);
  const p = s.ps[id];
  const card = a.card;
  if (!p.hand.includes(card)) return fail("Bạn không có lá đó");
  let key = keyOf(card);
  const type = typeOf(card);
  const t = s.turn!;

  // Playing a card as a BANG!: Cô Tai Ương's Trượt!, Súng Hai Cỡ, Quyết Đấu.
  if (a.as === "bang" && key !== "bang") {
    const okAs = (hasAb(s, id, "calamity") && type.isMissed) || !!inPlay(s, id, "lemat") || has(s, "showdown");
    if (!okAs) return fail("Không thể dùng lá này như BANG!");
    key = "bang";
  }
  const kt = CARD_TYPES[key];

  if (kt.isMissed && key !== "bang") return fail(`${kt.name} chỉ dùng khi bị bắn`);
  if (key === "escape" || key === "saved") return fail(`${kt.name} chỉ dùng ngoài lượt`);
  if (key === "aim") return fail("Nhắm Kỹ phải đánh cùng 1 lá BANG!");
  if ((key === "beer") && has(s, "reverend")) return fail("Mục Sư: không được uống Bia");
  if (key === "beer" && has(s, "hangover")) return fail("Say Xỉn: Bia không có tác dụng");
  if (kt.isBang && has(s, "sermon")) return fail("Bài Giảng: không được đánh BANG! trong lượt này");

  // Blue / green cards go in front of someone.
  if ((kt.color === "blue" || kt.color === "green") && a.as !== "bang") {
    if (has(s, "judge")) return fail("Quan Toà: không ai được đặt lá ra trước mặt");
    let owner = id;
    if (kt.placeOn === "other") {
      const err = checkTarget(s, id, a.target, "any", card);
      if (err) return fail(err);
      owner = a.target!;
      if (key === "jail" && s.ps[owner].role === "sheriff" && !s.three) return fail("Không thể giam Cảnh sát trưởng");
    } else if (kt.placeOn === "dead") {
      const target = a.target;
      if (!target || !s.ps[target]?.dead || s.ps[target].ghost) return fail("Chọn 1 người đã chết");
      owner = target;
    }
    const mine = s.ps[owner].play;
    if (mine.some((c) => keyOf(c.id) === key)) return fail(`Đã có ${kt.name} ở đó rồi`);
    fromHand(s, id, card);
    if (kt.range) {
      const old = mine.find((c) => typeOf(c.id).range);
      if (old) {
        fromPlay(s, owner, old.id);
        toDiscard(s, old.id);
      }
    }
    place(s, owner, card);
    if (key === "ghost") {
      s.ps[owner].ghost = true;
      log(s, now, `👻 ${names(owner)} trở lại như hồn ma`, "event");
    }
    t.played += 1;
    mark(s, "play", id, card, owner === id ? null : owner);
    log(s, now, `${names(id)} đặt ${cardName(card)}${owner !== id ? ` trước mặt ${names(owner)}` : ""}`, "info");
    preacher(s, id, random);
    suzy(s, random);
    run(s, now, names, random);
    return OK;
  }

  // Dodge City cost: discard one more card.
  let costCard: number | null = null;
  if (kt.cost) {
    costCard = a.extra?.[0] ?? null;
    if (costCard === null || costCard === card || !p.hand.includes(costCard)) return fail(`${kt.name}: chọn thêm 1 lá trên tay để bỏ kèm`);
  }

  // Extras that ride along with a BANG!: Nhắm Kỹ (+1 damage), Bắn Tỉa (a second BANG!).
  let aimCard: number | null = null;
  let sniperCard: number | null = null;
  if (kt.isBang && key !== "punch" && a.extra?.length) {
    for (const x of a.extra) {
      if (x === card || !p.hand.includes(x)) return fail("Lá đi kèm không hợp lệ");
      if (keyOf(x) === "aim" && aimCard === null) aimCard = x;
      else if (has(s, "sniper") && typeOf(x).isBang && sniperCard === null) sniperCard = x;
      else return fail("Lá đi kèm không hợp lệ");
    }
  }

  // Validate before anything leaves the hand.
  const err = validate(s, id, key, card, a);
  if (err) return fail(err);
  if (kt.isBang) {
    if (bangsLeft(s, id) <= 0) return fail("Bạn đã bắn đủ BANG! trong lượt này");
  }

  fromHand(s, id, card);
  toDiscard(s, card);
  for (const x of [costCard, aimCard, sniperCard]) {
    if (x !== null) {
      fromHand(s, id, x);
      toDiscard(s, x);
    }
  }
  if (kt.isBang) t.bangs += 1;
  t.played += 1 + (aimCard !== null ? 1 : 0) + (sniperCard !== null ? 1 : 0);
  mark(s, "play", id, card, a.target ?? null);
  log(s, now, `${names(id)} đánh ${cardName(card)}${a.as === "bang" ? " (như BANG!)" : ""}${a.target ? ` → ${names(a.target)}` : ""}`, kt.isBang ? "bang" : "info");

  resolve(s, id, key, card, a, { dmg: aimCard !== null ? 2 : 1, need: sniperCard !== null ? 2 : 1 }, now, names, random);
  if (!kt.isBang && kt.color === "brown") t.lastBrown = { key, ...(a.target ? { target: a.target } : {}), ...(a.target2 ? { target2: a.target2 } : {}), ...(a.pick ? { pick: a.pick } : {}) };
  if (t.bellTower && key !== "reload") t.bellTower = false;
  suzy(s, random);
  run(s, now, names, random);
  return OK;
}

/** Targets and choices for a brown card. */
function validate(s: BangState, id: string, key: CardKey, card: number | null, a: Omit<PlayArgs, "card">): string | null {
  const kt = CARD_TYPES[key];
  switch (key) {
    case "bang":
    case "flintlock": {
      if (has(s, "ricochet") && a.pick?.zone === "play") {
        const err = checkTarget(s, id, a.target, "range", card, true);
        return err ?? checkPick(s, a.target!, a.pick, ["play"]);
      }
      return checkTarget(s, id, a.target, "range", card, true);
    }
    case "punch":
      return checkTarget(s, id, a.target, "dist1", card, true);
    case "fanning": {
      const err = checkTarget(s, id, a.target, "range", card, true);
      if (err) return err;
      if (a.target2) {
        if (a.target2 === id || a.target2 === a.target || !present(s, a.target2)) return "Người thứ hai không hợp lệ";
        if (distance(s, a.target!, a.target2) > 1) return "Người thứ hai phải ở khoảng cách 1 từ người thứ nhất";
        return immune(s, id, a.target2, card);
      }
      return null;
    }
    case "quickshot": {
      const err = checkTarget(s, id, a.target, "range", card, true);
      if (err) return err;
      if (!a.target2 || a.target2 === a.target) return "Bắn Nhanh: chọn 2 người khác nhau";
      return checkTarget(s, id, a.target2, "range", card, true);
    }
    case "springfield":
      return checkTarget(s, id, a.target, "any", card);
    case "tomahawk":
      return checkTarget(s, id, a.target, "dist2", card);
    case "panic":
      return checkTarget(s, id, a.target, "dist1", card) ?? checkPick(s, a.target!, a.pick);
    case "ragtime":
      return checkTarget(s, id, a.target, "any", card) ?? checkPick(s, a.target!, a.pick);
    case "catbalou":
      return checkTarget(s, id, a.target, "any", card) ?? checkPick(s, a.target!, a.pick);
    case "lockpick": {
      const err = checkTarget(s, id, a.target, "any", card);
      return err ?? (s.ps[a.target!].hand.length ? null : "Người đó không có bài trên tay");
    }
    case "squaw": {
      const err = checkTarget(s, id, a.target, "any", card);
      if (err) return err;
      if (a.pick?.zone !== "play") return "Chọn 1 lá trước mặt người đó";
      return checkPick(s, a.target!, a.pick, ["play"]);
    }
    case "duel":
      return checkTarget(s, id, a.target, "any", card);
    case "tequila":
      return checkTarget(s, id, a.target ?? id, "anyone", card);
    case "beer":
      return s.ps[id].life >= s.ps[id].max ? "Bạn đang đầy máu" : !beerWorks(s) ? "Chỉ còn 2 người: Bia vô dụng" : null;
    case "whisky":
    case "lastcall":
    case "nip":
      return key !== "nip" && s.ps[id].life >= s.ps[id].max ? "Bạn đang đầy máu" : null;
    default:
      return kt.aim === "none" ? null : null;
  }
}

/** The effect of a brown card (or of a green card / gear item used like one). */
function resolve(
  s: BangState,
  id: string,
  key: CardKey,
  card: number | null,
  a: Omit<PlayArgs, "card">,
  mod: { dmg: number; need: number },
  now: number,
  names: NameOf,
  random: Random,
) {
  const t = s.turn;
  const isBangCard = ["bang", "punch", "fanning", "quickshot", "flintlock"].includes(key);
  const noGear = !!t?.bigFifty;
  if (noGear && t && isBangCard) t.bigFifty = false;
  // Cô-lô-ra-đô: his BANG! draws! first; a ♠ makes it unmissable.
  const unmissable = isBangCard && hasAb(s, id, "colorado") && flip(s, id, (c) => effSuit(s, c) === "S", "Cô-lô-ra-đô", now, names, random);
  const others = () => {
    const out: string[] = [];
    const n = s.order.length;
    const i = s.order.indexOf(id);
    for (let k = 1; k < n; k++) {
      const o = s.order[(i + k) % n];
      if (alive(s, o)) out.push(o);
    }
    return out;
  };
  switch (key) {
    case "bang":
    case "flintlock":
      if (has(s, "ricochet") && a.pick?.zone === "play") {
        later(s, { ...shot(s, id, a.target!, now, { cause: "Đạn Nảy", card, need: mod.need, targetCard: a.pick.card, bang: true, unmissable }), shot: false });
        return;
      }
      later(s, shot(s, id, a.target!, now, { cause: CARD_TYPES[key].name, card, dmg: mod.dmg, need: mod.need, noGear, bang: true, unmissable }));
      return;
    case "punch":
      later(s, shot(s, id, a.target!, now, { cause: "Đấm", card, dmg: mod.dmg, noGear, bang: true, unmissable }));
      return;
    case "fanning":
      later(s, shot(s, id, a.target!, now, { cause: "Bắn Quạt", card, dmg: mod.dmg, need: mod.need, noGear, bang: true, unmissable }));
      if (a.target2) later(s, shot(s, id, a.target2, now, { cause: "Bắn Quạt", card, noGear, bang: true, unmissable }));
      return;
    case "quickshot":
      later(s, shot(s, id, a.target!, now, { cause: "Bắn Nhanh", card, dmg: mod.dmg, need: mod.need, noGear, bang: true, unmissable }));
      later(s, shot(s, id, a.target2!, now, { cause: "Bắn Nhanh", card, noGear, bang: true, unmissable }));
      return;
    case "springfield":
    case "pepperbox":
    case "buffalo":
    case "knife":
      later(s, shot(s, id, a.target!, now, { cause: CARD_TYPES[key].name, card }));
      return;
    case "derringer":
      later(s, shot(s, id, a.target!, now, { cause: "Súng Bỏ Túi", card }));
      draw(s, id, 1, random);
      return;
    case "tomahawk":
      later(s, { ...shot(s, id, a.target!, now, { cause: "Rìu Ném", card }), shot: false });
      return;
    case "gatling":
    case "howitzer":
      for (const o of others()) {
        if (immune(s, id, o, card)) continue;
        later(s, { kind: "react", to: o, from: id, answer: "missed", cause: CARD_TYPES[key].name, need: 1, dmg: 1, card, deadline: until(s, now) });
      }
      return;
    case "indians":
      for (const o of others()) {
        if (immune(s, id, o, card)) continue;
        later(s, { kind: "react", to: o, from: id, answer: "bang", cause: "Da Đỏ!", need: 1, dmg: 1, card, evadable: true, deadline: until(s, now) });
      }
      return;
    case "duel":
      later(s, { kind: "react", to: a.target!, from: id, answer: "bang", cause: "Đấu Tay Đôi", need: 1, dmg: 1, card, duel: id, evadable: true, deadline: until(s, now) });
      return;
    case "panic":
    case "ragtime":
    case "conestoga":
      aimedEffect(s, id, "panic", a.target!, a.pick, CARD_TYPES[key].name, now, card);
      return;
    case "catbalou":
    case "cancan":
      aimedEffect(s, id, "catbalou", a.target!, a.pick, CARD_TYPES[key].name, now, card);
      return;
    case "lockpick":
      aimedEffect(s, id, "lockpick", a.target!, { zone: "hand" }, "Bẻ Khoá", now, card);
      return;
    case "squaw":
      aimedEffect(s, id, a.mode === "take" && spendCubes(s, id, 2) ? "squaw" : "catbalou", a.target!, a.pick, "Giật Đồ", now, card);
      return;
    case "beer": {
      const n = heal(s, id, hasAb(s, id, "tequilajoe") ? 2 : 1);
      log(s, now, `${names(id)} hồi ${n} máu`, "heal");
      beerSideEffects(s, id, now, names, random);
      return;
    }
    case "whisky":
      heal(s, id, 2);
      return;
    case "tequila":
      heal(s, a.target ?? id, 1);
      return;
    case "canteen":
    case "lastcall":
      heal(s, id, 1);
      return;
    case "nip":
      heal(s, id, 1);
      s.ps[id].cubes = Math.min(4, s.ps[id].cubes + 1);
      return;
    case "saloon":
      for (const o of livingIds(s)) heal(s, o, 1);
      return;
    case "stagecoach":
      draw(s, id, 2, random);
      return;
    case "wellsfargo":
    case "ponyexpress":
      draw(s, id, 3, random);
      return;
    case "generalstore": {
      const order = [id, ...others().filter((o) => present(s, o))];
      const cards: number[] = [];
      for (let i = 0; i < order.length; i++) {
        const c = takeTop(s, random);
        if (c !== null) cards.push(c);
      }
      if (cards.length) later(s, { kind: "store", to: order[0], cards, order: order.slice(1), deadline: until(s, now) });
      return;
    }
    case "brawl":
      for (const o of others()) {
        if (s.ps[o].hand.length || s.ps[o].play.length) later(s, { kind: "pick", to: id, from: o, mode: "discard", cause: "Ẩu Đả", deadline: until(s, now) });
      }
      return;
    case "bandidas":
      for (const o of others()) later(s, { kind: "discard", to: o, count: 2, orLose: 1, cause: "bandidas", deadline: until(s, now) });
      return;
    case "poker": {
      const players = others().filter((o) => s.ps[o].hand.length);
      for (const o of players) later(s, { kind: "discard", to: o, count: 1, orLose: 0, cause: "poker", pool: id, deadline: until(s, now) });
      if (players.length) later(s, { kind: "pokerEnd", to: id, pool: [] });
      return;
    }
    case "tornado":
      for (const o of [id, ...others()]) {
        const h = s.ps[o].hand;
        if (h.length) toDiscard(s, h.splice(Math.floor(random() * h.length), 1)[0]);
        draw(s, o, 2, random);
      }
      return;
    case "reload":
      addCubes(s, id, 3);
      return;
    default:
      return;
  }
}

/** Queued effects (after an evade window). */
export function applyEffect(s: BangState, e: Extract<QEntry, { kind: "effect" }>, now: number, names: NameOf, random: Random) {
  const by = e.by;
  const target = e.target;
  if (!present(s, by)) return;
  switch (e.key) {
    case "panic":
    case "lockpick":
    case "bottle-panic":
    case "squaw": {
      if (!target || !present(s, target) || !e.pick) return;
      const c = takeByPick(s, target, e.pick, random);
      if (c === null) return;
      s.ps[by].hand.push(c);
      log(s, now, `${names(by)} lấy 1 lá của ${names(target)}${e.pick.zone === "play" ? ` (${cardName(c)})` : ""}`, "info");
      loseGhost(s, target, c, now, names);
      henryPunish(s, target, by, now);
      return;
    }
    case "catbalou":
    case "pardner-cat": {
      if (!target || !present(s, target) || !e.pick) return;
      const c = takeByPick(s, target, e.pick, random);
      if (c === null) return;
      toDiscard(s, c);
      log(s, now, `${names(target)} phải bỏ ${cardName(c)}`, "info");
      loseGhost(s, target, c, now, names);
      henryPunish(s, target, by, now);
      return;
    }
    default:
      return;
  }
}

/** Losing the Hồn Ma card sends a ghost back to the grave. */
function loseGhost(s: BangState, owner: string, card: number, now: number, names: NameOf) {
  if (keyOf(card) === "ghost" && s.ps[owner].ghost) {
    const o = s.ps[owner];
    o.ghost = false;
    log(s, now, `${names(owner)} về lại cõi chết`, "death");
    // Back in the grave for good: whatever they still held goes to the discard pile (as when they die).
    toDiscard(s, ...o.hand, ...o.play.map((c) => c.id));
    o.hand = [];
    o.play = [];
    o.gear = [];
    s.queue = s.queue.flatMap((e) => ("to" in e && e.to === owner && e.kind !== "pokerEnd" && e.kind !== "hurt" ? salvage(s, e) : [e]));
    if (s.turn?.player === owner) s.turn.skip = true;
  }
}

// ─── Cards in front of you ─────────────────────────────────────────

export function useCard(s: BangState, id: string, a: { card: number; target?: string; pick?: PickSpec }, now: number, names: NameOf, random: Random = Math.random): Result {
  const turn = s.turn;
  return busy(s, now, turn, useCardInner(s, id, a, now, names, random));
}

function useCardInner(s: BangState, id: string, a: { card: number; target?: string; pick?: PickSpec }, now: number, names: NameOf, random: Random): Result {
  const bad = myMove(s, id);
  if (bad) return fail(bad);
  const p = s.ps[id];
  const c = p.play.find((x) => x.id === a.card);
  if (!c) return fail("Lá đó không ở trước mặt bạn");
  const key = keyOf(c.id);
  const kt = typeOf(c.id);
  if (!gearActive(s, id)) return fail("Lá trước mặt đang mất tác dụng");
  const t = s.turn!;
  if (kt.load) {
    if ((c.cubes ?? 0) < 1) return fail("Lá này hết đạn");
    if (key === "bandolier") t.extraBangs += 1;
    else if (key === "belltower") t.bellTower = true;
    else if (key === "bigfifty") t.bigFifty = true;
    else return fail("Lá này tự kích hoạt");
    c.cubes = (c.cubes ?? 0) - 1;
    log(s, now, `${names(id)} dùng ${kt.name} (còn ${c.cubes} đạn)`, "info");
    run(s, now, names, random);
    return OK;
  }
  if (kt.color !== "green") return fail("Lá này không kích hoạt được");
  if (c.fresh) return fail("Lá xanh lá chỉ dùng được từ lượt sau");
  if (kt.isMissed) return fail(`${kt.name} chỉ dùng khi bị bắn`);
  const reach: Record<string, Reach> = { cancan: "any", conestoga: "any", derringer: "dist1", knife: "dist1", pepperbox: "range", buffalo: "any" };
  if (reach[key]) {
    const err = checkTarget(s, id, a.target, reach[key], c.id);
    if (err) return fail(err);
    if ((key === "cancan" || key === "conestoga") && checkPick(s, a.target!, a.pick)) return fail(checkPick(s, a.target!, a.pick)!);
  }
  if (key === "canteen" && p.life >= p.max) return fail("Bạn đang đầy máu");
  fromPlay(s, id, c.id);
  toDiscard(s, c.id);
  t.played += 1;
  mark(s, "play", id, c.id, a.target ?? null);
  log(s, now, `${names(id)} dùng ${cardName(c.id)}${a.target ? ` → ${names(a.target)}` : ""}`, "info");
  resolve(s, id, key, c.id, a, { dmg: 1, need: 1 }, now, names, random);
  if (t.bellTower) t.bellTower = false;
  suzy(s, random);
  run(s, now, names, random);
  return OK;
}

// ─── Character and event powers ────────────────────────────────────

export interface AbilityArgs {
  name: string;
  target?: string;
  cards?: number[];
  card?: number;
  pick?: PickSpec;
}

const once = (s: BangState, name: string, max = 1) => (s.turn!.uses[name] ?? 0) < max;
const used = (s: BangState, name: string) => (s.turn!.uses[name] = (s.turn!.uses[name] ?? 0) + 1);

function handCards(s: BangState, id: string, cards: number[] | undefined, n: number): number[] | null {
  const list = (cards ?? []).filter((c, i, a) => a.indexOf(c) === i);
  if (list.length !== n || !list.every((c) => s.ps[id].hand.includes(c))) return null;
  return list;
}

export function useAbility(s: BangState, id: string, a: AbilityArgs, now: number, names: NameOf, random: Random = Math.random): Result {
  const turn = a.name === "sid" ? null : s.turn;
  return busy(s, now, turn, useAbilityInner(s, id, a, now, names, random));
}

function useAbilityInner(s: BangState, id: string, a: AbilityArgs, now: number, names: NameOf, random: Random): Result {
  const p = s.ps[id];
  // Sít Liều Mạng may heal at any time, even outside his turn.
  if (a.name === "sid") {
    if (!hasAb(s, id, "sid") || !alive(s, id)) return fail("Bạn không có sức mạnh này");
    if (p.life >= p.max) return fail("Bạn đang đầy máu");
    const cards = handCards(s, id, a.cards, 2);
    if (!cards) return fail("Chọn đúng 2 lá trên tay");
    for (const c of cards) fromHand(s, id, c);
    toDiscard(s, ...cards);
    heal(s, id, 1);
    log(s, now, `${names(id)} bỏ 2 lá để hồi 1 máu`, "heal");
    suzy(s, random);
    run(s, now, names, random);
    return OK;
  }
  const bad = myMove(s, id);
  if (bad) return fail(bad);
  const t = s.turn!;
  const need = (key: CharKey) => (hasAb(s, id, key) ? null : "Bạn không có sức mạnh này");
  let err: string | null = null;
  switch (a.name) {
    case "chuck": {
      err = need("chuck") ?? (p.life <= 1 ? "Không được tự hạ máu về 0" : null);
      if (err) break;
      p.life -= 1;
      draw(s, id, 2, random);
      log(s, now, `${names(id)} đổi 1 máu lấy 2 lá`, "info");
      break;
    }
    case "doc": {
      err = need("doc") ?? (!once(s, "doc") ? "Mỗi lượt 1 lần" : null);
      if (err) break;
      const cards = handCards(s, id, a.cards, 2);
      if (!cards) {
        err = "Chọn đúng 2 lá để bỏ";
        break;
      }
      err = checkTarget(s, id, a.target, "range", null);
      if (err) break;
      for (const c of cards) fromHand(s, id, c);
      toDiscard(s, ...cards);
      used(s, "doc");
      later(s, shot(s, id, a.target!, now, { cause: "Bác Sĩ Súng" }));
      break;
    }
    case "jose": {
      err = need("jose") ?? (!once(s, "jose", 2) ? "Tối đa 2 lần mỗi lượt" : null);
      if (err) break;
      const c = a.card;
      if (c === undefined || !p.hand.includes(c) || typeOf(c).color !== "blue") {
        err = "Chọn 1 lá xanh dương trên tay";
        break;
      }
      fromHand(s, id, c);
      toDiscard(s, c);
      used(s, "jose");
      draw(s, id, 2, random);
      break;
    }
    case "flint": {
      err = need("flint") ?? (!once(s, "flint") ? "Mỗi lượt 1 lần" : null);
      if (err) break;
      const c = a.card;
      const target = a.target;
      if (c === undefined || !p.hand.includes(c) || !target || target === id || !present(s, target) || !s.ps[target].hand.length) {
        err = "Chọn 1 lá của bạn và 1 người có bài";
        break;
      }
      const h = s.ps[target].hand;
      const got = [h.splice(Math.floor(random() * h.length), 1)[0]];
      if (h.length) got.push(h.splice(Math.floor(random() * h.length), 1)[0]);
      fromHand(s, id, c);
      s.ps[target].hand.push(c);
      p.hand.push(...got);
      used(s, "flint");
      henryPunish(s, target, id, now);
      log(s, now, `${names(id)} đổi 1 lá lấy ${got.length} lá của ${names(target)}`, "info");
      break;
    }
    case "leevan": {
      err = need("leevan");
      if (err) break;
      const last = t.lastBrown;
      const c = a.card;
      if (!last) {
        err = "Chưa đánh lá nâu nào trong lượt";
        break;
      }
      if (c === undefined || !p.hand.includes(c) || !typeOf(c).isBang) {
        err = "Chọn 1 lá BANG! để bỏ";
        break;
      }
      err = validate(s, id, last.key, null, last);
      if (err) break;
      fromHand(s, id, c);
      toDiscard(s, c);
      t.lastBrown = null;
      log(s, now, `${names(id)} lặp lại ${CARD_TYPES[last.key].name}`, "info");
      resolve(s, id, last.key, null, last, { dmg: 1, need: 1 }, now, names, random);
      break;
    }
    case "jacky":
    case "mexicali": {
      if (a.name === "jacky") {
        err = need("jacky") ?? (p.gold < 2 ? "Cần 2 vàng" : null);
        if (err) break;
        p.gold -= 2;
      } else {
        err = need("mexicali") ?? (!once(s, "mexicali") ? "Mỗi lượt 1 lần" : !spendCubes(s, id, 2) ? "Cần 2 viên đạn" : null);
        if (err) break;
        used(s, "mexicali");
      }
      t.extraBangs += 1;
      log(s, now, `${names(id)} được bắn thêm 1 BANG!`, "info");
      break;
    }
    case "josh": {
      err = need("josh") ?? (!s.packs.includes("goldrush") ? "Không chơi Cơn Sốt Vàng" : p.gold < 2 ? "Cần 2 vàng" : !s.shopDeck.length ? "Hết trang bị" : null);
      if (err) break;
      const top = s.shopDeck[0];
      if (GEAR[top].kind === "keep" && top !== "wanted" && hasGear(s, id, top)) {
        err = "Bạn đã có món này";
        break;
      }
      p.gold -= 2;
      const gear = s.shopDeck.shift()!;
      err = gainGear(s, id, gear, { mode: gear === "bottle" ? "beer" : gear === "pardner" ? "store" : undefined, target: gear === "wanted" ? s.order.find((o) => o !== id && alive(s, o)) : undefined }, now, names, random);
      break;
    }
    case "raddie":
    case "goldpan": {
      const ok = a.name === "raddie" ? hasAb(s, id, "raddie") : hasGear(s, id, "goldpan");
      err = !ok ? "Bạn không có sức mạnh này" : !once(s, a.name, 2) ? "Tối đa 2 lần mỗi lượt" : p.gold < 1 ? "Cần 1 vàng" : null;
      if (err) break;
      p.gold -= 1;
      used(s, a.name);
      draw(s, id, 1, random);
      break;
    }
    case "blackflower": {
      err = need("blackflower") ?? (!once(s, "blackflower") ? "Mỗi lượt 1 lần" : null);
      if (err) break;
      const c = a.card;
      if (c === undefined || !p.hand.includes(c) || cardDef(c).suit !== "C") {
        err = "Chọn 1 lá ♣";
        break;
      }
      err = checkTarget(s, id, a.target, "range", c);
      if (err) break;
      fromHand(s, id, c);
      toDiscard(s, c);
      used(s, "blackflower");
      later(s, shot(s, id, a.target!, now, { cause: "Hoa Đen", card: c }));
      break;
    }
    case "derspot": {
      err = need("derspot") ?? (!once(s, "derspot") ? "Mỗi lượt 1 lần" : bangsLeft(s, id) <= 0 ? "Bạn đã bắn đủ BANG! trong lượt này" : null);
      if (err) break;
      const c = a.card;
      if (c === undefined || !p.hand.includes(c) || keyOf(c) !== "bang") {
        err = "Chọn 1 lá BANG!";
        break;
      }
      fromHand(s, id, c);
      toDiscard(s, c);
      used(s, "derspot");
      t.bangs += 1;
      resolve(s, id, "gatling", c, {}, { dmg: 1, need: 1 }, now, names, random);
      log(s, now, `${names(id)} xả BANG! như Súng Máy`, "bang");
      break;
    }
    case "bass": {
      err = need("bass") ?? (!once(s, "bass") ? "Mỗi lượt 1 lần" : null);
      if (err) break;
      const c = a.card;
      if (c === undefined || !p.hand.includes(c)) {
        err = "Chọn 1 lá để bỏ";
        break;
      }
      fromHand(s, id, c);
      toDiscard(s, c);
      used(s, "bass");
      addCubes(s, id, 2);
      break;
    }
    case "frankie": {
      err = need("frankie") ?? (!once(s, "frankie") ? "Mỗi lượt 1 lần" : p.cubes >= 4 ? "Thẻ nhân vật đã đầy đạn" : null);
      if (err) break;
      const owner = a.target;
      const card = a.card;
      if (!owner || !s.ps[owner]) {
        err = "Chọn lá có đạn";
        break;
      }
      if (card === undefined) {
        if (owner === id || s.ps[owner].cubes < 1) {
          err = "Thẻ nhân vật đó không có đạn";
          break;
        }
        s.ps[owner].cubes -= 1;
      } else {
        const c = s.ps[owner].play.find((x) => x.id === card);
        if (!c || (c.cubes ?? 0) < 1) {
          err = "Lá đó không có đạn";
          break;
        }
        c.cubes = (c.cubes ?? 0) - 1;
      }
      p.cubes += 1;
      used(s, "frankie");
      break;
    }
    case "redringo": {
      err = need("redringo") ?? (!once(s, "redringo", 2) ? "Tối đa 2 lần mỗi lượt" : p.cubes < 1 ? "Thẻ nhân vật hết đạn" : null);
      if (err) break;
      const c = p.play.find((x) => x.id === a.card);
      if (!c || (c.cubes ?? 0) >= 4) {
        err = "Chọn 1 lá trước mặt bạn (tối đa 4 đạn)";
        break;
      }
      p.cubes -= 1;
      c.cubes = (c.cubes ?? 0) + 1;
      used(s, "redringo");
      break;
    }
    case "dorothy": {
      err = !has(s, "dorothy") ? "Không có sự kiện này" : !once(s, "dorothy") ? "Mỗi lượt 1 lần" : null;
      if (err) break;
      err = checkTarget(s, id, a.target, "any", null);
      if (err) break;
      used(s, "dorothy");
      later(s, { kind: "react", to: a.target!, from: id, answer: "bang", cause: "Cơn Giận", need: 1, dmg: 1, deadline: until(s, now) });
      break;
    }
    case "ladyrose": {
      err = !has(s, "ladyrose") ? "Không có sự kiện này" : !once(s, "ladyrose") ? "Mỗi lượt 1 lần" : null;
      if (err) break;
      const target = a.target;
      const ring = s.order.filter((o) => present(s, o));
      const i = ring.indexOf(id);
      const n = ring.length;
      if (!target || (ring[(i + 1) % n] !== target && ring[(i - 1 + n) % n] !== target) || target === id) {
        err = "Chọn người ngồi cạnh bạn";
        break;
      }
      const a1 = s.order.indexOf(id);
      const a2 = s.order.indexOf(target);
      [s.order[a1], s.order[a2]] = [s.order[a2], s.order[a1]];
      used(s, "ladyrose");
      log(s, now, `${names(id)} đổi chỗ với ${names(target)}`, "event");
      break;
    }
    case "ranch": {
      err = !has(s, "ranch") ? "Không có sự kiện này" : !once(s, "ranch") ? "Mỗi lượt 1 lần" : null;
      if (err) break;
      const cards = (a.cards ?? []).filter((c, i, arr) => arr.indexOf(c) === i && p.hand.includes(c));
      if (!cards.length) {
        err = "Chọn lá muốn đổi";
        break;
      }
      for (const c of cards) fromHand(s, id, c);
      toDiscard(s, ...cards);
      draw(s, id, cards.length, random);
      used(s, "ranch");
      break;
    }
    default:
      err = "Sức mạnh không hợp lệ";
  }
  if (err) return fail(err);
  suzy(s, random);
  run(s, now, names, random);
  return OK;
}

// ─── Gold Rush ─────────────────────────────────────────────────────

export function gearCost(s: BangState, id: string, key: GearKey): number {
  const discount = hasAb(s, id, "luzena") && once(s, "luzena") ? 1 : 0;
  return Math.max(0, GEAR[key].cost - discount);
}

export function buyGear(s: BangState, id: string, a: { slot: number; target?: string; pick?: PickSpec; mode?: string }, now: number, names: NameOf, random: Random = Math.random): Result {
  const turn = s.turn;
  return busy(s, now, turn, buyGearInner(s, id, a, now, names, random));
}

function buyGearInner(s: BangState, id: string, a: { slot: number; target?: string; pick?: PickSpec; mode?: string }, now: number, names: NameOf, random: Random): Result {
  const bad = myMove(s, id);
  if (bad) return fail(bad);
  if (!s.packs.includes("goldrush")) return fail("Không chơi Cơn Sốt Vàng");
  const key = s.shop[a.slot];
  if (!key) return fail("Không có món đó");
  const p = s.ps[id];
  const cost = gearCost(s, id, key);
  if (p.gold < cost) return fail(`Cần ${cost} vàng`);
  if (GEAR[key].kind === "keep" && key !== "wanted" && hasGear(s, id, key)) return fail("Bạn đã có món này");
  const err = checkGear(s, id, key, a);
  if (err) return fail(err);
  p.gold -= cost;
  if (hasAb(s, id, "luzena") && cost < GEAR[key].cost) used(s, "luzena");
  s.shop.splice(a.slot, 1);
  if (s.shopDeck.length) s.shop.splice(a.slot, 0, s.shopDeck.shift()!);
  while (s.shop.length > SHOP_SLOTS) s.shop.pop();
  log(s, now, `${names(id)} mua ${GEAR[key].emoji} ${GEAR[key].name} (${cost} vàng)`, "gold");
  s.turn!.played += 1;
  gainGear(s, id, key, a, now, names, random);
  suzy(s, random);
  run(s, now, names, random);
  return OK;
}

function checkGear(s: BangState, id: string, key: GearKey, a: { target?: string; pick?: PickSpec; mode?: string }): string | null {
  if (key === "bottle") {
    if (a.mode === "panic") return checkTarget(s, id, a.target, "dist1", null) ?? checkPick(s, a.target!, a.pick);
    if (a.mode === "bang") return checkTarget(s, id, a.target, "range", null);
    if (a.mode === "beer") return s.ps[id].life >= s.ps[id].max ? "Bạn đang đầy máu" : has(s, "reverend") ? "Mục Sư: không được uống Bia" : has(s, "hangover") ? "Say Xỉn: Bia không có tác dụng" : !beerWorks(s) ? "Chỉ còn 2 người: Bia vô dụng" : null;
    return "Chọn cách dùng Chai Rượu";
  }
  if (key === "pardner") {
    if (a.mode === "duel") return checkTarget(s, id, a.target, "any", null);
    if (a.mode === "cat") return checkTarget(s, id, a.target, "any", null) ?? checkPick(s, a.target!, a.pick);
    if (a.mode === "store") return null;
    return "Chọn cách dùng Bạn Đồng Hành";
  }
  if (key === "wanted") {
    const t = a.target;
    if (!t || t === id || !alive(s, t)) return "Chọn người để treo Truy Nã";
    if (s.ps[t].gear.some((g) => g.key === "wanted")) return "Người đó đã bị Truy Nã";
  }
  return null;
}

function gainGear(s: BangState, id: string, key: GearKey, a: { target?: string; pick?: PickSpec; mode?: string }, now: number, names: NameOf, random: Random): string | null {
  const p = s.ps[id];
  switch (key) {
    case "bottle":
      if (a.mode === "panic") aimedEffect(s, id, "bottle-panic", a.target!, a.pick, "Chai Rượu", now, null);
      else if (a.mode === "bang") later(s, shot(s, id, a.target!, now, { cause: "Chai Rượu", bang: true }));
      else {
        heal(s, id, 1);
        beerSideEffects(s, id, now, names, random);
      }
      return null;
    case "pardner":
      if (a.mode === "duel") later(s, { kind: "react", to: a.target!, from: id, answer: "bang", cause: "Đấu Tay Đôi", need: 1, dmg: 1, duel: id, evadable: true, deadline: until(s, now) });
      else if (a.mode === "cat") aimedEffect(s, id, "pardner-cat", a.target!, a.pick, "Bạn Đồng Hành", now, null);
      else resolve(s, id, "generalstore", null, {}, { dmg: 1, need: 1 }, now, names, random);
      return null;
    case "rum": {
      const suits = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const c = takeTop(s, random);
        if (c === null) break;
        suits.add(effSuit(s, c));
        toDiscard(s, c);
      }
      const n = heal(s, id, suits.size);
      log(s, now, `${names(id)} lật được ${suits.size} chất — hồi ${n} máu`, "heal");
      return null;
    }
    case "unionpacific":
      draw(s, id, 4, random);
      return null;
    case "goldfever":
      heal(s, id, p.max);
      endTurn(s, id, { discard: autoDiscard(s, id) }, now, names, random);
      return null;
    case "wanted":
      if (a.target) s.ps[a.target].gear.push({ key, from: id });
      return null;
    default:
      if (!hasGear(s, id, key)) p.gear.push({ key });
      return null;
  }
}

// ─── Phase 1 ────────────────────────────────────────────────────────

export function drawCommand(s: BangState, id: string, mode: DrawMode | undefined, args: DrawArgs, now: number, names: NameOf, random: Random = Math.random): Result {
  const head = s.queue[0];
  if (!head || head.kind !== "draw" || head.to !== id) return fail("Không phải lúc rút bài");
  const m = mode ?? "normal";
  if (!head.options.includes(m)) return fail("Cách rút không hợp lệ");
  const snapshot = JSON.stringify(s);
  s.queue.shift();
  const res = drawPhase(s, id, m, args, now, names, random);
  if (!res.ok) {
    Object.assign(s, JSON.parse(snapshot));
    return res;
  }
  run(s, now, names, random);
  return OK;
}

// ─── Answering prompts ─────────────────────────────────────────────

export interface RespondArgs {
  cards?: number[];
  take?: boolean;
  card?: number;
  choice?: string;
}

/** Molly draws for every card she plays outside her turn. */
function molly(s: BangState, id: string, n: number, random: Random) {
  if (n > 0 && s.turn?.player !== id && hasAb(s, id, "molly")) draw(s, id, n, random);
}

/** Remove answer cards from hand / play; true if all were available. */
function spend(s: BangState, id: string, cards: number[]): boolean {
  const p = s.ps[id];
  for (const c of cards) if (!p.hand.includes(c) && !p.play.some((x) => x.id === c)) return false;
  for (const c of cards) {
    if (!fromHand(s, id, c)) fromPlay(s, id, c);
    toDiscard(s, c);
  }
  return true;
}

export function respond(s: BangState, id: string, a: RespondArgs, now: number, names: NameOf, random: Random = Math.random): Result {
  const head = s.queue[0];
  if (!head || !isInteractive(head) || head.to !== id) return fail("Không có gì cần bạn trả lời");
  const p = s.ps[id];
  switch (head.kind) {
    case "react":
      return answerReact(s, head, a, now, names, random);
    case "save": {
      done(s, now);
      const savedCard = p.hand.find((c) => keyOf(c) === "saved");
      if (!a.take && savedCard !== undefined) {
        fromHand(s, id, savedCard);
        toDiscard(s, savedCard);
        const wouldDie = s.ps[head.target].life <= head.amount;
        log(s, now, `😇 ${names(id)} cứu ${names(head.target)}`, "heal");
        if (wouldDie) draw(s, id, 2, random);
        molly(s, id, 1, random);
        if (head.amount - 1 > 0) now_(s, { kind: "hurt", to: head.target, from: head.from, amount: head.amount - 1, ...(head.shot ? { shot: true } : {}), asked: head.asked });
      } else {
        now_(s, { kind: "hurt", to: head.target, from: head.from, amount: head.amount, ...(head.shot ? { shot: true } : {}), asked: head.asked });
      }
      break;
    }
    case "store": {
      const c = a.card ?? head.cards[0];
      if (!head.cards.includes(c)) return fail("Chọn 1 lá trong Tạp Hoá");
      done(s, now);
      p.hand.push(c);
      const rest = head.cards.filter((x) => x !== c);
      const order = head.order.filter((o) => present(s, o));
      if (rest.length && order.length) now_(s, { kind: "store", to: order[0], cards: rest, order: order.slice(1), deadline: until(s, now) });
      else toDiscard(s, ...rest);
      break;
    }
    case "pick": {
      const from = head.from;
      const pick: PickSpec = a.card !== undefined ? { zone: "play", card: a.card } : { zone: "hand" };
      const err = checkPick(s, from, pick);
      if (err && s.ps[from].hand.length + s.ps[from].play.length > 0) return fail(err);
      done(s, now);
      const c = err ? null : takeByPick(s, from, pick, random);
      if (c !== null) {
        toDiscard(s, c);
        log(s, now, `${names(from)} bỏ ${cardName(c)}`, "info");
        loseGhost(s, from, c, now, names);
        henryPunish(s, from, id, now);
      }
      break;
    }
    case "keep": {
      const keep = (a.cards ?? []).filter((c, i, arr) => arr.indexOf(c) === i && head.cards.includes(c));
      if (keep.length !== head.keep) return fail(`Chọn đúng ${head.keep} lá để giữ`);
      done(s, now);
      p.hand.push(...keep);
      const rest = head.cards.filter((c) => !keep.includes(c));
      if (head.cause === "kit") s.deck.unshift(...rest);
      else if (head.cause === "poker") toDiscard(s, ...rest);
      else {
        toDiscard(s, ...rest);
        p.gold += 1;
      }
      break;
    }
    case "discard": {
      if (head.cause === "poker") {
        const c = a.card ?? a.cards?.[0];
        if (c === undefined || !p.hand.includes(c)) return fail("Chọn 1 lá để úp");
        done(s, now);
        fromHand(s, id, c);
        const pot = s.queue.find((e) => e.kind === "pokerEnd" && e.to === head.pool) as Extract<QEntry, { kind: "pokerEnd" }> | undefined;
        if (pot) pot.pool.push(c);
        else toDiscard(s, c);
        break;
      }
      if (a.take || p.hand.length < head.count) {
        done(s, now);
        now_(s, { kind: "hurt", to: id, from: s.turn?.player ?? null, amount: head.orLose });
        break;
      }
      const cards = handCards(s, id, a.cards, head.count);
      if (!cards) return fail(`Chọn đúng ${head.count} lá để bỏ`);
      done(s, now);
      for (const c of cards) fromHand(s, id, c);
      toDiscard(s, ...cards);
      break;
    }
    case "copy": {
      const choice = a.choice as CharKey | undefined;
      if (!choice || !head.options.includes(choice)) return fail("Chọn 1 nhân vật");
      done(s, now);
      p.borrowed = [choice];
      log(s, now, `${names(id)} bắt chước ${CHARACTERS[choice].name}`, "info");
      break;
    }
    case "draw":
      return fail("Hãy chọn cách rút bài");
  }
  suzy(s, random);
  run(s, now, names, random);
  return OK;
}

function answerReact(s: BangState, q: React, a: RespondArgs, now: number, names: NameOf, random: Random): Result {
  const id = q.to;
  const p = s.ps[id];
  if (a.take) {
    done(s, now);
    took(s, q, now, names, random);
    suzy(s, random);
    run(s, now, names, random);
    return OK;
  }
  const cards = (a.cards ?? (a.card !== undefined ? [a.card] : [])).filter((c, i, arr) => arr.indexOf(c) === i);
  if (!cards.length) return fail("Chọn lá để đỡ, hoặc chịu đòn");

  // Chuồn / Mích: cancel the whole card behind this prompt.
  const isEscape = cards.length === 1 && p.hand.includes(cards[0]) && keyOf(cards[0]) === "escape";
  const mickEvade = hasAb(s, id, "mick") && cards.length === 1 && missedCards(s, id).includes(cards[0]);
  if ((q.answer === "evade" || q.evadable) && (isEscape || (mickEvade && q.answer !== "missed"))) {
    if (!spend(s, id, cards)) return fail("Bạn không có lá đó");
    done(s, now);
    dropGroup(s, q.group);
    log(s, now, `${names(id)} chuồn khỏi ${q.cause}`, "info");
    molly(s, id, 1, random);
    suzy(s, random);
    run(s, now, names, random);
    return OK;
  }
  if (q.answer === "evade") return fail("Dùng Chuồn (hoặc Trượt! nếu là Mích) để né, hoặc bỏ qua");

  if (q.answer === "missed") {
    if (q.unmissable) return fail("Phát này không thể né");
    const ok = missedCards(s, id, q);
    if (cards.length !== q.need || !cards.every((c) => ok.includes(c))) return fail(`Cần ${q.need} lá Trượt!`);
  } else {
    const ok = beatCards(s, id);
    if (cards.length !== q.need || !cards.every((c) => ok.includes(c))) return fail("Cần đánh 1 lá BANG!");
  }
  const keys = cards.map((c) => keyOf(c));
  if (!spend(s, id, cards)) return fail("Bạn không có lá đó");
  done(s, now);
  log(s, now, `${names(id)} đỡ bằng ${cards.map(cardName).join(", ")}`, "info");
  for (const [i, k] of keys.entries()) {
    if (k === "dodge" || k === "bible") draw(s, id, 1, random);
    if (k === "duck" && p.cubes > 0) {
      p.cubes -= 1;
      const c = cards[i];
      s.discard.splice(s.discard.indexOf(c), 1);
      p.hand.push(c);
    }
    if (k === "backfire" && q.from && present(s, q.from)) {
      later(s, { kind: "react", to: q.from, from: id, answer: "missed", cause: "Phản Đòn", need: 1, dmg: 1, deadline: until(s, now) });
    }
  }
  molly(s, id, cards.length, random);
  avoided(s, q, now, names, random);
  suzy(s, random);
  run(s, now, names, random);
  return OK;
}

// ─── Ending the turn ───────────────────────────────────────────────

/** Cards to throw away to get down to the hand limit (the last ones in hand). */
export function autoDiscard(s: BangState, id: string): number[] {
  const p = s.ps[id];
  const over = p.hand.length - handLimit(s, id);
  return over > 0 ? p.hand.slice(-over) : [];
}

export function endTurn(s: BangState, id: string, a: { discard?: number[] }, now: number, names: NameOf, random: Random = Math.random): Result {
  if (s.turn?.player !== id || s.status !== "playing") return fail("Chưa tới lượt bạn");
  if (s.turn.step !== "play" || s.queue.length) return fail("Chưa thể kết thúc lượt");
  const p = s.ps[id];
  const list = (a.discard ?? []).filter((c, i, arr) => arr.indexOf(c) === i);
  if (!list.every((c) => p.hand.includes(c))) return fail("Lá bỏ không hợp lệ");
  const need = Math.max(0, p.hand.length - handLimit(s, id));
  if (list.length < need) return fail(`Phải bỏ ${need} lá (giữ tối đa ${handLimit(s, id)})`);
  if (list.length > need && !s.packs.includes("goldrush")) return fail(`Chỉ cần bỏ ${need} lá`);
  for (const c of list) fromHand(s, id, c);
  const gary = s.order.find((o) => o !== id && present(s, o) && hasAb(s, o, "gary"));
  if (gary && list.length) s.ps[gary].hand.push(...list);
  else toDiscard(s, ...list);
  if (s.packs.includes("goldrush") && list.length) {
    p.gold += list.length;
    log(s, now, `${names(id)} bỏ ${list.length} lá, được ${list.length} vàng`, "gold");
  }
  s.turn.step = "play";
  passTurn(s, now, names, random);
  run(s, now, names, random);
  return OK;
}

// ─── Auto-play ─────────────────────────────────────────────────────

/** Answer for a player who timed out or went offline — sensible, never clever. */
export function autoAnswer(s: BangState, who: string, now: number, names: NameOf, random: Random) {
  const head = s.queue[0];
  if (head && isInteractive(head) && head.to === who) {
    const p = s.ps[who];
    let res: Result = fail("");
    switch (head.kind) {
      case "react": {
        if (head.answer === "missed" && !head.unmissable) {
          const ok = missedCards(s, who, head);
          // Green cards in play first (they're only good for this), then Trượt! cards.
          const ordered = [...ok.filter((c) => !p.hand.includes(c)), ...ok.filter((c) => p.hand.includes(c) && typeOf(c).isMissed), ...ok.filter((c) => p.hand.includes(c) && !typeOf(c).isMissed)];
          if (ordered.length >= head.need) res = answerReact(s, head, { cards: ordered.slice(0, head.need) }, now, names, random);
        } else if (head.answer === "bang") {
          const ok = beatCards(s, who);
          if (ok.length >= head.need) res = answerReact(s, head, { cards: ok.slice(0, head.need) }, now, names, random);
        } else if (head.answer === "evade") {
          const esc = p.hand.find((c) => keyOf(c) === "escape");
          if (esc !== undefined) res = answerReact(s, head, { cards: [esc] }, now, names, random);
        }
        if (!res.ok) answerReact(s, head, { take: true }, now, names, random);
        return;
      }
      case "save":
        respond(s, who, { take: true }, now, names, random);
        return;
      case "store":
        respond(s, who, { card: head.cards[0] }, now, names, random);
        return;
      case "pick": {
        const from = s.ps[head.from];
        respond(s, who, from.hand.length ? {} : { card: from.play[0]?.id }, now, names, random);
        return;
      }
      case "keep":
        respond(s, who, { cards: head.cards.slice(0, head.keep) }, now, names, random);
        return;
      case "discard":
        if (head.cause === "poker") respond(s, who, { card: p.hand[0] }, now, names, random);
        else if (p.life > 1 || p.hand.length < head.count) respond(s, who, { take: true }, now, names, random);
        else respond(s, who, { cards: p.hand.slice(0, head.count) }, now, names, random);
        return;
      case "copy":
        respond(s, who, { choice: head.options[Math.floor(random() * head.options.length)] }, now, names, random);
        return;
      case "draw":
        drawCommand(s, who, "normal", {}, now, names, random);
        return;
    }
  }
  if (s.turn?.player === who && s.turn.step === "play" && !s.queue.length) {
    log(s, now, `${names(who)} hết giờ — tự kết thúc lượt`, "info");
    endTurn(s, who, { discard: autoDiscard(s, who) }, now, names, random);
  }
}

/** For the view: may this player activate this ability now? (loose — the server re-checks). */
export function abilityList(s: BangState, id: string): string[] {
  const out: string[] = [];
  const ab = abilities(s, id);
  for (const k of ["sid", "chuck", "doc", "jose", "flint", "leevan", "jacky", "mexicali", "josh", "raddie", "blackflower", "derspot", "bass", "frankie", "redringo"] as CharKey[]) {
    if (ab.includes(k)) out.push(k);
  }
  if (hasGear(s, id, "goldpan")) out.push("goldpan");
  if (has(s, "dorothy")) out.push("dorothy");
  if (has(s, "ladyrose")) out.push("ladyrose");
  if (has(s, "ranch")) out.push("ranch");
  return out;
}

export { flip, cardName };
