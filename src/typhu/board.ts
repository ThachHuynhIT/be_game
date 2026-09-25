/**
 * Cờ Tỷ Phú board: 40 squares, Vietnamese places instead of the classic streets.
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
  prop("Châu Đốc", "Núi Sam", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]),
  prop("Bến Tre", "Xứ dừa", "lightblue", 120, 50, [8, 40, 100, 300, 450, 600]),
  { kind: "jail", name: "Nhà tù" },
  prop("Vũng Tàu", "Tượng Chúa Kitô", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
  { kind: "util", name: "Công ty Điện lực", price: 150 },
  prop("Phan Thiết", "Đồi cát Mũi Né", "pink", 140, 100, [10, 50, 150, 450, 625, 750]),
  prop("Đà Lạt", "Hồ Xuân Hương", "pink", 160, 100, [12, 60, 180, 500, 700, 900]),
  { kind: "air", name: "Sân bay Cam Ranh", price: 200 },
  prop("Buôn Ma Thuột", "Thủ phủ cà phê", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
  { kind: "chest", name: "Khí vận" },
  prop("Quy Nhơn", "Eo Gió", "orange", 180, 100, [14, 70, 200, 550, 750, 950]),
  prop("Nha Trang", "Vịnh Nha Trang", "orange", 200, 100, [16, 80, 220, 600, 800, 1000]),
  { kind: "parking", name: "Nghỉ chân" },
  prop("Hội An", "Phố cổ", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
  { kind: "chance", name: "Cơ hội" },
  prop("Huế", "Đại Nội", "red", 220, 150, [18, 90, 250, 700, 875, 1050]),
  prop("Đà Nẵng", "Cầu Rồng", "red", 240, 150, [20, 100, 300, 750, 925, 1100]),
  { kind: "air", name: "Sân bay Phú Bài", price: 200 },
  prop("Ninh Bình", "Tràng An", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
  prop("Sa Pa", "Đỉnh Fansipan", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]),
  { kind: "util", name: "Nhà máy Nước", price: 150 },
  prop("Hạ Long", "Vịnh Hạ Long", "yellow", 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { kind: "gotojail", name: "Vào tù" },
  prop("Hải Phòng", "Thành phố hoa phượng", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
  prop("Côn Đảo", "Bãi Đầm Trầu", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { kind: "chest", name: "Khí vận" },
  prop("Phú Quốc", "Đảo ngọc", "green", 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  { kind: "air", name: "Sân bay Nội Bài", price: 200 },
  { kind: "chance", name: "Cơ hội" },
  prop("Hà Nội", "Hồ Hoàn Kiếm", "darkblue", 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { kind: "tax", name: "Thuế xa xỉ", amount: 100 },
  prop("TP. Hồ Chí Minh", "Phố đi bộ Nguyễn Huệ", "darkblue", 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

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
export const groupPositions = (group: Group) =>
  BOARD.flatMap((sq, i) => (sq.kind === "prop" && sq.group === group ? [i] : []));

export const mortgageValue = (sq: Ownable) => sq.price / 2;
/** Lifting a mortgage costs its value + 10%. */
export const unmortgageCost = (sq: Ownable) => Math.ceil((sq.price * 11) / 20);

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
  | { kind: "nearest"; target: "air" | "util" };

export interface DeckCard {
  text: string;
  effect: CardEffect;
}

export const CHANCE: DeckCard[] = [
  { text: "Tiến thẳng về Khởi hành. Nhận 200tr.", effect: { kind: "goto", pos: 0 } },
  { text: "Bay vào TP. Hồ Chí Minh dạo phố đi bộ Nguyễn Huệ.", effect: { kind: "goto", pos: 39 } },
  { text: "Đi ngắm Cầu Rồng phun lửa ở Đà Nẵng. Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 24 } },
  { text: "Đi tắm biển Vũng Tàu. Qua Khởi hành thì nhận 200tr.", effect: { kind: "goto", pos: 11 } },
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
];

/** Host settings. */
export const START_CASH_OPTIONS = [1000, 1500, 2000, 2500];
/** Minutes; 0 = play until one player is left. When time is up, richest wins. */
export const TIME_LIMIT_OPTIONS = [0, 20, 30, 45, 60];
export const DEFAULT_START_CASH = 1500;
export const DEFAULT_TIME_LIMIT = 30;

export const MIN_PLAYERS = 2;
export const MAX_SEATS = 6;
