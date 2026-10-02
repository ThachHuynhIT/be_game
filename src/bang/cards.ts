/**
 * Đấu Súng (a Bang!-style game) — card, character, role and event data.
 * Mechanics follow the classic game and its expansions; names, texts and emoji are our own.
 * Copied verbatim to the portfolio (src/lib/bang/cards.ts) — keep it dependency-free.
 */

export type Suit = "S" | "H" | "D" | "C";
export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const isRedSuit = (s: Suit) => s === "H" || s === "D";
/** 2..10, J = 11, Q = 12, K = 13, A = 14. */
export const rankLabel = (r: number) => (r <= 10 ? String(r) : ["J", "Q", "K", "A"][r - 11]);

export type Pack = "base" | "dodge" | "highnoon" | "fistful" | "wws" | "goldrush" | "valley" | "armed";
/** Packs the host can switch on (the base game is always in). */
export const EXPANSIONS: Exclude<Pack, "base">[] = ["dodge", "highnoon", "fistful", "wws", "goldrush", "valley", "armed"];

export const PACKS: Record<Pack, { name: string; emoji: string; blurb: string }> = {
  base: { name: "Bộ gốc", emoji: "🤠", blurb: "Cảnh sát trưởng, phó, kẻ cướp và kẻ phản bội." },
  dodge: { name: "Thị trấn Né Đạn", emoji: "🏙️", blurb: "Lá xanh lá (dùng từ lượt sau), lá phải bỏ kèm 1 lá, 15 nhân vật." },
  highnoon: { name: "Giữa Trưa", emoji: "🌞", blurb: "Bộ lá sự kiện: mỗi vòng một luật mới, kết thúc bằng Giữa Trưa." },
  fistful: { name: "Nắm Bài", emoji: "✊", blurb: "Bộ lá sự kiện thứ hai: phục kích, cò quay, bắn tỉa… kết thúc bằng Nắm Bài." },
  wws: { name: "Gánh Xiếc Miền Tây", emoji: "🎪", blurb: "Sự kiện gánh xiếc và 8 nhân vật kỳ quặc." },
  goldrush: { name: "Cơn Sốt Vàng", emoji: "💰", blurb: "Kiếm vàng khi bỏ bài, mua trang bị ở cửa hàng, 8 nhân vật." },
  valley: { name: "Thung Lũng Bóng Ma", emoji: "👻", blurb: "Hồn ma, rắn chuông, súng hoa cải, cứu nguy… và 8 nhân vật." },
  armed: { name: "Trang Bị Tận Răng", emoji: "🧨", blurb: "Đạn (khối vàng) nạp lên lá bài để kích hoạt sức mạnh, 8 nhân vật." },
};

// ─── Cards ──────────────────────────────────────────────────────────

/** brown = play and discard · blue = stays in front of you · green = in front of you, discard to use from your next turn. */
export type Color = "brown" | "blue" | "green";

export type CardKey =
  // base
  | "bang" | "missed" | "beer" | "panic" | "catbalou" | "stagecoach" | "wellsfargo" | "generalstore" | "indians" | "duel" | "gatling" | "saloon"
  | "barrel" | "scope" | "mustang" | "jail" | "dynamite" | "volcanic" | "schofield" | "remington" | "carabine" | "winchester"
  // dodge city
  | "punch" | "dodge" | "springfield" | "whisky" | "tequila" | "ragtime" | "brawl" | "binocular" | "hideout"
  | "bible" | "ironplate" | "sombrero" | "tengallon" | "canteen" | "cancan" | "conestoga" | "derringer" | "knife" | "pepperbox" | "buffalo" | "howitzer" | "ponyexpress"
  // valley of shadows
  | "aim" | "backfire" | "bandidas" | "escape" | "fanning" | "lastcall" | "poker" | "saved" | "tomahawk" | "tornado"
  | "bounty" | "ghost" | "lemat" | "rattlesnake" | "shotgun"
  // armed & dangerous
  | "reload" | "quickshot" | "flintlock" | "lockpick" | "duck" | "nip" | "squaw" | "bandolier" | "belltower" | "bigfifty" | "doublebarrel" | "buntline";

/**
 * How a card picks its target:
 *  range = a player within your weapon range · dist1 / dist2 = at most that distance · any = anyone else
 *  anyone = any living player, you included · none = no target.
 */
export type Aim = "range" | "dist1" | "dist2" | "any" | "anyone" | "none";

export interface CardType {
  key: CardKey;
  name: string;
  emoji: string;
  color: Color;
  pack: Pack;
  text: string;
  aim: Aim;
  /** Weapons: reach. */
  range?: number;
  /** A BANG! card: limited to one per turn, answered with Trượt!. */
  isBang?: boolean;
  /** Counts as a Trượt! when answering an attack. */
  isMissed?: boolean;
  /** Dodge City: you must also discard one other card from your hand to play it. */
  cost?: boolean;
  /** Blue / green cards that can target another player (Jail, Rattlesnake, Bounty, Ghost). */
  placeOn?: "other" | "dead";
  /** Armed & Dangerous: cubes (đạn) the card arrives with. */
  load?: number;
}

const C = (t: CardType) => t;

export const CARD_TYPES: Record<CardKey, CardType> = {
  // ── Base: brown
  bang: C({ key: "bang", name: "BANG!", emoji: "💥", color: "brown", pack: "base", aim: "range", isBang: true, text: "Bắn 1 người trong tầm súng. Họ phải đánh Trượt! nếu không muốn mất 1 máu. Mỗi lượt chỉ 1 lá BANG!." }),
  missed: C({ key: "missed", name: "Trượt!", emoji: "🙅", color: "brown", pack: "base", aim: "none", isMissed: true, text: "Đánh ra khi bị bắn để né 1 phát." }),
  beer: C({ key: "beer", name: "Bia", emoji: "🍺", color: "brown", pack: "base", aim: "none", text: "Hồi 1 máu. Vô dụng khi chỉ còn 2 người. Sắp chết thì tự động uống để cứu mạng." }),
  panic: C({ key: "panic", name: "Hoảng Loạn", emoji: "😱", color: "brown", pack: "base", aim: "dist1", text: "Lấy 1 lá (trên tay hoặc trước mặt) của người ở khoảng cách 1." }),
  catbalou: C({ key: "catbalou", name: "Quậy Phá", emoji: "💃", color: "brown", pack: "base", aim: "any", text: "Bắt 1 người bất kỳ bỏ 1 lá (trên tay hoặc trước mặt)." }),
  stagecoach: C({ key: "stagecoach", name: "Xe Ngựa", emoji: "🐴", color: "brown", pack: "base", aim: "none", text: "Rút 2 lá." }),
  wellsfargo: C({ key: "wellsfargo", name: "Ngân Hàng", emoji: "🏦", color: "brown", pack: "base", aim: "none", text: "Rút 3 lá." }),
  generalstore: C({ key: "generalstore", name: "Tạp Hoá", emoji: "🏪", color: "brown", pack: "base", aim: "none", text: "Lật số lá bằng số người còn sống; lần lượt từ bạn, mỗi người chọn 1 lá." }),
  indians: C({ key: "indians", name: "Da Đỏ!", emoji: "🪶", color: "brown", pack: "base", aim: "none", text: "Mọi người khác phải bỏ 1 lá BANG! hoặc mất 1 máu." }),
  duel: C({ key: "duel", name: "Đấu Tay Đôi", emoji: "🤺", color: "brown", pack: "base", aim: "any", text: "Bạn và 1 người bất kỳ thay phiên bỏ lá BANG! (họ bỏ trước). Ai không bỏ được thì mất 1 máu." }),
  gatling: C({ key: "gatling", name: "Súng Máy", emoji: "🔫", color: "brown", pack: "base", aim: "none", text: "Bắn mọi người khác (không tính khoảng cách). Không phải lá BANG!." }),
  saloon: C({ key: "saloon", name: "Quán Rượu", emoji: "🥃", color: "brown", pack: "base", aim: "none", text: "Mọi người còn sống hồi 1 máu." }),
  // ── Base: blue
  barrel: C({ key: "barrel", name: "Thùng Gỗ", emoji: "🛢️", color: "blue", pack: "base", aim: "none", text: "Khi bị bắn: rút! — ra ♥ thì coi như đã Trượt!." }),
  scope: C({ key: "scope", name: "Ống Ngắm", emoji: "🔭", color: "blue", pack: "base", aim: "none", text: "Bạn nhìn người khác gần hơn 1." }),
  mustang: C({ key: "mustang", name: "Ngựa Hoang", emoji: "🐎", color: "blue", pack: "base", aim: "none", text: "Người khác nhìn bạn xa hơn 1." }),
  jail: C({ key: "jail", name: "Nhà Giam", emoji: "⛓️", color: "blue", pack: "base", aim: "any", placeOn: "other", text: "Đặt trước mặt người khác (không phải Cảnh sát trưởng). Đầu lượt họ rút!: ra ♥ thì thoát, không thì mất lượt." }),
  dynamite: C({ key: "dynamite", name: "Thuốc Nổ", emoji: "🧨", color: "blue", pack: "base", aim: "none", text: "Đầu lượt rút!: ra ♠ 2–9 thì nổ, mất 3 máu; không thì chuyền sang người kế tiếp." }),
  volcanic: C({ key: "volcanic", name: "Súng Liên Thanh", emoji: "🌋", color: "blue", pack: "base", aim: "none", range: 1, text: "Tầm 1. Bắn BANG! không giới hạn số lần." }),
  schofield: C({ key: "schofield", name: "Súng Lục Dài", emoji: "🔫", color: "blue", pack: "base", aim: "none", range: 2, text: "Súng tầm 2." }),
  remington: C({ key: "remington", name: "Súng Trường Nhẹ", emoji: "🔫", color: "blue", pack: "base", aim: "none", range: 3, text: "Súng tầm 3." }),
  carabine: C({ key: "carabine", name: "Súng Cạc-bin", emoji: "🔫", color: "blue", pack: "base", aim: "none", range: 4, text: "Súng tầm 4." }),
  winchester: C({ key: "winchester", name: "Súng Săn Dài", emoji: "🎯", color: "blue", pack: "base", aim: "none", range: 5, text: "Súng tầm 5." }),

  // ── Dodge City: brown (cost = discard one more card)
  punch: C({ key: "punch", name: "Đấm", emoji: "👊", color: "brown", pack: "dodge", aim: "dist1", isBang: true, text: "Một phát BANG! vào người ở khoảng cách 1 (tính là lá BANG!)." }),
  dodge: C({ key: "dodge", name: "Né", emoji: "🤸", color: "brown", pack: "dodge", aim: "none", isMissed: true, text: "Như Trượt!, rồi rút 1 lá." }),
  springfield: C({ key: "springfield", name: "Súng Trường Xa", emoji: "🎯", color: "brown", pack: "dodge", aim: "any", cost: true, text: "Bỏ kèm 1 lá: bắn 1 người ở bất kỳ khoảng cách nào (không tính giới hạn BANG!)." }),
  whisky: C({ key: "whisky", name: "Whisky", emoji: "🥃", color: "brown", pack: "dodge", aim: "none", cost: true, text: "Bỏ kèm 1 lá: hồi 2 máu." }),
  tequila: C({ key: "tequila", name: "Tequila", emoji: "🍹", color: "brown", pack: "dodge", aim: "anyone", cost: true, text: "Bỏ kèm 1 lá: 1 người bất kỳ (kể cả bạn) hồi 1 máu." }),
  ragtime: C({ key: "ragtime", name: "Nhạc Ragtime", emoji: "🎹", color: "brown", pack: "dodge", aim: "any", cost: true, text: "Bỏ kèm 1 lá: lấy 1 lá của người ở bất kỳ khoảng cách nào." }),
  brawl: C({ key: "brawl", name: "Ẩu Đả", emoji: "🥊", color: "brown", pack: "dodge", aim: "none", cost: true, text: "Bỏ kèm 1 lá: mọi người khác bỏ 1 lá (bạn chọn lá của từng người)." }),
  // ── Dodge City: blue
  binocular: C({ key: "binocular", name: "Ống Nhòm", emoji: "🔭", color: "blue", pack: "dodge", aim: "none", text: "Bạn nhìn người khác gần hơn 1." }),
  hideout: C({ key: "hideout", name: "Hang Ẩn Nấp", emoji: "🕳️", color: "blue", pack: "dodge", aim: "none", text: "Người khác nhìn bạn xa hơn 1." }),
  // ── Dodge City: green (usable from your next turn, discard to use)
  bible: C({ key: "bible", name: "Kinh Thánh", emoji: "📖", color: "green", pack: "dodge", aim: "none", isMissed: true, text: "Bỏ ra như Trượt!, rồi rút 1 lá." }),
  ironplate: C({ key: "ironplate", name: "Giáp Sắt", emoji: "🛡️", color: "green", pack: "dodge", aim: "none", isMissed: true, text: "Bỏ ra như Trượt!." }),
  sombrero: C({ key: "sombrero", name: "Mũ Rộng Vành", emoji: "👒", color: "green", pack: "dodge", aim: "none", isMissed: true, text: "Bỏ ra như Trượt!." }),
  tengallon: C({ key: "tengallon", name: "Mũ Cao Bồi", emoji: "🤠", color: "green", pack: "dodge", aim: "none", isMissed: true, text: "Bỏ ra như Trượt!." }),
  canteen: C({ key: "canteen", name: "Bi Đông", emoji: "🧉", color: "green", pack: "dodge", aim: "none", text: "Bỏ ra (trong lượt): hồi 1 máu." }),
  cancan: C({ key: "cancan", name: "Múa Cancan", emoji: "💃", color: "green", pack: "dodge", aim: "any", text: "Bỏ ra (trong lượt): như Quậy Phá." }),
  conestoga: C({ key: "conestoga", name: "Xe Thồ", emoji: "🛻", color: "green", pack: "dodge", aim: "any", text: "Bỏ ra (trong lượt): như Hoảng Loạn, không tính khoảng cách." }),
  derringer: C({ key: "derringer", name: "Súng Bỏ Túi", emoji: "🔫", color: "green", pack: "dodge", aim: "dist1", text: "Bỏ ra (trong lượt): bắn người ở khoảng cách 1, rồi rút 1 lá." }),
  knife: C({ key: "knife", name: "Dao Găm", emoji: "🔪", color: "green", pack: "dodge", aim: "dist1", text: "Bỏ ra (trong lượt): bắn người ở khoảng cách 1." }),
  pepperbox: C({ key: "pepperbox", name: "Súng Ổ Xoay", emoji: "🔫", color: "green", pack: "dodge", aim: "range", text: "Bỏ ra (trong lượt): bắn người trong tầm súng." }),
  buffalo: C({ key: "buffalo", name: "Súng Săn Bò", emoji: "🦬", color: "green", pack: "dodge", aim: "any", text: "Bỏ ra (trong lượt): bắn người ở bất kỳ khoảng cách nào." }),
  howitzer: C({ key: "howitzer", name: "Đại Bác", emoji: "💣", color: "green", pack: "dodge", aim: "none", text: "Bỏ ra (trong lượt): như Súng Máy." }),
  ponyexpress: C({ key: "ponyexpress", name: "Ngựa Trạm", emoji: "🏇", color: "green", pack: "dodge", aim: "none", text: "Bỏ ra (trong lượt): rút 3 lá." }),

  // ── Valley of Shadows: brown
  aim: C({ key: "aim", name: "Nhắm Kỹ", emoji: "🎯", color: "brown", pack: "valley", aim: "none", text: "Đánh cùng 1 lá BANG!: phát đó gây 2 máu." }),
  backfire: C({ key: "backfire", name: "Phản Đòn", emoji: "↩️", color: "brown", pack: "valley", aim: "none", isMissed: true, text: "Như Trượt!, và kẻ bắn bạn bị bắn lại 1 phát." }),
  bandidas: C({ key: "bandidas", name: "Nữ Cướp", emoji: "👯", color: "brown", pack: "valley", aim: "none", text: "Mỗi người khác chọn: bỏ 2 lá trên tay hoặc mất 1 máu." }),
  escape: C({ key: "escape", name: "Chuồn", emoji: "🏃", color: "brown", pack: "valley", aim: "none", text: "Ngoài lượt: né 1 lá nâu nhắm vào bạn mà không phải BANG! (Hoảng Loạn, Quậy Phá, Đấu Tay Đôi, Da Đỏ…)." }),
  fanning: C({ key: "fanning", name: "Bắn Quạt", emoji: "🌀", color: "brown", pack: "valley", aim: "range", isBang: true, text: "Tính là lá BANG!: bắn 1 người trong tầm, và thêm 1 người ở khoảng cách 1 từ người đó." }),
  lastcall: C({ key: "lastcall", name: "Ly Cuối", emoji: "🍷", color: "brown", pack: "valley", aim: "none", text: "Hồi 1 máu, kể cả khi chỉ còn 2 người." }),
  poker: C({ key: "poker", name: "Xì Phé", emoji: "🃏", color: "brown", pack: "valley", aim: "none", text: "Mỗi người khác úp bỏ 1 lá trên tay. Nếu không có lá A nào, bạn lấy tối đa 2 lá trong số đó." }),
  saved: C({ key: "saved", name: "Cứu Nguy", emoji: "😇", color: "brown", pack: "valley", aim: "none", text: "Ngoài lượt: khi 1 người khác sắp mất máu, chặn 1 máu cho họ. Nếu vừa cứu họ khỏi chết, bạn rút 2 lá." }),
  tomahawk: C({ key: "tomahawk", name: "Rìu Ném", emoji: "🪓", color: "brown", pack: "valley", aim: "dist2", text: "Tấn công người ở khoảng cách tối đa 2 (không phải lá BANG!)." }),
  tornado: C({ key: "tornado", name: "Lốc Xoáy", emoji: "🌪️", color: "brown", pack: "valley", aim: "none", text: "Mọi người bỏ 1 lá trên tay (nếu có) rồi rút 2 lá." }),
  // ── Valley of Shadows: blue
  bounty: C({ key: "bounty", name: "Treo Thưởng", emoji: "💵", color: "blue", pack: "valley", aim: "any", placeOn: "other", text: "Đặt lên người khác: ai bắn trúng họ bằng BANG! thì rút 1 lá." }),
  ghost: C({ key: "ghost", name: "Hồn Ma", emoji: "👻", color: "blue", pack: "valley", aim: "any", placeOn: "dead", text: "Đặt lên người đã chết: họ chơi tiếp như hồn ma (không mất máu được) cho tới khi lá này bị bỏ." }),
  lemat: C({ key: "lemat", name: "Súng Hai Cỡ", emoji: "🔫", color: "blue", pack: "valley", aim: "none", range: 1, text: "Tầm 1. Trong lượt, lá nào cũng dùng được như BANG!." }),
  rattlesnake: C({ key: "rattlesnake", name: "Rắn Chuông", emoji: "🐍", color: "blue", pack: "valley", aim: "any", placeOn: "other", text: "Đặt lên người khác: đầu mỗi lượt của họ rút!, ra ♠ thì mất 1 máu." }),
  shotgun: C({ key: "shotgun", name: "Súng Hoa Cải", emoji: "💥", color: "blue", pack: "valley", aim: "none", range: 1, text: "Tầm 1. BANG! của bạn bắn trúng thì người đó bỏ 1 lá trên tay." }),

  // ── Armed & Dangerous: brown
  reload: C({ key: "reload", name: "Nạp Đạn", emoji: "🔋", color: "brown", pack: "armed", aim: "none", text: "Thêm 3 viên đạn lên các lá trước mặt bạn (và thẻ nhân vật)." }),
  quickshot: C({ key: "quickshot", name: "Bắn Nhanh", emoji: "⚡", color: "brown", pack: "armed", aim: "range", isBang: true, text: "Tính là lá BANG!: bắn 2 người khác nhau trong tầm." }),
  flintlock: C({ key: "flintlock", name: "Súng Kíp", emoji: "🔫", color: "brown", pack: "armed", aim: "range", isBang: true, text: "Tính là lá BANG!. Nếu bị né, lá này quay lại tay bạn." }),
  lockpick: C({ key: "lockpick", name: "Bẻ Khoá", emoji: "🗝️", color: "brown", pack: "armed", aim: "any", text: "Rút ngẫu nhiên 1 lá trên tay của người bất kỳ." }),
  duck: C({ key: "duck", name: "Cúi Đầu!", emoji: "🦆", color: "brown", pack: "armed", aim: "none", isMissed: true, text: "Như Trượt!. Nếu thẻ nhân vật của bạn còn đạn, tốn 1 viên để lấy lá này lại lên tay." }),
  nip: C({ key: "nip", name: "Hớp Rượu", emoji: "🍶", color: "brown", pack: "armed", aim: "none", text: "Hồi 1 máu và nạp 1 viên đạn lên thẻ nhân vật." }),
  squaw: C({ key: "squaw", name: "Giật Đồ", emoji: "🪝", color: "brown", pack: "armed", aim: "any", text: "Bỏ 1 lá trước mặt người bất kỳ. Tốn 2 viên đạn của bạn để lấy lá đó về tay thay vì bỏ." }),
  // ── Armed & Dangerous: blue (arrive with cubes)
  bandolier: C({ key: "bandolier", name: "Đai Đạn", emoji: "🎽", color: "blue", pack: "armed", aim: "none", load: 2, text: "Tốn 1 viên đạn trên lá này: được bắn thêm 1 BANG! trong lượt." }),
  belltower: C({ key: "belltower", name: "Tháp Chuông", emoji: "🔔", color: "blue", pack: "armed", aim: "none", load: 2, text: "Tốn 1 viên đạn trên lá này: lá tiếp theo bạn đánh trong lượt không tính khoảng cách." }),
  bigfifty: C({ key: "bigfifty", name: "Súng Săn Lớn", emoji: "🦣", color: "blue", pack: "armed", aim: "none", range: 3, load: 2, text: "Súng tầm 3. Tốn 1 viên đạn: BANG! tiếp theo bỏ qua mọi lá trước mặt mục tiêu (Thùng Gỗ, Ngựa…)." }),
  doublebarrel: C({ key: "doublebarrel", name: "Súng Hai Nòng", emoji: "🔫", color: "blue", pack: "armed", aim: "none", range: 1, text: "Tầm 1. BANG! chất ♦ của bạn không thể bị Trượt!." }),
  buntline: C({ key: "buntline", name: "Súng Nòng Dài", emoji: "🔫", color: "blue", pack: "armed", aim: "none", range: 2, load: 2, text: "Tầm 2. Khi BANG! của bạn bị né, tự tốn 1 viên đạn trên lá này: người đó bỏ ngẫu nhiên 1 lá trên tay." }),
};

/** A physical card: one entry of the deck. */
export interface CardDef {
  id: number;
  key: CardKey;
  suit: Suit;
  rank: number;
}

/** "AS 2-9C QH" → [[14,"S"], [2,"C"], …]. */
function parse(spec: string): [number, Suit][] {
  const out: [number, Suit][] = [];
  const val = (r: string) => ({ J: 11, Q: 12, K: 13, A: 14 })[r as "J"] ?? Number(r);
  for (const tok of spec.trim().split(/\s+/)) {
    const suit = tok.slice(-1) as Suit;
    const body = tok.slice(0, -1);
    const [a, b] = body.split("-");
    for (let r = val(a); r <= val(b ?? a); r++) out.push([r, suit]);
  }
  return out;
}

const DECK_SPEC: [CardKey, string][] = [
  // base (80)
  ["bang", "AS 2-AD 2-9C Q-AH"],
  ["missed", "10-AC 2-8S"],
  ["beer", "6-JH"],
  ["panic", "JH QH AH 8D"],
  ["catbalou", "KH 9D 10D JD"],
  ["stagecoach", "9S 9S"],
  ["wellsfargo", "3H"],
  ["generalstore", "9C QS"],
  ["indians", "KD AD"],
  ["duel", "QD JS 8C"],
  ["gatling", "10H"],
  ["saloon", "5H"],
  ["barrel", "QS KS"],
  ["scope", "AS"],
  ["mustang", "8H 9H"],
  ["jail", "JS 10S 4H"],
  ["dynamite", "2H"],
  ["volcanic", "10S 10C"],
  ["schofield", "JC QC KS"],
  ["remington", "KC"],
  ["carabine", "AC"],
  ["winchester", "8S"],
  // dodge city (40)
  ["punch", "10S"],
  ["dodge", "7D KH"],
  ["springfield", "KS"],
  ["whisky", "QH"],
  ["tequila", "9C"],
  ["ragtime", "9H"],
  ["brawl", "JS"],
  ["bang", "8S 5C 6C KC QD"],
  ["beer", "6S"],
  ["catbalou", "8D"],
  ["duel", "JC"],
  ["generalstore", "AS"],
  ["indians", "5D"],
  ["missed", "8C"],
  ["panic", "JH"],
  ["binocular", "10D"],
  ["hideout", "KD"],
  ["barrel", "AC"],
  ["dynamite", "10C"],
  ["mustang", "5H"],
  ["remington", "6D"],
  ["carabine", "5S"],
  ["bible", "10H"],
  ["buffalo", "QC"],
  ["cancan", "JC"],
  ["canteen", "7H"],
  ["conestoga", "9D"],
  ["derringer", "7S"],
  ["howitzer", "9S"],
  ["ironplate", "AD"],
  ["knife", "8H"],
  ["pepperbox", "AH"],
  ["ponyexpress", "QD"],
  ["sombrero", "7C"],
  ["tengallon", "JD"],
  // valley of shadows (24)
  ["aim", "6C"],
  ["backfire", "QC"],
  ["bandidas", "QD"],
  ["escape", "3H 7D"],
  ["fanning", "2S"],
  ["lastcall", "8D"],
  ["poker", "JH"],
  ["saved", "5H 6H"],
  ["tomahawk", "AD"],
  ["tornado", "AC"],
  ["bounty", "9C"],
  ["ghost", "9S 10S"],
  ["lemat", "4D"],
  ["rattlesnake", "7H"],
  ["shotgun", "KS"],
  ["bang", "3C 5D"],
  ["missed", "3S"],
  ["beer", "4H"],
  ["panic", "2D"],
  ["catbalou", "4S"],
  // armed & dangerous (23)
  ["reload", "4C QH"],
  ["quickshot", "7C JD"],
  ["flintlock", "AS 6D"],
  ["lockpick", "KD"],
  ["duck", "9H 3D"],
  ["nip", "10H"],
  ["squaw", "JC"],
  ["bandolier", "8C"],
  ["belltower", "6S"],
  ["bigfifty", "KC"],
  ["doublebarrel", "QD"],
  ["buntline", "10D"],
  ["bang", "4S 2C 7S"],
  ["missed", "5S 9D"],
  ["beer", "3H"],
  ["stagecoach", "4D"],
];

/** Which pack each DECK_SPEC line belongs to (by position: 80 / 40 / 24 / 23). */
function buildCards(): { cards: CardDef[]; packOf: Pack[] } {
  const cards: CardDef[] = [];
  const packOf: Pack[] = [];
  let pack: Pack = "base";
  for (const [key, spec] of DECK_SPEC) {
    // Section switches: the first card of a section is the first line whose key starts it.
    if (key === "punch") pack = "dodge";
    if (key === "aim") pack = "valley";
    if (key === "reload") pack = "armed";
    for (const [rank, suit] of parse(spec)) {
      cards.push({ id: cards.length, key, suit, rank });
      packOf.push(pack);
    }
  }
  return { cards, packOf };
}

const BUILT = buildCards();
export const CARDS: CardDef[] = BUILT.cards;
export const CARD_PACK: Pack[] = BUILT.packOf;
export const cardDef = (id: number): CardDef => CARDS[id];
export const typeOf = (id: number): CardType => CARD_TYPES[CARDS[id].key];

/** The draw deck for the chosen packs (event packs and Gold Rush add no playing cards). */
export function deckFor(packs: Pack[]): number[] {
  return CARDS.filter((c) => packs.includes(CARD_PACK[c.id])).map((c) => c.id);
}

// ─── Roles ──────────────────────────────────────────────────────────

export type Role = "sheriff" | "deputy" | "outlaw" | "renegade";
export const ROLE_INFO: Record<Role, { name: string; emoji: string; goal: string }> = {
  sheriff: { name: "Cảnh sát trưởng", emoji: "⭐", goal: "Diệt hết Kẻ cướp và Kẻ phản bội." },
  deputy: { name: "Phó cảnh sát", emoji: "🎖️", goal: "Bảo vệ Cảnh sát trưởng, diệt hết Kẻ cướp và Kẻ phản bội." },
  outlaw: { name: "Kẻ cướp", emoji: "🦹", goal: "Hạ Cảnh sát trưởng." },
  renegade: { name: "Kẻ phản bội", emoji: "🐍", goal: "Là người cuối cùng còn sống." },
};

/** Roles dealt for each player count (3 players: Phó / Kẻ cướp / Kẻ phản bội, each hunting the next). */
export const ROLES_FOR: Record<number, Role[]> = {
  3: ["deputy", "outlaw", "renegade"],
  4: ["sheriff", "renegade", "outlaw", "outlaw"],
  5: ["sheriff", "renegade", "outlaw", "outlaw", "deputy"],
  6: ["sheriff", "renegade", "outlaw", "outlaw", "outlaw", "deputy"],
  7: ["sheriff", "renegade", "outlaw", "outlaw", "outlaw", "deputy", "deputy"],
  8: ["sheriff", "renegade", "renegade", "outlaw", "outlaw", "outlaw", "deputy", "deputy"],
};
/** 3-player variant: who each role must kill to win. */
export const THREE_PLAYER_TARGET: Record<Role, Role> = { deputy: "renegade", renegade: "outlaw", outlaw: "deputy", sheriff: "sheriff" };
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

// ─── Characters ─────────────────────────────────────────────────────

export type CharKey =
  // base
  | "bart" | "blackjack" | "calamity" | "elgringo" | "jesse" | "jourdonnais" | "kit" | "lucky"
  | "paul" | "pedro" | "rose" | "sid" | "slab" | "suzy" | "vulture" | "willy"
  // dodge city
  | "apache" | "belle" | "bill" | "chuck" | "doc" | "elena" | "greg" | "herb" | "jose" | "molly" | "pat" | "pixie" | "sean" | "tequilajoe" | "vera"
  // wild west show
  | "bigspencer" | "flint" | "gary" | "greygory" | "johnpain" | "leevan" | "teren" | "youl"
  // gold rush
  | "donbell" | "dutch" | "jacky" | "josh" | "madam" | "luzena" | "raddie" | "simeon"
  // valley of shadows
  | "blackflower" | "colorado" | "derspot" | "evelyn" | "henry" | "lemonade" | "mick" | "tuco"
  // armed & dangerous
  | "alpreacher" | "bass" | "bloody" | "frankie" | "julie" | "mexicali" | "abigail" | "redringo";

export interface Character {
  key: CharKey;
  name: string;
  emoji: string;
  life: number;
  pack: Pack;
  text: string;
}

const H = (key: CharKey, name: string, emoji: string, life: number, pack: Pack, text: string): Character => ({ key, name, emoji, life, pack, text });

export const CHARACTERS: Record<CharKey, Character> = {
  bart: H("bart", "Ba Lì Đòn", "🩹", 4, "base", "Mỗi lần mất 1 máu, rút 1 lá."),
  blackjack: H("blackjack", "Cờ Đen", "🎩", 4, "base", "Giai đoạn rút: lá thứ 2 lật cho mọi người xem; nếu là ♥/♦ thì rút thêm 1 lá."),
  calamity: H("calamity", "Cô Tai Ương", "👢", 4, "base", "Dùng BANG! như Trượt! và Trượt! như BANG!."),
  elgringo: H("elgringo", "Gã Ngoại Quốc", "🧥", 3, "base", "Mỗi máu mất vì người khác: rút ngẫu nhiên 1 lá trên tay kẻ đó."),
  jesse: H("jesse", "Giét Móc Túi", "🧤", 4, "base", "Giai đoạn rút: lá đầu tiên có thể rút ngẫu nhiên từ tay 1 người."),
  jourdonnais: H("jourdonnais", "Giò Đỏ May", "🍀", 4, "base", "Lúc nào cũng như có Thùng Gỗ."),
  kit: H("kit", "Kít Soi Bài", "🔍", 4, "base", "Giai đoạn rút: xem 3 lá trên cùng, giữ 2, trả 1 lên đầu chồng bài."),
  lucky: H("lucky", "Lão Hên", "🎲", 4, "base", "Mỗi lần rút!: lật 2 lá, lấy lá có lợi."),
  paul: H("paul", "Phôn Né Tránh", "🏇", 3, "base", "Lúc nào cũng như có Ngựa Hoang."),
  pedro: H("pedro", "Pê Nhặt Rác", "🗑️", 4, "base", "Giai đoạn rút: lá đầu tiên có thể lấy từ đống bài bỏ."),
  rose: H("rose", "Rô Mắt Ưng", "🦅", 4, "base", "Lúc nào cũng như có Ống Ngắm."),
  sid: H("sid", "Sít Liều Mạng", "💊", 4, "base", "Bất cứ lúc nào: bỏ 2 lá để hồi 1 máu (sắp chết cũng tự dùng)."),
  slab: H("slab", "Sờ Lép Sát Thủ", "💀", 4, "base", "BANG! của hắn phải dùng 2 Trượt! mới né được."),
  suzy: H("suzy", "Su Xinh", "🌸", 4, "base", "Hết bài trên tay thì rút ngay 1 lá."),
  vulture: H("vulture", "Kền Kền", "🦅", 4, "base", "Có người chết thì lấy hết bài của họ."),
  willy: H("willy", "Uy Nhóc", "🧒", 4, "base", "Bắn BANG! không giới hạn số lần."),

  apache: H("apache", "Thổ Dân Trẻ", "🏹", 3, "dodge", "Không bị ảnh hưởng bởi lá chất ♦ người khác đánh."),
  belle: H("belle", "Cô Ngôi Sao", "⭐", 4, "dodge", "Trong lượt của cô, mọi lá trước mặt người khác mất tác dụng."),
  bill: H("bill", "Bin Mặt Trơ", "😶", 4, "dodge", "Giai đoạn rút: rút 1 lá, cộng thêm 1 lá cho mỗi máu đã mất."),
  chuck: H("chuck", "Chắc Liều", "🎰", 4, "dodge", "Trong lượt, bao nhiêu lần tuỳ ý: mất 1 máu để rút 2 lá (không được về 0)."),
  doc: H("doc", "Bác Sĩ Súng", "🩺", 4, "dodge", "Mỗi lượt 1 lần: bỏ 2 lá để bắn 1 người trong tầm (không tính giới hạn BANG!)."),
  elena: H("elena", "Ê-lê-na", "💃", 3, "dodge", "Lá nào cũng dùng được như Trượt!."),
  greg: H("greg", "Thợ Đào Mộ", "⚰️", 4, "dodge", "Có người chết thì hồi 2 máu."),
  herb: H("herb", "Thợ Săn Cỏ", "🌿", 4, "dodge", "Có người chết thì rút 2 lá."),
  jose: H("jose", "Hô-xê", "🧰", 4, "dodge", "Trong lượt, tối đa 2 lần: bỏ 1 lá xanh dương trên tay để rút 2 lá."),
  molly: H("molly", "Mô-li Nhanh Tay", "💨", 4, "dodge", "Mỗi lần đánh/dùng lá ngoài lượt của mình, rút 1 lá."),
  pat: H("pat", "Pát Trộm Đồ", "🦝", 4, "dodge", "Giai đoạn rút: thay vì rút, lấy 1 lá trước mặt bất kỳ ai."),
  pixie: H("pixie", "Tí Hon", "🧚", 3, "dodge", "Giai đoạn rút: rút 3 lá."),
  sean: H("sean", "Sơn Ôm Bài", "🗃️", 3, "dodge", "Được giữ tối đa 10 lá trên tay."),
  tequilajoe: H("tequilajoe", "Tê Nghiện Rượu", "🍾", 4, "dodge", "Uống Bia hồi 2 máu."),
  vera: H("vera", "Vê Bắt Chước", "🎭", 3, "dodge", "Đầu mỗi lượt: chọn 1 nhân vật khác còn sống, có sức mạnh của họ tới lượt sau."),

  bigspencer: H("bigspencer", "Ông Bự", "🐻", 9, "wws", "Bắt đầu với 5 lá. Không bao giờ đánh được Trượt!."),
  flint: H("flint", "Phờ-lin Đổi Chác", "🔄", 4, "wws", "Mỗi lượt 1 lần: đưa 1 lá trên tay cho 1 người, lấy ngẫu nhiên 2 lá trên tay họ."),
  gary: H("gary", "Ga Nhặt Nhạnh", "🧺", 5, "wws", "Lá người khác phải bỏ cuối lượt (vì dư bài) về tay hắn."),
  greygory: H("greygory", "Xám Nhiều Mặt", "🃏", 4, "wws", "Đầu mỗi lượt: nhận sức mạnh của 2 nhân vật ngẫu nhiên chưa ai dùng, tới lượt sau."),
  johnpain: H("johnpain", "Giôn Đau Đớn", "🤕", 4, "wws", "Nếu trên tay dưới 6 lá, mỗi lá ai đó lật ra để rút! đều về tay hắn."),
  leevan: H("leevan", "Li Bắn Lại", "🔁", 4, "wws", "Trong lượt: bỏ 1 lá BANG! để lặp lại tác dụng của lá nâu vừa đánh."),
  teren: H("teren", "Tê Rèn Lì", "🧟", 3, "wws", "Khi bị hạ: rút!, không ra ♠ thì còn 1 máu và rút 1 lá."),
  youl: H("youl", "Du Cười Toe", "😁", 4, "wws", "Trước giai đoạn rút: ai có nhiều bài hơn hắn phải đưa hắn 1 lá."),

  donbell: H("donbell", "Đông Chuông", "🔔", 4, "goldrush", "Cuối lượt rút!: ra ♥/♦ thì chơi thêm 1 lượt (không lặp lại)."),
  dutch: H("dutch", "Đát Tham Vàng", "🪙", 4, "goldrush", "Giai đoạn rút: rút 2 lá, bỏ 1 lá, được 1 vàng."),
  jacky: H("jacky", "Giắc-ki Hào Phóng", "💸", 4, "goldrush", "Trả 2 vàng: được bắn thêm 1 BANG! trong lượt."),
  josh: H("josh", "Giốt Mua Chịu", "🛒", 4, "goldrush", "Trả 2 vàng: lấy miễn phí lá trên cùng của chồng trang bị."),
  madam: H("madam", "Bà Chủ Quán", "🍻", 4, "goldrush", "Mỗi khi có người uống Bia, rút 1 lá."),
  luzena: H("luzena", "Lu Buôn Bán", "🏷️", 4, "goldrush", "Mỗi lượt 1 lần: mua trang bị rẻ hơn 1 vàng."),
  raddie: H("raddie", "Rết Đổi Vàng", "🐍", 4, "goldrush", "Trong lượt, tối đa 2 lần: trả 1 vàng để rút 1 lá."),
  simeon: H("simeon", "Si Mê Vàng", "⛏️", 4, "goldrush", "Mỗi máu mất được 1 vàng."),

  blackflower: H("blackflower", "Hoa Đen", "🥀", 4, "valley", "Mỗi lượt 1 lần: dùng 1 lá ♣ như 1 phát BANG! thêm (không tính giới hạn)."),
  colorado: H("colorado", "Cô-lô-ra-đô", "🏔️", 4, "valley", "BANG! của hắn: rút!, ra ♠ thì không thể bị né."),
  derspot: H("derspot", "Đốm Chuông", "🔔", 4, "valley", "Mỗi lượt 1 lần: dùng lá BANG! như Súng Máy."),
  evelyn: H("evelyn", "Ê-vơ-lin Nóng Súng", "🔥", 4, "valley", "Giai đoạn rút: bỏ qua 1–2 lá, mỗi lá bỏ qua được bắn 1 người trong tầm."),
  henry: H("henry", "Hen-ri Gai Góc", "🌵", 4, "valley", "Ai lấy hoặc bắt hắn bỏ bài trên tay/trước mặt thì bị hắn bắn 1 phát."),
  lemonade: H("lemonade", "Chanh Muối", "🍋", 4, "valley", "Khi người khác uống Bia, hắn cũng hồi 1 máu."),
  mick: H("mick", "Mích Phòng Thủ", "🛡️", 4, "valley", "Bị nhắm bởi lá nâu không phải BANG! (Hoảng Loạn, Quậy Phá, Đấu Tay Đôi…) thì được dùng Trượt! để né."),
  tuco: H("tuco", "Tu Cô Tu Sĩ", "📿", 4, "valley", "Giai đoạn rút: nếu trước mặt không có lá xanh dương nào, rút thêm 2 lá."),

  alpreacher: H("alpreacher", "Mục Sư Al", "✝️", 4, "armed", "Khi người khác đặt lá xanh ra trước mặt, rút 1 lá."),
  bass: H("bass", "Bát Thợ Rèn", "🔨", 4, "armed", "Mỗi lượt 1 lần: bỏ 1 lá trên tay để nạp 2 viên đạn."),
  bloody: H("bloody", "Mê-ri Máu", "🩸", 4, "armed", "Khi BANG! của cô bị né, rút 1 lá."),
  frankie: H("frankie", "Phờ-ran-ki", "🧲", 4, "armed", "Mỗi lượt 1 lần: lấy 1 viên đạn trên lá của bất kỳ ai về thẻ nhân vật."),
  julie: H("julie", "Giu-li Dao Cạo", "🗡️", 4, "armed", "Mất máu vì người khác: rút!, ra ♥/♦ thì bắn trả kẻ đó 1 phát."),
  mexicali: H("mexicali", "Mếch-xi-ca-li", "🌶️", 4, "armed", "Mỗi lượt 1 lần: tốn 2 viên đạn để bắn thêm 1 BANG!."),
  abigail: H("abigail", "Bà Á-bi", "🎀", 4, "armed", "Không bị ảnh hưởng bởi lá tấn công có số J, Q, K, A."),
  redringo: H("redringo", "Rinh-gô Đỏ", "🔴", 4, "armed", "Bắt đầu với 4 viên đạn trên thẻ. Mỗi lượt tối đa 2 lần: chuyển 1 viên sang lá trước mặt."),
};

// ─── Events (High Noon, A Fistful of Cards, Wild West Show) ─────────

export type EventKey =
  // high noon
  | "blessing" | "curse" | "daltons" | "doctor" | "ghosttown" | "reverse" | "hangover" | "newidentity" | "sermon" | "shootout" | "reverend" | "thirst" | "train" | "highnoon"
  // fistful
  | "mine" | "ambush" | "bloodbrothers" | "deadman" | "hardliquor" | "lasso" | "lawwest" | "peyote" | "ranch" | "ricochet" | "roulette" | "sniper" | "judge" | "vendetta" | "fistful"
  // wild west show
  | "boneyard" | "valentine" | "dorothy" | "helena" | "ladyrose" | "susanna" | "sacagaway" | "showdown" | "wildwestshow";

export interface GameEvent {
  key: EventKey;
  name: string;
  emoji: string;
  pack: Pack;
  text: string;
  /** Goes to the bottom of the deck and stays until the end. */
  final?: boolean;
}

const E = (key: EventKey, name: string, emoji: string, pack: Pack, text: string, final = false): GameEvent => ({ key, name, emoji, pack, text, ...(final ? { final } : {}) });

export const EVENTS: Record<EventKey, GameEvent> = {
  blessing: E("blessing", "Phúc Lành", "🙏", "highnoon", "Mọi lá lật ra để rút! đều tính là chất ♥."),
  curse: E("curse", "Lời Nguyền", "🧿", "highnoon", "Mọi lá lật ra để rút! đều tính là chất ♠."),
  daltons: E("daltons", "Anh Em Nhà Cướp", "🦹", "highnoon", "Khi lật ra: ai có lá xanh dương trước mặt phải bỏ 1 lá."),
  doctor: E("doctor", "Bác Sĩ", "👨‍⚕️", "highnoon", "Khi lật ra: những người ít máu nhất hồi 1 máu."),
  ghosttown: E("ghosttown", "Thị Trấn Ma", "🏚️", "highnoon", "Người đã chết trở lại chơi 1 lượt như hồn ma: rút 3 lá, không thể chết, hết lượt thì bỏ hết bài."),
  reverse: E("reverse", "Đổ Xô Tìm Vàng", "🔃", "highnoon", "Lượt chơi đi ngược chiều."),
  hangover: E("hangover", "Say Xỉn", "🥴", "highnoon", "Bia không có tác dụng."),
  newidentity: E("newidentity", "Danh Tính Mới", "🪪", "highnoon", "Đầu lượt: có thể đổi sang nhân vật thứ hai được chia lúc đầu (máu về 2)."),
  sermon: E("sermon", "Bài Giảng", "⛪", "highnoon", "Người đang đến lượt không được đánh lá BANG!."),
  shootout: E("shootout", "Đọ Súng", "🔫", "highnoon", "Mỗi lượt được đánh 2 lá BANG!."),
  reverend: E("reverend", "Mục Sư", "📿", "highnoon", "Không được uống Bia."),
  thirst: E("thirst", "Khát Nước", "🏜️", "highnoon", "Giai đoạn rút: rút ít hơn 1 lá."),
  train: E("train", "Tàu Đến Ga", "🚂", "highnoon", "Giai đoạn rút: rút thêm 1 lá."),
  highnoon: E("highnoon", "Giữa Trưa", "🌞", "highnoon", "Đầu mỗi lượt, người chơi mất 1 máu.", true),

  mine: E("mine", "Mỏ Bỏ Hoang", "⛏️", "fistful", "Giai đoạn rút: rút từ đống bài bỏ (nếu đủ)."),
  ambush: E("ambush", "Phục Kích", "🌾", "fistful", "Khoảng cách giữa mọi người đều là 1."),
  bloodbrothers: E("bloodbrothers", "Anh Em Kết Nghĩa", "🩸", "fistful", "Đầu lượt: có thể mất 1 máu (không về 0) để 1 người khác hồi 1 máu."),
  deadman: E("deadman", "Người Chết Sống Lại", "🧟", "fistful", "Khi lật ra: người chết đầu tiên sống lại với 2 máu và 2 lá."),
  hardliquor: E("hardliquor", "Rượu Mạnh", "🥃", "fistful", "Giai đoạn rút: có thể không rút để hồi 1 máu."),
  lasso: E("lasso", "Dây Thòng Lọng", "🪢", "fistful", "Mọi lá trước mặt mất tác dụng."),
  lawwest: E("lawwest", "Luật Miền Tây", "📜", "fistful", "Giai đoạn rút: rút thêm 1 lá nhưng lá đó lật cho mọi người xem."),
  peyote: E("peyote", "Nấm Ảo Giác", "🍄", "fistful", "Giai đoạn rút: đoán Đỏ hoặc Đen rồi lật bài; lấy mọi lá đúng màu tới khi đoán sai."),
  ranch: E("ranch", "Nông Trại", "🐄", "fistful", "Mỗi lượt 1 lần: bỏ bao nhiêu lá tuỳ ý để rút lại chừng ấy lá."),
  ricochet: E("ricochet", "Đạn Nảy", "🪃", "fistful", "Được bắn BANG! vào 1 lá trước mặt người khác: họ phải Trượt! không thì lá đó bị bỏ."),
  roulette: E("roulette", "Cò Quay Nga", "🎰", "fistful", "Khi lật ra: từ Cảnh sát trưởng, lần lượt bỏ 1 lá Trượt!; người đầu tiên không bỏ được mất 2 máu."),
  sniper: E("sniper", "Bắn Tỉa", "🎯", "fistful", "Được đánh 2 lá BANG! cùng lúc như 1 phát cần 2 Trượt! mới né."),
  judge: E("judge", "Quan Toà", "⚖️", "fistful", "Không ai được đặt lá ra trước mặt."),
  vendetta: E("vendetta", "Báo Thù", "🗡️", "fistful", "Cuối lượt rút!: ra ♥ thì chơi thêm 1 lượt (không lặp lại)."),
  fistful: E("fistful", "Nắm Bài", "✊", "fistful", "Đầu lượt, người chơi bị bắn 1 phát cho mỗi lá trên tay.", true),

  boneyard: E("boneyard", "Nghĩa Địa", "🪦", "wws", "Khi lật ra: mọi người đã chết sống lại với 1 máu và 1 lá."),
  valentine: E("valentine", "Tình Nhân", "💘", "wws", "Đầu lượt: bỏ hết bài trên tay rồi rút lại đúng chừng ấy lá."),
  dorothy: E("dorothy", "Cơn Giận Đô-rô-ti", "😤", "wws", "Mỗi lượt 1 lần: bắt 1 người khác bỏ 1 lá BANG! hoặc mất 1 máu."),
  helena: E("helena", "Bà Đồng Hê-lê-na", "🔮", "wws", "Khi lật ra: vai trò của mọi người còn sống (trừ Cảnh sát trưởng) bị xáo lại và chia lại."),
  ladyrose: E("ladyrose", "Quý Bà Hoa Hồng", "🌹", "wws", "Mỗi lượt 1 lần: đổi chỗ ngồi với người bên cạnh."),
  susanna: E("susanna", "Cô Su-da-na", "💃", "wws", "Cuối lượt, ai đánh ít hơn 3 lá thì mất 1 máu."),
  sacagaway: E("sacagaway", "Lật Bài Ngửa", "👀", "wws", "Mọi người chơi ngửa bài trên tay."),
  showdown: E("showdown", "Quyết Đấu", "🤠", "wws", "Lá nào cũng dùng được như BANG!; BANG! dùng được như Trượt!."),
  wildwestshow: E("wildwestshow", "Gánh Xiếc Miền Tây", "🎪", "wws", "Mục tiêu của mọi người là trở thành người cuối cùng còn sống.", true),
};

// ─── Gold Rush equipment ────────────────────────────────────────────

export type GearKey =
  | "bottle" | "pardner" | "rum" | "unionpacific" | "goldfever"
  | "pickaxe" | "goldpan" | "horseshoe" | "luckycharm" | "calumet" | "ace" | "wanted";

export interface Gear {
  key: GearKey;
  name: string;
  emoji: string;
  cost: number;
  /** instant = used as soon as it is bought · keep = stays in front of you (cannot be stolen). */
  kind: "instant" | "keep";
  text: string;
}

const G = (key: GearKey, name: string, emoji: string, cost: number, kind: Gear["kind"], text: string): Gear => ({ key, name, emoji, cost, kind, text });

export const GEAR: Record<GearKey, Gear> = {
  bottle: G("bottle", "Chai Rượu", "🍾", 2, "instant", "Chọn 1: như Hoảng Loạn, như Bia, hoặc như 1 phát BANG! (không tính giới hạn)."),
  pardner: G("pardner", "Bạn Đồng Hành", "🤝", 2, "instant", "Chọn 1: như Tạp Hoá, như Đấu Tay Đôi, hoặc như Quậy Phá."),
  rum: G("rum", "Rượu Rum", "🥃", 3, "instant", "Lật 4 lá: mỗi chất khác nhau hồi 1 máu."),
  unionpacific: G("unionpacific", "Đường Sắt", "🚂", 4, "instant", "Rút 4 lá."),
  goldfever: G("goldfever", "Sốt Vàng", "✨", 5, "instant", "Kết thúc lượt ngay và hồi đầy máu."),
  pickaxe: G("pickaxe", "Cuốc Chim", "⛏️", 4, "keep", "Giai đoạn rút: rút thêm 1 lá."),
  goldpan: G("goldpan", "Chảo Đãi Vàng", "🍳", 3, "keep", "Trong lượt, tối đa 2 lần: trả 1 vàng để rút 1 lá."),
  horseshoe: G("horseshoe", "Móng Ngựa", "🧲", 2, "keep", "Mỗi lần rút!: lật thêm 1 lá và lấy lá có lợi."),
  luckycharm: G("luckycharm", "Bùa May", "🧿", 3, "keep", "Mỗi máu mất được 1 vàng."),
  calumet: G("calumet", "Tẩu Hoà Bình", "🪈", 3, "keep", "Lá chất ♦ người khác đánh không ảnh hưởng tới bạn."),
  ace: G("ace", "Át Chủ Bài", "🂡", 2, "keep", "Giữ được thêm 2 lá trên tay."),
  wanted: G("wanted", "Truy Nã", "📜", 2, "keep", "Đặt lên người khác: ai hạ họ được 2 lá và 1 vàng."),
};

/** Two of each item. */
export const GEAR_DECK: GearKey[] = (Object.keys(GEAR) as GearKey[]).flatMap((k) => [k, k]);
export const SHOP_SLOTS = 3;

// ─── Settings ───────────────────────────────────────────────────────

export const TURN_SECONDS_OPTIONS = [45, 60, 90, 120];
export const RESPOND_SECONDS_OPTIONS = [10, 15, 20, 30];
export const DEFAULT_TURN_SECONDS = 60;
export const DEFAULT_RESPOND_SECONDS = 15;
/** Most events drawn into one game (the final event comes after them). */
export const EVENT_DECK_SIZE = 12;
