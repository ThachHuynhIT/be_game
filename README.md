# be_game

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
| `src/game/` | Luật chơi thuần TS: `cards`, `combos` (nhận diện bộ, chặn, chặt), `rules` (tới trắng), `game` (máy trạng thái ván), `room` (vòng đời phòng, không dùng timer), `protocol` (định dạng message) |
| `src/server/hub.ts` | Xử lý từng kết nối: load → apply → compare-and-swap, phát thay đổi qua pub/sub, timer lượt, gửi `reconnect` trước khi hết thời gian của function |
| `src/server/store.ts` | Store Redis (`REDIS_URL` / `KV_URL`) hoặc store trong RAM nếu không có Redis |
| `src/server/app.ts` | `http.Server` dùng chung cho cả Vercel lẫn chạy local |
| `api/ws.ts`, `api/health.ts` | Các Vercel Function |
| `src/local.ts` | Server chạy local / tự host |
| `test/` | vitest: luật chơi, phòng, hub (gồm cả giả lập 2 instance), kiểm tra origin |

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
