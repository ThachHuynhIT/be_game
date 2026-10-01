# be_game

> Bảy game: **Tiến Lên Miền Nam** (`/api/ws`, `/api/rooms`, `/api/leaderboard`), **Mèo Nổ** (`/api/meono/*`), **Cờ Tỷ Phú** (`/api/typhu/*`), **Đá Quý** — lối chơi Splendor (`/api/splendor/*`), **Cờ Cá Ngựa** (`/api/cangua/*`), **Ô Ăn Quan** (`/api/oanquan/*`) và **Đấu Súng** — lối chơi Bang! kèm 7 bản mở rộng (`/api/bang/*`), cùng chung hạ tầng hub / Redis / chat. Luật từng game nằm sau một `GameAdapter` (`src/server/adapters.ts`), code ở `src/game/`, `src/meono/`, `src/typhu/`, `src/splendor/`, `src/bang/`, `src/cangua/`, `src/oanquan/`. Trên Vercel, các endpoint `/api/<game>/<kind>` dùng chung một function động `api/[game]/[kind].ts` để nằm trong giới hạn 12 function của gói Hobby.

Backend cho các game online trên portfolio, gồm luật chơi, phòng chơi và WebSocket realtime. Phần giao diện nằm trong repo [portfolio](https://github.com/ThachHuynhIT/portfolio) (`/tien-len` …) và kết nối tới backend này qua `NEXT_PUBLIC_TIENLEN_SERVER_URL`.

```
Trình duyệt (portfolio /tien-len)
      │  wss://<be_game>/api/ws
      ▼
Vercel Function api/ws.ts  (Node http.Server + ws, region sin1, Fluid compute)
      │  CAS (Lua) + pub/sub
      ▼
Redis (Upstash): trạng thái phòng dùng chung giữa các instance
```

## Game và endpoint

| Game | Code | Số người | WebSocket | Sảnh phòng | Bảng xếp hạng |
|---|---|---|---|---|---|
| Tiến Lên Miền Nam | `src/game/` | 2–4 | `/api/ws` | `/api/rooms` | `/api/leaderboard` |
| Mèo Nổ | `src/meono/` | 2–7 (tuỳ chế độ) | `/api/meono/ws` | `/api/meono/rooms` | `/api/meono/leaderboard` |
| Cờ Tỷ Phú | `src/typhu/` | 2–6 | `/api/typhu/ws` | `/api/typhu/rooms` | `/api/typhu/leaderboard` |
| Đá Quý (Splendor) | `src/splendor/` | 2–4 | `/api/splendor/ws` | `/api/splendor/rooms` | `/api/splendor/leaderboard` |
| Đấu Súng (Bang!) | `src/bang/` | 3–8 | `/api/bang/ws` | `/api/bang/rooms` | `/api/bang/leaderboard` |
| Cờ Cá Ngựa | `src/cangua/` | 2–4 | `/api/cangua/ws` | `/api/cangua/rooms` | `/api/cangua/leaderboard` |
| Ô Ăn Quan | `src/oanquan/` | 2 | `/api/oanquan/ws` | `/api/oanquan/rooms` | `/api/oanquan/leaderboard` |

`/rooms` trả các phòng còn người (tối đa 30), `/leaderboard?limit=20` (1–100) trả điểm mọi thời đại. `GET /api/health` kiểm tra store (Redis/RAM, vòng pub/sub). Bảng route nằm ở `src/server/app.ts`.

Trên Vercel có 5 function: `api/ws.ts`, `api/rooms.ts`, `api/leaderboard.ts`, `api/health.ts` (Tiến Lên + health) và `api/[game]/[kind].ts` cho mọi endpoint của 6 game còn lại. Mọi file đều export cùng một server; `app.ts` định tuyến theo path. Game mới chỉ cần thêm route trong `app.ts`, không thêm file vào `api/`.

**Mèo Nổ** (`src/meono/cards.ts`): 6 gói mở rộng (`imploding`, `streaking`, `barking`, `attacking`, `defending`, `zombie`). Chủ phòng chọn một trong 16 chế độ `PRESETS` (mỗi chế độ có số người tối thiểu/tối đa riêng) hoặc `custom` để tự tick gói; khi đó tối đa 5 người với bộ gốc, 6 nếu có gói bất kỳ, 7 nếu có Attacking Kittens. Không ai được "Không!" (Nope) chặn lá của chính mình: lá Không! đầu tiên không thể do người đánh lá gốc chơi, và không ai chặn lại lá Không! của chính mình (người đánh lá gốc vẫn được Không! đáp lại người vừa chặn).

**Ô Ăn Quan** (`src/oanquan/`, 2 người): 12 ô thành vòng — ô 0 và ô 6 là ô quan, người thứ nhất giữ ô 1–5, người thứ hai giữ ô 7–11; hướng `+1` là "phải" theo góc nhìn người đi. Lệnh `{ type: "move", cell, dir: 1 | -1 }`: bốc một ô dân bên mình, rải từng viên, gặp ô dân có quân thì rải tiếp, gặp ô quan có quân thì dừng, gặp ô trống rồi ô có quân thì ăn (ăn liên tiếp), hai ô trống liền thì dừng. Luật bàn: giá quan 5/10 dân, **quan non** (ô quan còn quan mà dưới 5 dân thì không ăn được; bật sẵn), thời gian lượt 15/20/30/45 giây, điểm Nhất/Nhì. Đầu lượt mà hàng mình trống thì tự rải quân (5 dân từ phần đã ăn, thiếu thì vay đối thủ — khoản vay trả lại khi tính điểm; không đủ cả hai bên thì thua). Hết cả hai quan và ô quan trống thì mỗi bên thu dân trên hàng mình; điểm = dân + quan × giá − vay + cho vay, có thể hoà (0 điểm xếp hạng). `lastMove` trong view gồm bàn trước nước đi và từng bước (`pick` / `sow` / `capture`) để client diễn hoạt. Hết giờ hoặc mất kết nối thì máy đi một nước hợp lệ ngẫu nhiên.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/bang/` | Đấu Súng (xem mục riêng bên dưới) |
| `src/cangua/` | Cờ Cá Ngựa: `board` (bàn 15×15, đường 56 ô, chuồng 6 bậc — chép sang portfolio), `game`, `room`, `protocol`. Luật tuỳ chọn: xuất quân bằng 1 hoặc 6, không nhảy qua đầu ngựa, lên chuồng theo số, ba lần 6 mất lượt, xếp hạng hết |
| `src/oanquan/` | Ô Ăn Quan: `board` (bố cục 12 ô, tuỳ chọn), `game`, `room`, `protocol` (xem mục riêng bên dưới) |
| `src/meono/`, `src/typhu/`, `src/splendor/` | Mèo Nổ, Cờ Tỷ Phú, Đá Quý: `cards`/`board`, `game`, `room`, `protocol` |
| `src/game/` | Luật chơi thuần TS: `cards`, `combos` (nhận diện bộ, chặn, chặt), `rules` (tới trắng), `game` (máy trạng thái ván), `room` (vòng đời phòng, không dùng timer), `protocol` (định dạng message) |
| `src/server/hub.ts` | Xử lý từng kết nối: load → apply → compare-and-swap, phát thay đổi qua pub/sub, timer lượt, gửi `reconnect` trước khi hết thời gian của function |
| `src/server/store.ts` | Store Redis (`REDIS_URL` / `KV_URL`) hoặc store trong RAM nếu không có Redis |
| `src/server/adapters.ts` | `GameAdapter` cho từng game (join, lệnh, view, tick…) |
| `src/server/app.ts` | `http.Server` dùng chung cho cả Vercel lẫn chạy local, kèm bảng route |
| `api/*.ts`, `api/[game]/[kind].ts` | Các Vercel Function (xem trên) |
| `src/local.ts` | Server chạy local / tự host |
| `test/` | vitest: luật chơi từng game, phòng, hub (gồm cả giả lập 2 instance), kiểm tra origin |

## Đấu Súng (`src/bang/`)

Lối chơi Bang! cho 3–8 người: Cảnh sát trưởng / Phó / Kẻ cướp / Kẻ phản bội (3 người: mỗi vai săn 1 vai khác). Tên lá, nhân vật và lời mô tả là của riêng mình.

| File | Nội dung |
|---|---|
| `cards.ts` | 167 lá chơi (bộ gốc 80, Thị trấn Né Đạn 40, Thung Lũng Bóng Ma 24, Trang Bị Tận Răng 23), 63 nhân vật, 38 lá sự kiện, 12 loại trang bị Cơn Sốt Vàng. Chép nguyên sang portfolio |
| `game.ts` | Lõi: chọn nhân vật, lượt (đầu lượt → rút → đánh → bỏ bài), hàng chờ `queue` (mọi thứ cần người chơi trả lời: bị bắn, Tạp Hoá, Cứu Nguy…), sát thương, cái chết, thắng thua, rút!, khoảng cách |
| `actions.ts` | Đánh bài, lá xanh lá / lá có đạn, kỹ năng nhân vật & sự kiện, cửa hàng vàng, trả lời, kết thúc lượt, tự chơi khi hết giờ |
| `room.ts` | Vòng đời phòng, luật bàn (bộ mở rộng, thời gian lượt / trả lời, điểm thắng), view riêng từng người (giấu vai trò và bài trên tay) |

Bản mở rộng chủ phòng bật được: **Thị trấn Né Đạn** (lá xanh lá, lá phải bỏ kèm 1 lá; bật sẵn khi tạo phòng), **Giữa Trưa** và **Nắm Bài** (bộ sự kiện đổi luật mỗi vòng), **Gánh Xiếc Miền Tây**, **Cơn Sốt Vàng** (vàng + cửa hàng), **Thung Lũng Bóng Ma** (hồn ma, cứu nguy…), **Trang Bị Tận Răng** (đạn nạp lên lá). Vài chỗ giản lược so với bản giấy được ghi ngay trong lời mô tả lá.

Mọi trạng thái là JSON thuần (lưu trong Redis): hiệu ứng đang chờ nằm trong `queue` dưới dạng dữ liệu và được `run()` xử lý lần lượt. Người chơi hết giờ hoặc mất kết nối được `tickGame()` trả lời thay (đỡ nếu có Trượt!, không thì chịu đòn; hết giờ lượt thì bỏ bài dư và qua lượt). `test/bang.test.ts` có cả bài chơi ngẫu nhiên hàng trăm ván với mọi bản mở rộng, kiểm tra không lá nào bị mất hay nhân đôi.

## Chạy local

```bash
npm install
npm run dev          # tsx watch: http://localhost:4000 , ws://localhost:4000/api/ws
npm start            # như trên, không watch
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

Không có Redis thì dùng store trong RAM. Mẫu biến môi trường: `.env.example`.

Ở repo portfolio, đặt `NEXT_PUBLIC_TIENLEN_SERVER_URL=http://localhost:4000` (đây cũng là giá trị mặc định khi không đặt), rồi chạy `npm run dev`.

## Deploy lên Vercel

1. Trên Vercel: **Add New → Project**, import repo `be_game`. Framework Preset để **Other**; không cần Build Command.
2. Vào **Settings → Functions**, bật **Fluid compute** (project mới được bật sẵn). WebSocket cần Fluid compute.
3. Vào **Storage / Marketplace**, thêm **Upstash for Redis** (gói Free), chọn region **Singapore**, rồi gắn vào project `be_game`. Vercel tự thêm `REDIS_URL` / `KV_URL`.
4. (Tuỳ chọn) Đặt biến môi trường `ALLOWED_ORIGIN=https://<domain-portfolio>,https://*.vercel.app` để chỉ trang của bạn kết nối được.
5. Deploy xong, mở `https://<be_game>.vercel.app/api/health`. Kết quả mong đợi: `"ok": true`, `"store": "redis"`, `"region": "sin1"`.
6. Ở project **portfolio** trên Vercel, thêm `NEXT_PUBLIC_TIENLEN_SERVER_URL=https://<be_game>.vercel.app` rồi redeploy.

Region đã được đặt là `sin1` trong `vercel.json`.

### Giới hạn của Vercel
- Mỗi kết nối WebSocket chỉ sống bằng thời gian tối đa của function, trên gói Hobby là **300 giây**. Khoảng 25 giây trước khi hết hạn, server gửi `{type:"reconnect"}`; client mở kết nối mới rồi mới đóng kết nối cũ, nên người chơi không bị văng.
- Phải có Redis. Người chơi trong cùng một phòng có thể nằm trên những instance khác nhau, và store trong RAM chỉ dùng được khi chạy một tiến trình duy nhất (chạy local / tự host).
- WebSocket trên Vercel vẫn đang **Beta**.

## Giao thức

Client → server (mọi message trừ `ping` đều có `id` và được server trả `ack`):
- Chung mọi game (`src/server/hub.ts`): `create` · `join {code,name,token}` · `watch {code,name,token}` (khán giả) · `leave` · `emoji {emoji}` · `chat {text}` · `ping` (heartbeat, client gửi mỗi 10 giây)
- Tiến Lên: `start` · `play {cards}` · `pass` · `kick {playerId}` · `settings`. Các game khác có lệnh riêng trong `src/<game>/protocol.ts`.

Server → client: `ack {id, ok, error?, code?}` · `state {view}` (mỗi người chỉ nhận bài của mình) · `reconnect` · `pong`

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `REDIS_URL` / `KV_URL` / `UPSTASH_REDIS_URL` | _(trống = store trong RAM)_ | Redis để lưu phòng, lấy biến đầu tiên có giá trị theo thứ tự này. Trên Vercel là bắt buộc |
| `ALLOWED_ORIGIN` | _(trống = cho phép tất cả)_ | Danh sách origin được phép kết nối, ngăn cách bằng dấu phẩy, hỗ trợ `*` |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Cổng và địa chỉ lắng nghe khi chạy local |
| `VERCEL`, `VERCEL_REGION` | _(Vercel tự đặt)_ | Chỉ đọc: cảnh báo khi thiếu Redis trên Vercel, và trường `region` của `/api/health` |
