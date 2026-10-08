/**
 * Cờ Tỷ Phú board: 40 squares, Vietnamese provinces and cities instead of the classic streets.
 * Money is in "triệu" (tr). Prices and rents follow the classic table so the balance is familiar.
 * This file is copied verbatim to the portfolio (src/lib/typhu/board.ts) — keep it dependency-free.
 */

export type Group = "brown" | "lightblue" | "pink" | "orange" | "red" | "yellow" | "green" | "darkblue";

export type Square =
  | { kind: "go"; name: string }
  | { kind: "prop"; name: string; region: string; group: Group; price: number; house: number; rent: number[] }
  | { kind: "air"; name: string; price: number }
  | { kind: "util"; name: string; price: number }
  | { kind: "chance"; name: string }
  | { kind: "chest"; name: string }
  | { kind: "tax"; name: string; amount: number }
  | { kind: "jail"; name: string }
  | { kind: "parking"; name: string }
  | { kind: "gotojail"; name: string };

export type Ownable = Extract<Square, { price: number }>;

const prop = (name: string, region: string, group: Group, price: number, house: number, rent: number[]): Square => ({
  kind: "prop",
  name,
  region,
  group,
  price,
  house,
  rent,
});

export const BOARD: Square[] = [
  { kind: "go", name: "Khởi hành" },
  prop("Cà Mau", "Mũi Cà Mau", "brown", 60, 50, [2, 10, 30, 90, 160, 250]),
  { kind: "chest", name: "Khí vận" },
  prop("Bạc Liêu", "Nhà công tử", "brown", 60, 50, [4, 20, 60, 180, 320, 450]),
  { kind: "tax", name: "Thuế thu nhập", amount: 200 },
  { kind: "air", name: "Sân bay Tân Sơn Nhất", price: 200 },
  prop("Cần Thơ", "Chợ nổi Cái Răng", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]),
  { kind: "chance", name: "Cơ hội" },
  prop("An Giang", "Núi Sam, Châu Đốc", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]),
  prop("Bến Tre", "Xứ dừa", "lightblue", 120, 50, [8, 40, 100, 300, 450, 600]),
  { kind: "jail", name: "Nhà tù" },
  prop("Bà Rịa-Vũng Tàu", "Tượng Chúa Kitô", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
  { kind: "util", name: "Công ty Điện lực", price: 150 },
  prop("Bình Thuận", "Đồi cát Mũi Né", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
  prop("Lâm Đồng", "Hồ Xuân Hương, Đà Lạt", "pink", 160, 100, [12, 60, 180, 500, 700, 900]),
  { kind: "air", name: "Sân bay Cam Ranh", price: 200 },
  prop("Đắk Lắk", "Thủ phủ cà phê", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
  { kind: "chest", name: "Khí vận" },
  prop("Bình Định", "Eo Gió, Quy Nhơn", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
  prop("Khánh Hòa", "Vịnh Nha Trang", "orange", 200, 100, [16, 80, 220, 600, 800, 1000]),
  { kind: "parking", name: "Nghỉ chân" },
  prop("Quảng Nam", "Phố cổ Hội An", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
  { kind: "chance", name: "Cơ hội" },
  prop("Thừa Thiên Huế", "Đại Nội", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
  prop("Đà Nẵng", "Cầu Rồng", "red", 240, 150, [20, 100, 300, 750, 925, 1100]),
  { kind: "air", name: "Sân bay Phú Bài", price: 200 },
  prop("Ninh Bình", "Tràng An", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
  prop("Lào Cai", "Fansipan, Sa Pa", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
  { kind: "util", name: "Nhà máy Nước", price: 150 },
  prop("Quảng Ninh", "Vịnh Hạ Long", "yellow", 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { kind: "gotojail", name: "Vào tù" },
  prop("Hải Phòng", "Thành phố hoa phượng", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
  prop("Thanh Hóa", "Biển Sầm Sơn", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { kind: "chest", name: "Khí vận" },
  prop("Kiên Giang", "Đảo ngọc Phú Quốc", "green", 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  { kind: "air", name: "Sân bay Nội Bài", price: 200 },
  { kind: "chance", name: "Cơ hội" },
  prop("Hà Nội", "Hồ Hoàn Kiếm", "darkblue", 350, 200, [50, 250, 700, 1600, 1900, 2200]),
  { kind: "tax", name: "Thuế xa xỉ", amount: 100 },
  prop("TP. Hồ Chí Minh", "Phố đi bộ Nguyễn Huệ", "darkblue", 400, 200, [70, 300, 900, 2000, 2400, 2800]),
];

/**
 * Map sizes: the standard 40-square ring, or bigger rings with extra squares slipped into each side
 * (more lots for the colour groups, more Cơ hội / Khí vận / tax squares). The corners stay put.
 */
export type MapSize = "std" | "large" | "huge";
export const MAP_SIZES: MapSize[] = ["std", "large", "huge"];
export const MAP_LABEL: Record<MapSize, string> = { std: "Chuẩn · 40 ô", large: "Mở rộng · 48 ô", huge: "Lớn · 56 ô" };

/** `side`: 0 bottom, 1 left, 2 top, 3 right; `at`: index within the side's 9 standard squares before which it is inserted. */
interface ExtraSquare {
  side: 0 | 1 | 2 | 3;
  at: number;
  sq: Square;
}
const CHANCE_SQ: Square = { kind: "chance", name: "Cơ hội" };
const CHEST_SQ: Square = { kind: "chest", name: "Khí vận" };

const EXTRAS_LARGE: ExtraSquare[] = [
  { side: 0, at: 3, sq: prop("Sóc Trăng", "Chùa Dơi", "brown", 70, 50, [4, 20, 60, 180, 320, 450]) },
  { side: 0, at: 9, sq: CHEST_SQ },
  { side: 1, at: 4, sq: { kind: "tax", name: "Thuế môi trường", amount: 120 } },
  { side: 1, at: 9, sq: prop("Gia Lai", "Biển Hồ, Pleiku", "orange", 200, 100, [16, 80, 220, 600, 800, 1000]) },
  { side: 2, at: 4, sq: CHEST_SQ },
  { side: 2, at: 9, sq: prop("Sơn La", "Đồi chè Mộc Châu", "yellow", 280, 150, [24, 120, 360, 850, 1025, 1200]) },
  { side: 3, at: 3, sq: prop("Nghệ An", "Biển Cửa Lò", "green", 320, 200, [28, 150, 450, 1000, 1200, 1400]) },
  { side: 3, at: 9, sq: CHANCE_SQ },
];
const EXTRAS_HUGE: ExtraSquare[] = [
  ...EXTRAS_LARGE,
  { side: 0, at: 6, sq: { kind: "tax", name: "Thuế bất động sản", amount: 150 } },
  { side: 0, at: 9, sq: prop("Tiền Giang", "Cồn Thới Sơn, Mỹ Tho", "lightblue", 120, 50, [8, 40, 100, 300, 450, 600]) },
  { side: 1, at: 3, sq: prop("Ninh Thuận", "Tháp Chàm, Vĩnh Hy", "pink", 160, 100, [12, 60, 180, 500, 700, 900]) },
  { side: 1, at: 7, sq: CHEST_SQ },
  { side: 2, at: 3, sq: prop("Quảng Bình", "Động Phong Nha", "red", 240, 150, [20, 100, 300, 750, 925, 1100]) },
  { side: 2, at: 8, sq: CHANCE_SQ },
  { side: 3, at: 5, sq: CHEST_SQ },
  { side: 3, at: 9, sq: prop("Bình Dương", "Thành phố mới", "darkblue", 380, 200, [60, 270, 800, 1800, 2150, 2500]) },
];

function buildBoard(extras: ExtraSquare[]): Square[] {
  const sides = [BOARD.slice(1, 10), BOARD.slice(11, 20), BOARD.slice(21, 30), BOARD.slice(31, 40)];
  // Highest index first (and later-defined first on ties) so earlier insertions never shift later ones.
  const order = extras.map((e, i) => ({ e, i })).sort((a, b) => b.e.at - a.e.at || b.i - a.i);
  for (const { e } of order) sides[e.side].splice(e.at, 0, e.sq);
  return [BOARD[0], ...sides[0], BOARD[10], ...sides[1], BOARD[20], ...sides[2], BOARD[30], ...sides[3]];
}

export const BOARDS: Record<MapSize, Square[]> = { std: BOARD, large: buildBoard(EXTRAS_LARGE), huge: buildBoard(EXTRAS_HUGE) };
/** The squares of a game's map (missing = the standard one, so older saved games keep working). */
export const boardOf = (map?: MapSize): Square[] => BOARDS[map ?? "std"] ?? BOARD;
/** Where Nhà tù is on a map. */
export const jailPos = (board: Square[]) => board.findIndex((q) => q.kind === "jail");

export const BOARD_SIZE = BOARD.length;
export const JAIL_POS = 10;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
/** Rent for owning 1–4 airports. */
export const AIR_RENT = [25, 50, 100, 200];
/** Utilities: dice total × 4 (one owned) or × 10 (both). */
export const UTIL_MULT = [4, 10];
/** 5 = khách sạn (hotel). */
export const MAX_HOUSES = 5;

export const GROUP_COLORS: Record<Group, string> = {
  brown: "#8b5a2b",
  lightblue: "#7dd3fc",
  pink: "#f472b6",
  orange: "#fb923c",
  red: "#ef4444",
  yellow: "#facc15",
  green: "#22c55e",
  darkblue: "#3b5bdb",
};

export const isOwnable = (sq: Square): sq is Ownable => sq.kind === "prop" || sq.kind === "air" || sq.kind === "util";

/** Board positions of every square in a colour group. */
export const groupPositions = (group: Group, board: Square[] = BOARD) =>
  board.flatMap((sq, i) => (sq.kind === "prop" && sq.group === group ? [i] : []));

/** Table settings that change prices (all optional: missing = the default). Room settings / game rules carry them. */
export interface PriceRules {
  /** Each building on a lot costs more than the last (default on). */
  risingCost?: boolean;
  /** Extra % paid to lift a mortgage (default 10). */
  unmortgageFee?: number;
  /** % of the price the bank pays for land sold back (default 70). */
  landSalePct?: number;
}
export const GO_SALARY_OPTIONS = [100, 200, 300, 400];
export const UNMORTGAGE_FEE_OPTIONS = [0, 10, 20, 30];
export const LAND_SALE_OPTIONS = [50, 70, 90];

export const mortgageValue = (sq: Ownable) => sq.price / 2;
/** Lifting a mortgage costs its value + the table's fee (10% by default). */
export const unmortgageCost = (sq: Ownable, r?: PriceRules) => Math.ceil((mortgageValue(sq) * (100 + (r?.unmortgageFee ?? 10))) / 100);
/** Selling land back to the bank: 70% of its price by default — more than a mortgage (50%), but the land is gone. */
export const landSaleValue = (sq: Ownable, r?: PriceRules) => Math.floor((sq.price * (r?.landSalePct ?? 70)) / 100);

type Prop = Extract<Square, { kind: "prop" }>;
/**
 * Price of building n on a lot (1–4 houses, 5 = hotel). With rising costs (default) each one costs 25% more than
 * the one before, rounded to 5tr: base × (3 + n) / 4, so the hotel is 2× the base. Otherwise always the base price.
 */
export const houseCost = (sq: Prop, level: number, r?: PriceRules) =>
  r?.risingCost === false ? sq.house : Math.round((sq.house * (3 + level)) / 20) * 5;
/** Selling a building back returns half of what that building cost. */
export const houseRefund = (sq: Prop, level: number, r?: PriceRules) => Math.floor(houseCost(sq, level, r) / 2);
/** Total paid for the first `houses` buildings on a lot. */
export const builtCost = (sq: Prop, houses: number, r?: PriceRules) =>
  Array.from({ length: houses }, (_, i) => houseCost(sq, i + 1, r)).reduce((a, b) => a + b, 0);
/** Cash back from selling all `houses` buildings on a lot. */
export const builtRefund = (sq: Prop, houses: number, r?: PriceRules) =>
  Array.from({ length: houses }, (_, i) => houseRefund(sq, i + 1, r)).reduce((a, b) => a + b, 0);

export type CardEffect =
  | { kind: "money"; amount: number }
  | { kind: "goto"; pos: number }
  | { kind: "back"; steps: number }
  | { kind: "jail" }
  | { kind: "jailcard" }
  | { kind: "repairs"; house: number; hotel: number }
  /** Positive: every other player pays you. Negative: you pay every other player. */
  | { kind: "each"; amount: number }
  /** Move to the nearest airport (rent ×2) or utility (dice × 10). */
  | { kind: "nearest"; target: "air" | "util" }
  /** Move forward `steps` squares (passing Khởi hành pays) and resolve the square. */
  | { kind: "forward"; steps: number }
  /** Another dice roll this turn. */
  | { kind: "rollagain" }
  /** `amount` for every square you own (positive: you receive from the bank, negative: you pay it). */
  | { kind: "perprop"; amount: number }
  /** Move to the nearest square nobody owns yet; you may buy it. */
  | { kind: "nearestfree" }
  /** Pay `amount` to the player with the least cash. */
  | { kind: "poorest"; amount: number }
  /** The player with the most cash gives you `amount`. */
  | { kind: "richest"; amount: number };

export interface DeckCard {
  text: string;
  effect: CardEffect;
}

export const CHANCE: DeckCard[] = [
  { text: "Tiến thẳng về Khởi hành. Nhận 200tr.", effect: { kind: "goto", pos: 0 } },
  { text: "Bay vào TP. Hồ Chí Minh dạo phố đi bộ Nguyễn Huệ.", effect: { kind: "goto", pos: 39 } },
  { text: "Đi ngắm Cầu Rồng phun lửa ở Đà Nẵng. Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 24 } },
  { text: "Đi tắm biển Bà Rịa - Vũng Tàu. Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 11 } },
  { text: "Ra sân bay gần nhất. Nếu có chủ, trả gấp đôi tiền thuê.", effect: { kind: "nearest", target: "air" } },
  { text: "Ra sân bay gần nhất. Nếu có chủ, trả gấp đôi tiền thuê.", effect: { kind: "nearest", target: "air" } },
  { text: "Đến công ty điện/nước gần nhất. Nếu có chủ, tung xúc xắc và trả 10 lần số điểm.", effect: { kind: "nearest", target: "util" } },
  { text: "Ngân hàng chia cổ tức. Nhận 50tr.", effect: { kind: "money", amount: 50 } },
  { text: "Thẻ ra tù miễn phí. Giữ lại để dùng khi cần.", effect: { kind: "jailcard" } },
  { text: "Quên ví ở quán cà phê — lùi lại 3 ô.", effect: { kind: "back", steps: 3 } },
  { text: "Bị bắt vì vượt đèn đỏ. Vào tù thẳng, không qua Khởi hành.", effect: { kind: "jail" } },
  { text: "Tu sửa nhà cửa: trả 25tr mỗi nhà, 100tr mỗi khách sạn.", effect: { kind: "repairs", house: 25, hotel: 100 } },
  { text: "Chạy quá tốc độ trên cao tốc. Phạt 15tr.", effect: { kind: "money", amount: -15 } },
  { text: "Bay chuyến sớm từ Sân bay Tân Sơn Nhất. Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 5 } },
  { text: "Được bầu làm trưởng thôn — khao mỗi người chơi 50tr.", effect: { kind: "each", amount: -50 } },
  { text: "Khoản vay xây nhà đáo hạn. Nhận 150tr.", effect: { kind: "money", amount: 150 } },
  { text: "Trúng vé số an ủi. Nhận 30tr.", effect: { kind: "money", amount: 30 } },
  { text: "Trúng thầu dự án nhỏ. Nhận 120tr.", effect: { kind: "money", amount: 120 } },
  { text: "Đi chợ Bến Thành, mua sắm hết 30tr.", effect: { kind: "money", amount: -30 } },
  { text: "Đỗ xe sai chỗ. Phạt 25tr.", effect: { kind: "money", amount: -25 } },
  { text: "Gặp bạn cũ ở ga, đi nhờ xe — tiến thêm 3 ô.", effect: { kind: "forward", steps: 3 } },
  { text: "Chuyến xe đò may mắn — tiến thêm 5 ô.", effect: { kind: "forward", steps: 5 } },
  { text: "Kẹt xe giờ tan tầm — lùi lại 2 ô.", effect: { kind: "back", steps: 2 } },
  { text: "Hôm nay là ngày may: được tung xúc xắc thêm một lượt.", effect: { kind: "rollagain" } },
  { text: "Phát hiện mảnh đất vô chủ: tiến tới ô đất trống gần nhất, được quyền mua.", effect: { kind: "nearestfree" } },
  { text: "Thuế đất tăng: nộp 10tr cho mỗi ô đất bạn sở hữu.", effect: { kind: "perprop", amount: -10 } },
  { text: "Cho thuê mặt bằng: nhận 10tr cho mỗi ô đất bạn sở hữu.", effect: { kind: "perprop", amount: 10 } },
  { text: "Quyên góp quỹ từ thiện: trả 40tr cho người đang có ít tiền nhất.", effect: { kind: "poorest", amount: 40 } },
  { text: "Đầu tư thắng lớn: người giàu nhất phải chia cho bạn 30tr.", effect: { kind: "richest", amount: 30 } },
  { text: "Đến Nghỉ chân thư giãn một chút.", effect: { kind: "goto", pos: 20 } },
  { text: "Về thăm Hà Nội ăn phở. Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 37 } },
];

export const CHEST: DeckCard[] = [
  { text: "Tiến thẳng về Khởi hành. Nhận 200tr.", effect: { kind: "goto", pos: 0 } },
  { text: "Ngân hàng tính nhầm có lợi cho bạn. Nhận 200tr.", effect: { kind: "money", amount: 200 } },
  { text: "Tiền khám bệnh. Trả 50tr.", effect: { kind: "money", amount: -50 } },
  { text: "Bán cổ phiếu có lãi. Nhận 50tr.", effect: { kind: "money", amount: 50 } },
  { text: "Thẻ ra tù miễn phí. Giữ lại để dùng khi cần.", effect: { kind: "jailcard" } },
  { text: "Bị bắt vì đốt pháo Tết. Vào tù thẳng, không qua Khởi hành.", effect: { kind: "jail" } },
  { text: "Lì xì Tết. Nhận 100tr.", effect: { kind: "money", amount: 100 } },
  { text: "Hoàn thuế thu nhập. Nhận 20tr.", effect: { kind: "money", amount: 20 } },
  { text: "Hôm nay sinh nhật bạn — mỗi người chơi mừng 10tr.", effect: { kind: "each", amount: 10 } },
  { text: "Bảo hiểm nhân thọ đáo hạn. Nhận 100tr.", effect: { kind: "money", amount: 100 } },
  { text: "Tiền viện phí. Trả 100tr.", effect: { kind: "money", amount: -100 } },
  { text: "Đóng học phí cho con. Trả 50tr.", effect: { kind: "money", amount: -50 } },
  { text: "Phí tư vấn du lịch. Nhận 25tr.", effect: { kind: "money", amount: 25 } },
  { text: "Góp tiền làm đường làng: 40tr mỗi nhà, 115tr mỗi khách sạn.", effect: { kind: "repairs", house: 40, hotel: 115 } },
  { text: "Giải nhì cuộc thi hát karaoke. Nhận 10tr.", effect: { kind: "money", amount: 10 } },
  { text: "Được thừa kế mảnh vườn. Nhận 100tr.", effect: { kind: "money", amount: 100 } },
  { text: "Bán đồ cũ trên chợ mạng. Nhận 40tr.", effect: { kind: "money", amount: 40 } },
  { text: "Bạn bè trả nợ cũ. Nhận 60tr.", effect: { kind: "money", amount: 60 } },
  { text: "Thưởng cuối năm. Nhận 150tr.", effect: { kind: "money", amount: 150 } },
  { text: "Gia đình gửi tiền ăn học. Nhận 80tr.", effect: { kind: "money", amount: 80 } },
  { text: "Tiền điện nước tháng này. Trả 30tr.", effect: { kind: "money", amount: -30 } },
  { text: "Sửa xe máy hỏng. Trả 35tr.", effect: { kind: "money", amount: -35 } },
  { text: "Đi ăn cưới: mừng mỗi người chơi 20tr.", effect: { kind: "each", amount: -20 } },
  { text: "Tổ chức liên hoan: mỗi người chơi góp 15tr cho bạn.", effect: { kind: "each", amount: 15 } },
  { text: "Giảm thuế đất: nhận 15tr cho mỗi ô đất bạn sở hữu.", effect: { kind: "perprop", amount: 15 } },
  { text: "Phí quản lý khu dân cư: trả 15tr cho mỗi ô đất bạn sở hữu.", effect: { kind: "perprop", amount: -15 } },
  { text: "Làm từ thiện: tặng 50tr cho người đang có ít tiền nhất.", effect: { kind: "poorest", amount: 50 } },
  { text: "Đại gia hào phóng: người giàu nhất tặng bạn 40tr.", effect: { kind: "richest", amount: 40 } },
  { text: "Đi nhờ xe bạn — tiến thêm 2 ô.", effect: { kind: "forward", steps: 2 } },
  { text: "May mắn: được tung xúc xắc thêm một lượt.", effect: { kind: "rollagain" } },
  { text: "Được tặng đất: tiến tới ô đất trống gần nhất, được quyền mua.", effect: { kind: "nearestfree" } },
  { text: "Đi du lịch đảo Phú Quốc (Kiên Giang). Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 34 } },
];

/** Host settings. */
export const START_CASH_OPTIONS = [1000, 1500, 2000, 2500];
/** Minutes; 0 = play until one player is left. When time is up, richest wins. */
export const TIME_LIMIT_OPTIONS = [0, 20, 30, 45, 60];
export const DEFAULT_START_CASH = 1500;
export const DEFAULT_TIME_LIMIT = 30;

export const MIN_PLAYERS = 2;
export const MAX_SEATS = 6;
