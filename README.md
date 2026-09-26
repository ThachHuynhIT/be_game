# be_game

> Năm game: **Tiến Lên Miền Nam** (`/api/ws`, `/api/rooms`, `/api/leaderboard`), **Mèo Nổ** (`/api/meono/*`), **Cờ Tỷ Phú** (`/api/typhu/*`), **Đá Quý** — lối chơi Splendor (`/api/splendor/*`) và **Đấu Súng** — lối chơi Bang! kèm 7 bản mở rộng (`/api/bang/*`), cùng chung hạ tầng hub / Redis / chat. Luật từng game nằm sau một `GameAdapter` (`src/server/adapters.ts`), code ở `src/game/`, `src/meono/`, `src/typhu/`, `src/splendor/`, `src/bang/`. Trên Vercel, các endpoint `/api/<game>/<kind>` dùng chung một function động `api/[game]/[kind].ts` để nằm trong giới hạn 12 function của gói Hobby.

Backend cho game **Tiến Lên Miền Nam online**, gồm luật chơi, phòng chơi và WebSocket realtime. Phần giao diện nằm trong repo [portfolio](https://github.com/ThachHuynhIT/portfolio) (`/tien-len`) và kết nối tới backend này qua `NEXT_PUBLIC_TIENLEN_SERVER_URL`.

```
Trình duyệt (portfolio /tien-len)
      │  wss://<be_game>/api/ws
      ▼
Vercel Function api/ws.ts  (Node http.Server + ws, region sin1, Fluid compute)
      │  CAS (Lua) + pub/sub
      ▼
Redis (Upstash): trạng thái phòng dùng chung giữa các instance
```

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/bang/` | Đấu Súng (xem mục riêng bên dưới) |
| `src/game/` | Luật chơi thuần TS: `cards`, `combos` (nhận diện bộ, chặn, chặt), `rules` (tới trắng), `game` (máy trạng thái ván), `room` (vòng đời phòng, không dùng timer), `protocol` (định dạng message) |
| `src/server/hub.ts` | Xử lý từng kết nối: load → apply → compare-and-swap, phát thay đổi qua pub/sub, timer lượt, gửi `reconnect` trước khi hết thời gian của function |
| `src/server/store.ts` | Store Redis (`REDIS_URL` / `KV_URL`) hoặc store trong RAM nếu không có Redis |
| `src/server/app.ts` | `http.Server` dùng chung cho cả Vercel lẫn chạy local |
| `api/ws.ts`, `api/health.ts` | Các Vercel Function |
| `src/local.ts` | Server chạy local / tự host |
| `test/` | vitest: luật chơi, phòng, hub (gồm cả giả lập 2 instance), kiểm tra origin |

## Đấu Súng (`src/bang/`)

Lối chơi Bang! cho 3–8 người: Cảnh sát trưởng / Phó / Kẻ cướp / Kẻ phản bội (3 người: mỗi vai săn 1 vai khác). Tên lá, nhân vật và lời mô tả là của riêng mình.

| File | Nội dung |
|---|---|
| `cards.ts` | 168 lá chơi (bộ gốc 80, Thị trấn Né Đạn 40, Thung Lũng Bóng Ma 24, Trang Bị Tận Răng 24), 63 nhân vật, 38 lá sự kiện, 12 loại trang bị Cơn Sốt Vàng. Chép nguyên sang portfolio |
| `game.ts` | Lõi: chọn nhân vật, lượt (đầu lượt → rút → đánh → bỏ bài), hàng chờ `queue` (mọi thứ cần người chơi trả lời: bị bắn, Tạp Hoá, Cứu Nguy…), sát thương, cái chết, thắng thua, rút!, khoảng cách |
| `actions.ts` | Đánh bài, lá xanh lá / lá có đạn, kỹ năng nhân vật & sự kiện, cửa hàng vàng, trả lời, kết thúc lượt, tự chơi khi hết giờ |
| `room.ts` | Vòng đời phòng, luật bàn (bộ mở rộng, thời gian lượt / trả lời, điểm thắng), view riêng từng người (giấu vai trò và bài trên tay) |

Bản mở rộng chủ phòng bật được: **Thị trấn Né Đạn** (lá xanh lá, lá phải bỏ kèm 1 lá, tới 8 người), **Giữa Trưa** và **Nắm Bài** (bộ sự kiện đổi luật mỗi vòng), **Gánh Xiếc Miền Tây**, **Cơn Sốt Vàng** (vàng + cửa hàng), **Thung Lũng Bóng Ma** (hồn ma, cứu nguy…), **Trang Bị Tận Răng** (đạn nạp lên lá). Vài chỗ giản lược so với bản giấy được ghi ngay trong lời mô tả lá.

Mọi trạng thái là JSON thuần (lưu trong Redis): hiệu ứng đang chờ nằm trong `queue` dưới dạng dữ liệu và được `run()` xử lý lần lượt. Người chơi hết giờ hoặc mất kết nối được `tickGame()` trả lời thay (đỡ nếu có Trượt!, không thì chịu đòn; hết giờ lượt thì bỏ bài dư và qua lượt). `test/bang.test.ts` có cả bài chơi ngẫu nhiên hàng trăm ván với mọi bản mở rộng, kiểm tra không lá nào bị mất hay nhân đôi.

## Chạy local

```bash
npm install
npm run dev          # http://localhost:4000 , ws://localhost:4000/api/ws
npm test
```

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
`create` · `join {code,name,token}` · `start` · `play {cards}` · `pass` · `leave` · `ping` (gửi mỗi 10 giây, dùng làm heartbeat)

Server → client: `ack {id, ok, error?, code?}` · `state {view}` (mỗi người chỉ nhận bài của mình) · `reconnect` · `pong`

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `REDIS_URL` / `KV_URL` | _(trống)_ | Redis để lưu phòng. Trên Vercel là bắt buộc |
| `ALLOWED_ORIGIN` | _(trống = cho phép tất cả)_ | Danh sách origin được phép kết nối, ngăn cách bằng dấu phẩy, hỗ trợ `*` |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Cổng và địa chỉ lắng nghe khi chạy local |
