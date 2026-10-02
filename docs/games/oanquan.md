# Ô Ăn Quan (`oanquan`)
> Trò rải quân dân gian trên vòng 6 × N ô · 2–4 người · frontend `/o-an-quan` · `/api/oanquan/ws`, `/api/oanquan/rooms`, `/api/oanquan/leaderboard`

Hạ tầng chung (hub, adapter, store, giao thức WS, chat, emoji, khán giả, bảng xếp hạng) xem [`../GUIDE.md`](../GUIDE.md). File này chỉ mô tả phần riêng của Ô Ăn Quan.

## Tệp

| File | Vai trò |
|---|---|
| `src/oanquan/board.ts` | Bố cục bàn và hằng số: `SEGMENT = 6`, `CELLS = 12` (bàn 2 người), `cellsFor(n)`, `quanCellsFor(n)`, `rowOf(side)`, `ROWS`, `START_DAN`, `QUAN_NON_MIN`, `RESEED`, `MIN_PLAYERS = 2`, `MAX_PLAYERS = 4`, `maxMovesFor(n)`, tuỳ chọn cài đặt; helper `isQuanCell`, `quanIndex`, `sideOfCell`, `nextCell(c, dir, cells)` |
| `src/oanquan/game.ts` | Máy trạng thái thuần `OQState`: `newOQGame`, `makeMove` (+ `sow` nội bộ), `legalMoves`, `scoreOf`, `lentOf`, `forfeitPlayer`, `tickGame`, `nextGameTickAt` |
| `src/oanquan/room.ts` | Vòng đời phòng `OQRoom`: `joinOQ`, `leaveOQ`, `oqHeartbeat`, `oqCommand`, cài đặt, kick, ghi kết quả, `tickOQ`, `nextOQTickAt`, `oqView`, `oqSummary`, `isOQActive` |
| `src/oanquan/protocol.ts` | Kiểu dây: `OQSettings`, `OQStep`, `OQMove`, `OQReseed`, `OQRoomView`/`OQGameView`/`OQPlayerView`, `OQCommand`, `OANQUAN_WS_PATH` |
| `src/server/adapters.ts` | `oanquanAdapter` |
| `test/oanquan.test.ts`, `test/oanquan-multi.test.ts` | Test (2 người; 3–4 người) |

## Luật chơi (như code đang chạy)

**Bàn** (`board.ts`) — với N người (2–4) vòng có `6N` ô gồm N **đoạn**; đoạn `i` (người `players[i]`, "side i") là ô quan `6i` rồi 5 ô dân `6i+1 … 6i+5`. Chỉ số tăng theo chiều `+1`; nhìn từ phía người 0 ở bàn 2 người, chỉ số tăng từ trái sang phải ở hàng dưới (1→5), lên ô 6, rồi phải sang trái ở hàng trên (7→11), về ô 0:

```
            11  10   9   8   7          ← side 1 (players[1]) giữ ô 7–11
     (0)                          (6)   ← ô quan trái / phải
             1   2   3   4   5          ← side 0 (players[0]) giữ ô 1–5
```

Bàn 3 người (18 ô) là tam giác, 4 người (24 ô) là hình vuông: mỗi người một cạnh, ô quan ở góc đầu cạnh; client xoay để cạnh của mình ở dưới, chạy trái → phải.

- Ô quan của đoạn `i` là `6i` (`quanCellsFor(n)`); `quan[i]` (`quanIndex(c) = c / 6`) cho biết quân quan còn trên ô đó không. `rowOf(i) = [6i+1 … 6i+5]`.
- `dir = +1` đi tới ô chỉ số lớn hơn (= "phải" theo góc nhìn người đang đi, vì client xoay bàn cho mỗi người), `dir = −1` là "trái". `nextCell(c, dir, cells) = (c + dir + cells) % cells` — rải **đi vòng cả bàn**, qua ô quan và ô của mọi người.
- Khởi đầu: mỗi ô dân `START_DAN = 5` dân (tổng `25N`), ô quan 0 dân + 1 quân quan.
- Một ô là **trống** (`isEmpty`) khi 0 dân **và** (không phải ô quan hoặc quân quan đã bị ăn). Ô quan chỉ còn quân quan (0 dân) **không trống**.

**Chuẩn bị**: `newOQGame` nhận 2–4 người (`MIN_PLAYERS = 2`, `MAX_PLAYERS = 4`, ngoài khoảng thì ném lỗi). 2 người: `random() < 0.5` giữ nguyên hoặc đảo; 3–4 người: xáo Fisher–Yates bằng `random`. Thứ tự này vừa là thứ tự ngồi (đoạn `i`) vừa là thứ tự lượt; `players[0]` đi trước.

**Một nước đi** `makeMove(cell, dir)` — chỉ ô dân bên mình (`sideOfCell(cell) === side`) và không rỗng; hàm nội bộ `sow`:
1. Bốc hết dân ở `cell`, rải lần lượt mỗi ô 1 viên theo `dir` (ô quan cũng nhận dân).
2. Hết dân trên tay, xét ô kế tiếp `n1`:
   - `n1` **không trống**: nếu là ô quan → **dừng, mất lượt** (không bốc ô quan). Nếu là ô dân (của bất kỳ bên nào) → bốc hết rồi rải tiếp (quay lại bước 1).
   - `n1` **trống**: xét ô sau đó `t`:
     - `t` trống (hai ô trống liền) → dừng, không ăn gì.
     - `t` là ô quan còn quân quan, bật **quan non** (`quanNon`) và `dan[t] < QUAN_NON_MIN (5)` → dừng, không ăn.
     - Ngược lại **ăn** ô `t`: cộng `dan[t]` vào `captured[id].dan`; nếu `t` còn quân quan thì ăn luôn quân quan (`captured[id].quan += 1`, `quan[...] = false`). Rồi xét `gap = next(t)`: nếu `gap` trống thì lặp lại với ô sau `gap` (**ăn liên tiếp** kiểu trống → đầy → trống → đầy…), không trống thì dừng.
3. Vòng lặp được chặn bởi `MAX_STEPS = 2_000` lượt bốc/rải lại (chống lặp vô hạn; về lý thuyết không xảy ra).
4. Mỗi bước được ghi vào `steps` (`pick` / `sow` / `capture`) cho client diễn hoạt.

**Sau nước đi** (`endTurn`):
- Nếu **mọi** quân quan đã bị ăn **và** mọi ô quan 0 dân → `finishBoard("board")`.
- Nếu `moves ≥ maxMovesFor(N) (200 × N, tức 400 với 2 người)` → `finishBoard("limit")`.
- Ngược lại `beginTurn(nextActive)` — người kế tiếp **chưa bị loại** theo thứ tự ngồi.

**Rải quân khi hàng trống** (`beginTurn`): nếu đầu lượt cả 5 ô dân của người sắp đi đều 0:
- `lenders` = những người còn chơi (chưa bị loại) theo thứ tự lượt **sau** người đó (vòng quanh bàn, không gồm chính họ). Nếu `captured[id].dan + Σ captured[lender].dan < RESEED (5)` → người đó **bị loại** (`eliminate`, log "bị loại"): vào `out`, bỏ lượt từ nay, **dân trên các ô của họ vẫn nằm trên bàn** (người khác vẫn rải qua / bốc / ăn được; cuối ván không ai thu hàng đó), dân đã ăn của họ giữ nguyên và vẫn tính điểm. Nếu chỉ còn một người chưa bị loại → ván kết thúc ngay (`endReason = "stuck"`, người đó thắng — **không so điểm**). Ngược lại lượt chuyển cho người kế tiếp (có thể chính họ lại phải rải quân / bị loại).
- Ngược lại lấy 5 dân đặt mỗi ô 1 viên: dùng dân đã ăn của mình trước; thiếu thì vay lần lượt từng `lender` còn dân (người kế tiếp trước, rồi người sau nữa…), mỗi người cho `min(còn thiếu, dân của họ)`. Ghi `debts[người vay][người cho vay] += n`, `borrowed[người vay] += n`. `lastReseed = { seq, player, borrowed, lenders?: [{ id, n }] }`. Quân quan đã ăn không dùng để rải.
- 2 người: đúng luật cũ (vay đối thủ; `own + opp < 5` thì thua vì người kia là người duy nhất còn lại).

**Điểm** `scoreOf(id) = captured.dan + captured.quan × quanValue − borrowed[id] + lentOf(id)`, `lentOf(id) = Σ_p debts[p][id]` (khoản vay là nợ: người vay bị trừ, **đúng người cho vay** được cộng lại).

**Kết thúc theo bàn** (`finishBoard`): mỗi người **còn chơi** thu hết dân còn trên hàng mình vào `captured.dan` (hàng của người đã bị loại không ai thu). Với `"limit"`, dân còn trên ô quan và quân quan chưa bị ăn **không tính cho ai**. Rồi `finish`:
- Xếp hạng (`ranks`, 0 = nhất): những người còn chơi theo `scoreOf` giảm dần, **bằng điểm thì chung hạng** (hạng = vị trí của người đầu nhóm, ví dụ 0, 0, 2); sau đó những người bị loại, người bị loại muộn hơn xếp trên. `finished` = thứ tự đó.
- `winner` = người duy nhất hạng 0 (hoặc người cuối cùng còn trụ lại khi `stuck` / `forfeit`); chung hạng nhất thì `winner = null` (hoà).

## Cài đặt phòng

Lệnh `settings` (chỉ chủ phòng, không có ván `playing`), kiểm tra ở `setSettings` (`room.ts`); giá trị hiện hành `oqSettingsOf(room)` = `DEFAULT_OQ_SETTINGS` + `room.settings`; áp dụng khi `start`.

| Trường | Kiểu / tuỳ chọn | Mặc định | Tác dụng | Kiểm tra ở |
|---|---|---|---|---|
| `quanValue` | `QUAN_VALUE_OPTIONS = [5, 10]` | `DEFAULT_QUAN_VALUE = 10` | Một quân quan = bao nhiêu dân khi tính điểm | `setSettings` |
| `quanNon` | `boolean` | `true` | Ô quan còn quân quan mà < 5 dân thì không ăn được | `setSettings` (`typeof === "boolean"`) |
| `turnSeconds` | `TURN_SECONDS_OPTIONS = [15, 20, 30, 45]` | `DEFAULT_TURN_SECONDS = 30` | Hạn mỗi lượt | `setSettings` |
| `first` | số nguyên 1…20 | `2` | Điểm xếp hạng người thắng | `checkRankPoints` (`src/game/scoring.ts`) |
| `second` | số nguyên 0…`first` | `1` | Điểm hạng Nhì (3–4 người; 2 người không dùng) | `checkRankPoints` |

## State

`OQState` (`game.ts`):

| Trường | Ý nghĩa |
|---|---|
| `players` | `[side0 … side(N−1)]` — vừa là thứ tự ngồi vừa là thứ tự lượt |
| `turn`, `phaseAt`, `deadline` | Người đang đi, lúc lượt bắt đầu, hạn lượt |
| `dan: number[6N]` | Số dân mỗi ô (kể cả ô quan) |
| `quan: boolean[N]` | Quân quan còn ở ô 0, 6, 12, 18 (theo đoạn) |
| `captured[id]` | `{ dan, quan }` đã ăn (dân bị trừ khi rải quân) |
| `borrowed[id]` | Tổng dân đã vay |
| `debts[vay][cho vay]` | Dân đang nợ từng người cho vay |
| `out: string[]` | Người đã bị loại / bị kích, theo thứ tự bị loại |
| `ranks[id]` | Hạng cuối ván (0 = nhất, chung hạng dùng cùng số); `{}` khi đang chơi |
| `quanValue`, `quanNon` | Luật bàn chép từ cài đặt |
| `moves` | Số nước đã đi |
| `status`, `finished`, `winner`, `endReason` | `"playing" → "ended"`; `endReason ∈ "board" \| "stuck" \| "forfeit" \| "limit"`; `winner = null` là hoà |
| `lastMove`, `lastReseed` | Cho animation (xem View) |
| `log` (tối đa `LOG_LIMIT = 30`), `logSeq`, `recorded?`, `turnMs?` | |

```mermaid
stateDiagram-v2
  [*] --> playing: newOQGame
  playing --> playing: move → beginTurn(đối thủ) (có thể rải quân)
  playing --> ended_board: hết quan & ô quan trống
  playing --> ended_limit: moves ≥ 400
  playing --> playing: hàng trống & không ai cho vay đủ → người đó bị loại, ván tiếp tục
  playing --> ended_stuck: chỉ còn một người chưa bị loại (do hết dân rải quân)
  playing --> ended_forfeit: kick người offline → còn một người
```

`OQRoom` (`room.ts`) giống các game khác: 4 ghế (`seats`, `MAX_PLAYERS`; ván cần 2–4 người; `OQPlayer`), `hostId`, `current`, `settings?`, `history?`, `gameSeq?`, `spectators?`, `reactions?`, `chat?`.

## Lệnh (client → server)

`oqCommand(room, token, msg, now)`. Lỗi chung: `"Bạn không còn trong phòng"`, `"Chưa bắt đầu ván"`, `"Bạn không chơi ván này"`, `"Lệnh không hợp lệ"`.

| `type` | Trường | Khi nào được | Tác dụng | Lỗi thường gặp |
|---|---|---|---|---|
| `start` | — | Chủ phòng, không có ván `playing`, có 2–4 người | `newOQGame` với cài đặt hiện hành | `"Chỉ chủ phòng mới bắt đầu được"`, `"Ván đang diễn ra"`, `"Cần đủ 2 người"` (ít nhất), `"Phòng đã đủ 4 người"` khi vào |
| `settings` | `quanValue?`, `quanNon?`, `turnSeconds?`, `first?`, `second?` | Chủ phòng, không có ván `playing` | Cập nhật `room.settings` | `"Chỉ chủ phòng mới đổi luật"`, `"Đổi luật khi ván đã kết thúc"`, `"Giá trị quan không hợp lệ"`, `"Luật quan non không hợp lệ"`, `"Thời gian lượt không hợp lệ"` |
| `kick` | `playerId` | Chủ phòng; mục tiêu offline | Trong ván: `forfeitPlayer` → người đó bị loại (còn 1 người thì người đó thắng, `forfeit`); ngoài ván: giải phóng ghế | `"Chỉ kích được người đã mất kết nối"`, `"Không thể tự kích mình"`, `"Không tìm thấy người chơi"` |
| `move` | `cell: 6·side+1 … 6·side+5`, `dir: 1 \| -1` | Lượt mình | Rải / ăn như trên, chuyển lượt | `"Ván đã kết thúc"`, `"Chưa đến lượt bạn"`, `"Chọn hướng rải trái hoặc phải"`, `"Chỉ được chọn ô dân bên mình"`, `"Ô này đang trống"` |

## View (server → client)

`oqView(room, player | null, now)` → `OQRoomView`. Không có thông tin ẩn: mọi người (kể cả khán giả) nhận cùng `current`; chỉ `meId`/`role` khác nhau.
- `winner` có thể `null` khi chung hạng nhất; `finished` là thứ tự xếp hạng.
- Phần chung: `game: "oanquan"`, `code`, `meId`, `role`, `serverTime`, `settings`, `seats[]`, `history` (10 ván cuối), `spectators`, `reactions`, `chat`.
- `current` (`OQGameView`): `status`, `turn`, `deadline`, `dan`, `quan`, `quanValue`, `quanNon`, `moves`, `finished`, `winner`, `endReason`, `log`, và:
  - `players[]`: `{ id, side, captured, borrowed, lent, out, rank, score }` — `side` = chỉ số đoạn (= thứ tự lượt); `lent` = `lentOf`; `out` = đã bị loại; `rank` = hạng cuối ván (`null` khi đang chơi); `score` = `scoreOf` tại thời điểm hiện tại (sau khi kết thúc thì đã gồm dân thu về từ hàng).
  - `lastMove: OQMove` = `{ seq, player, cell, dir, before: { dan, quan }, steps, auto? }`. `before` là bàn **ngay trước nước đi** (sau khi đã rải quân đầu lượt nếu có). `steps` theo đúng thứ tự: `{k:"pick", cell, n}`, `{k:"sow", cell}`, `{k:"capture", cell, dan, quan}`. Client tua lại từ `before` theo `steps` là ra bàn ngay sau nước đi (chưa gồm bước rải quân đầu lượt của người kế tiếp, hay bước thu dân về khi ván kết thúc). `auto: true` khi máy đi hộ. `seq = logSeq + 1` lúc đi (trùng id dòng log của nước đó).
  - `lastReseed: OQReseed | null` = `{ seq, player, borrowed, lenders? }` của lần rải quân gần nhất (`lenders`: ai cho vay bao nhiêu).

## Timer, hết giờ, mất kết nối

- `TURN_MS = 30_000` (dùng `turnMs` từ cài đặt), `ABSENT_MS = 2_500`.
- `tickGame` đi hộ khi `now ≥ deadline` hoặc người đến lượt vắng mặt (không có ghế / `!isOnline`: đã `leave` hoặc quá `PRESENCE_TIMEOUT_MS = 25s`) và `now ≥ phaseAt + ABSENT_MS`: chọn **ngẫu nhiên** một nước trong `legalMoves` (mỗi ô dân không rỗng × 2 hướng), `makeMove(..., auto = true)`.
- `nextGameTickAt` = min(`deadline`, `phaseAt + ABSENT_MS` nếu còn ở tương lai); hub dùng `nextOQTickAt`.
- `leave` giữa ván giữ ghế và bị đi hộ; chủ phòng kick người offline → `forfeitPlayer`: người đó bị loại (lượt chuyển tiếp nếu đang là lượt họ); còn đúng một người thì người đó thắng (`endReason = "forfeit"`).

## Kết thúc ván & tính điểm

- `finish(reason, sole)`: tính `ranks`, `finished`, `winner` như trên.
- `afterChange` (room): `scoreByRank(finished, settings)` (`+first, +second, …, −second, −first`, 2 người `+first / −first`). **Chung hạng** chia nhau điểm trung bình của các vị trí họ chiếm (cắt về 0, nên 2 người hoà = 0 điểm cả hai); `rank` trong `GameRecord` là hạng chung; `wins` chỉ tăng cho người **duy nhất** hạng nhất. Record `{ id: "<code>-<gameSeq>", at, instantWin: null, results }` vào `history`; hub ghi bảng xếp hạng.

## Test

`test/oanquan-multi.test.ts` (3–4 người): bàn `6N` ô; rải / rải tiếp qua ranh giới đoạn (cả hai hướng); chỉ chọn ô đoạn mình; vòng lượt a→b→c→d; ăn quan của người khác (+ quan non); ăn liên tiếp qua vòng; rải quân bằng dân của mình, vay nhiều người theo thứ tự lượt (`debts`, điểm người cho vay), bị loại và bỏ lượt, ô người bị loại vẫn ăn được, chỉ còn một người thì thắng, kick giữa ván; kết thúc + xếp hạng 3/4 người (chung hạng, nợ đúng chủ, hàng người bị loại không thu); 40 ván ngẫu nhiên 3–4 người; phòng 3 người (ghế, điểm xếp hạng, kick).

`test/oanquan.test.ts` (2 người): bàn khởi đầu; nước hợp lệ (chỉ ô bên mình, cả 2 hướng); rải + rải tiếp + ăn (kiểm tra `lastMove.before`/`steps`); rải sang trái vòng qua ô 0; dừng trước ô quan không trống; dừng khi 2 ô trống; ăn liên tiếp kể cả ô quan; ăn quân quan; quan non bật/tắt; ô quan chỉ còn quân quan không trống; rải quân bằng dân của mình, vay đối thủ, thua khi không đủ; kết thúc theo bàn, hoà; đi hộ khi hết giờ / offline; **60 ván ngẫu nhiên** luôn kết thúc và bảo toàn 50 dân; luồng phòng (cài đặt, start, move, điểm, hoà = 0, kick → forfeit).

Viết test tất định:
- `const s = newOQGame(["a","b"], T, { quanValue: 10, quanNon: true }, () => 0); s.players = ["a","b"]; s.turn = "a";`
- Dựng bàn tuỳ ý bằng cách gán `s.dan = [...12 số]`, `s.quan = [bool, bool]`, `s.captured[id] = {dan, quan}`; tổng dân bảo toàn = `Σ dan + Σ captured.dan` (dùng để kiểm tra).
- `tickGame(s, now, names, absent, random)` nhận `random` để chọn nước đi hộ; room `tickOQ` không nhận `random` (dùng `Math.random`).

## Lưu ý / bẫy thường gặp

- Hướng `dir` là theo **chỉ số ô**, không theo màn hình: client xoay bàn cho mỗi người (đoạn của mình ở dưới, chạy trái → phải) nên `+1` vẫn là "phải" với mọi người.
- Ô quan chỉ còn quân quan (0 dân) **chặn** cả rải tiếp lẫn chuỗi ăn (không trống). Dân rơi vào ô quan đã mất quân quan vẫn ăn được bình thường (quan non không áp dụng).
- Ván chỉ kết thúc theo bàn khi **mọi** ô quan vừa mất quân quan vừa hết dân — dân rải vào ô quan sau khi quân quan bị ăn sẽ kéo dài ván.
- Bị loại vì không đủ dân để rải quân không xét điểm; còn một người chưa bị loại thì người đó thắng bất kể điểm.
- `second` chỉ ảnh hưởng điểm xếp hạng khi có từ 3 người.
- Chung hạng làm điểm xếp hạng cả ván có thể lệch 0 (cắt về 0 khi chia trung bình); hai người hoà thì vẫn 0.
- Với `"limit"` (400 nước) phần trên ô quan bị bỏ; tổng điểm hai bên có thể < 50 + 2 × `quanValue`.
