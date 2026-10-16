# be_game

> Tài liệu cho developer (kiến trúc, giao thức, luật từng game, cách thêm game mới): [`docs/GUIDE.md`](docs/GUIDE.md).

> Bảy game: **Tiến Lên Miền Nam** (`/api/ws`, `/api/rooms`, `/api/leaderboard`), **Mèo Nổ** (`/api/meono/*`), **Cờ Tỷ Phú** (`/api/typhu/*`), **Đá Quý** — lối chơi Splendor (`/api/splendor/*`), **Cờ Cá Ngựa** (`/api/cangua/*`), **Ô Ăn Quan** (`/api/oanquan/*`) và **Đấu Súng** — lối chơi Bang! kèm 7 bản mở rộng (`/api/bang/*`), cùng chung hạ tầng hub / Redis / chat. Luật từng game nằm sau một `GameAdapter` (`src/server/adapters.ts`), code ở `src/game/`, `src/meono/`, `src/typhu/`, `src/splendor/`, `src/bang/`, `src/cangua/`, `src/oanquan/`. Trên Vercel, các endpoint `/api/<game>/<kind>` dùng chung một function động `api/[game]/[kind].ts` để nằm trong giới hạn 12 function của gói Hobby.

Backend cho các game online của site game, gồm luật chơi, phòng chơi và WebSocket realtime. Phần giao diện nằm trong repo [zonenop-game](https://github.com/ThachHuynhIT/zonenop-game) (chạy ở `https://play.fudio101.com`, bản Vercel `zonenop-game.vercel.app`; route `/tien-len` …) và kết nối tới backend này qua `NEXT_PUBLIC_TIENLEN_SERVER_URL` (máy dự phòng: `NEXT_PUBLIC_TIENLEN_FALLBACK_URL`). Repo `portfolio` không còn chứa game.

```
Trình duyệt (zonenop-game /tien-len …)
   │  wss://…/api/ws  (thử máy chính trước, không trả lời thì sang máy dự phòng)
   ├──────────────────────────────────────┐
   ▼                                      ▼
play-api.fudio101.com  (máy chính)           be-game-omega.vercel.app  (dự phòng)
Cloudflare Tunnel → Traefik →            Vercel Functions api/*.ts
src/local.ts trong Docker                (region sin1, Fluid compute)
   │  CAS (Lua) + pub/sub                   │  CAS (Lua) + pub/sub
   ▼                                        ▼
Redis trong compose (./data/redis)       Upstash Redis
```

Hai backend chạy cùng code từ `main`. Redis: **riêng** mỗi máy như sơ đồ, và đó là trạng thái **hiện tại** (máy chính: `redisHost: "redis"`, `sharedStore: false`; máy dự phòng: Upstash). Việc chuyển máy chính sang Upstash chung (công cụ `src/tools/migrate-store.ts` và cấu hình `REDIS_URL` đã có trong repo) **chưa được thực hiện**, còn chờ buổi diễn tập. Khi đã chuyển, hai máy **dùng chung** một kho (phòng, sảnh, bảng điểm là một): xem mục "Frontend chọn backend thế nào" trong `docs/DEPLOYMENT.md` và "Chuyển sang / quay lại kho chung" trong `docs/SELF_HOSTING.md`. Môi trường, luồng phát hành và lưu ý vận hành: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Game và endpoint

| Game | Code | Số người | WebSocket | Sảnh phòng | Bảng xếp hạng |
|---|---|---|---|---|---|
| Tiến Lên Miền Nam | `src/game/` | 2–4 | `/api/ws` | `/api/rooms` | `/api/leaderboard` |
| Mèo Nổ | `src/meono/` | 2–7 (tuỳ chế độ) | `/api/meono/ws` | `/api/meono/rooms` | `/api/meono/leaderboard` |
| Cờ Tỷ Phú | `src/typhu/` | 2–6 | `/api/typhu/ws` | `/api/typhu/rooms` | `/api/typhu/leaderboard` |
| Đá Quý (Splendor) | `src/splendor/` | 2–4 | `/api/splendor/ws` | `/api/splendor/rooms` | `/api/splendor/leaderboard` |
| Đấu Súng (Bang!) | `src/bang/` | 3–8 | `/api/bang/ws` | `/api/bang/rooms` | `/api/bang/leaderboard` |
| Cờ Cá Ngựa | `src/cangua/` | 2–4 | `/api/cangua/ws` | `/api/cangua/rooms` | `/api/cangua/leaderboard` |
| Ô Ăn Quan | `src/oanquan/` | 2–4 | `/api/oanquan/ws` | `/api/oanquan/rooms` | `/api/oanquan/leaderboard` |

`/rooms` trả các phòng còn người (tối đa 30), `/leaderboard?limit=20` (1–100) trả điểm mọi thời đại. `GET /api/health` kiểm tra store (Redis/RAM, vòng pub/sub) và báo `commit` đang chạy, `redisHost`, `sharedStore`, `now` (chi tiết: `docs/GUIDE.md` → HTTP endpoints). Bảng route nằm ở `src/server/app.ts`.

Trên Vercel có 5 function: `api/ws.ts`, `api/rooms.ts`, `api/leaderboard.ts`, `api/health.ts` (Tiến Lên + health) và `api/[game]/[kind].ts` cho mọi endpoint của 6 game còn lại. Mọi file đều export cùng một server; `app.ts` định tuyến theo path. Game mới chỉ cần thêm route trong `app.ts`, không thêm file vào `api/`.

**Mèo Nổ** (`src/meono/cards.ts`): 6 gói mở rộng (`imploding`, `streaking`, `barking`, `attacking`, `defending`, `zombie`). Chủ phòng chọn một trong 16 chế độ `PRESETS` (mỗi chế độ có số người tối thiểu/tối đa riêng) hoặc `custom` để tự tick gói; khi đó tối đa 5 người với bộ gốc, 6 nếu có gói bất kỳ, 7 nếu có Attacking Kittens. Không ai được "Không!" (Nope) chặn lá của chính mình: lá Không! đầu tiên không thể do người đánh lá gốc chơi, và không ai chặn lại lá Không! của chính mình (người đánh lá gốc vẫn được Không! đáp lại người vừa chặn).

**Ô Ăn Quan** (`src/oanquan/`, 2–4 người): vòng 6 × N ô (N = số người) — mỗi người một đoạn gồm ô quan `6i` rồi 5 ô dân `6i+1…6i+5` (2 người = bàn 12 ô quen thuộc: ô quan 0 và 6, người thứ nhất giữ ô 1–5, người thứ hai giữ ô 7–11); hướng `+1` là "phải" theo góc nhìn người đi, lượt đi vòng theo thứ tự chỗ ngồi. Lệnh `{ type: "move", cell, dir: 1 | -1 }`: bốc một ô dân bên mình, rải từng viên, gặp ô dân có quân thì rải tiếp, gặp ô quan có quân thì dừng, gặp ô trống rồi ô có quân thì ăn (ăn liên tiếp), hai ô trống liền thì dừng. Luật bàn: giá quan 5/10 dân, **quan non** (ô quan còn quan mà dưới 5 dân thì không ăn được; bật sẵn), thời gian lượt 15/20/30/45 giây, điểm Nhất/Nhì. Đầu lượt mà hàng mình trống thì tự rải quân (5 dân từ phần đã ăn, thiếu thì vay lần lượt những người kế tiếp còn dân — khoản vay trả lại khi tính điểm; những người còn chơi cũng không đủ dân thì bị loại: bỏ lượt, ô còn lại vẫn nằm trên bàn; còn một người thì người đó thắng). Hết mọi quan và ô quan trống thì mỗi người còn chơi thu dân trên hàng mình; điểm = dân + quan × giá − vay + cho vay; xếp hạng theo điểm (bằng điểm thì chung hạng) rồi tính điểm xếp hạng Nhất/Nhì (hai người hoà = 0 điểm). `lastMove` trong view gồm bàn trước nước đi và từng bước (`pick` / `sow` / `capture`) để client diễn hoạt. Hết giờ hoặc mất kết nối thì máy đi một nước hợp lệ ngẫu nhiên.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/bang/` | Đấu Súng (xem mục riêng bên dưới) |
| `src/cangua/` | Cờ Cá Ngựa: `board` (bàn 15×15, đường 56 ô, chuồng 6 bậc — chép sang zonenop-game), `game`, `room`, `protocol`. Luật tuỳ chọn: xuất quân bằng 1 hoặc 6, không nhảy qua đầu ngựa, lên chuồng theo số, ba lần 6 mất lượt, xếp hạng hết |
| `src/oanquan/` | Ô Ăn Quan: `board` (bố cục 12 ô, tuỳ chọn), `game`, `room`, `protocol` (xem mục riêng bên dưới) |
| `src/meono/`, `src/typhu/`, `src/splendor/` | Mèo Nổ, Cờ Tỷ Phú, Đá Quý: `cards`/`board`, `game`, `room`, `protocol` |
| `src/game/` | Luật chơi thuần TS: `cards`, `combos` (nhận diện bộ, chặn, chặt), `rules` (tới trắng), `game` (máy trạng thái ván), `room` (vòng đời phòng, không dùng timer), `protocol` (định dạng message) |
| `src/server/hub.ts` | Xử lý từng kết nối: load → apply → compare-and-swap, phát thay đổi qua pub/sub, timer lượt, gửi `reconnect` trước khi hết thời gian của function |
| `src/server/store.ts` | Store Redis (`REDIS_URL` / `KV_URL`) hoặc store trong RAM nếu không có Redis; `GAME_KINDS`, `keysFor` (bố cục key Redis), bộ đếm lệnh `BE_GAME_COUNT_COMMANDS` |
| `src/tools/migrate-store.ts` | Công cụ vận hành: chép phòng và bảng xếp hạng giữa hai Redis (để chuyển máy chính sang kho chung); xem `docs/SELF_HOSTING.md` |
| `src/server/adapters.ts` | `GameAdapter` cho từng game (join, lệnh, view, tick…) |
| `src/server/app.ts` | `http.Server` dùng chung cho cả Vercel lẫn chạy local, kèm bảng route |
| `api/*.ts`, `api/[game]/[kind].ts` | Các Vercel Function (xem trên) |
| `src/local.ts` | Server chạy local / tự host |
| `test/` | vitest: luật chơi từng game, phòng, hub (gồm cả giả lập 2 instance), vào lại ghế (`rejoin`), kiểm tra origin, store (`shared-store`, `store-cache`, `migrate-store`), và `fuzz-<game>.test.ts` (chơi ngẫu nhiên có seed để bắt kẹt ván / mất bài / lộ thông tin) |

## Đấu Súng (`src/bang/`)

Lối chơi Bang! cho 3–8 người: Cảnh sát trưởng / Phó / Kẻ cướp / Kẻ phản bội (3 người: mỗi vai săn 1 vai khác). Tên lá, nhân vật và lời mô tả là của riêng mình.

| File | Nội dung |
|---|---|
| `cards.ts` | 167 lá chơi (bộ gốc 80, Thị trấn Né Đạn 40, Thung Lũng Bóng Ma 24, Trang Bị Tận Răng 23), 63 nhân vật, 38 lá sự kiện, 12 loại trang bị Cơn Sốt Vàng. Chép nguyên sang zonenop-game |
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

Ở repo zonenop-game, đặt `NEXT_PUBLIC_TIENLEN_SERVER_URL=http://localhost:4000` (đây cũng là giá trị mặc định khi không đặt), rồi chạy `npm run dev`.

## Môi trường đang chạy

| | Máy chính | Máy dự phòng |
|---|---|---|
| URL | `https://play-api.fudio101.com` | `https://be-game-omega.vercel.app` |
| Chạy ở | Server tự host `vsmart-zangyapro` (`compose.selfhost.yml`) | Vercel project `be-game` |
| Deploy | Workflow **Deploy** sau khi CI pass trên `main` | Vercel Git, mỗi push vào `main` (nhánh khác → preview) |
| Tài liệu | [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) | mục "Deploy lên Vercel" bên dưới |

Luồng từ PR tới hai máy, biến môi trường từng nơi, giữ tương thích, kiểm tra sau deploy, quay lại khi lỗi: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Deploy lên Vercel

Đây là cách dựng máy dự phòng (đã dựng xong; project `be-game` tự deploy từ `main`).

1. Trên Vercel: **Add New → Project**, import repo `be_game`. Framework Preset để **Other**; không cần Build Command.
2. Vào **Settings → Functions**, bật **Fluid compute** (project mới được bật sẵn). WebSocket cần Fluid compute.
3. Vào **Storage / Marketplace**, thêm **Upstash for Redis** (gói Free), chọn region **Singapore**, rồi gắn vào project `be_game`. Vercel tự thêm `REDIS_URL` / `KV_URL`.
4. (Tuỳ chọn) Đặt biến môi trường `ALLOWED_ORIGIN=https://<domain-frontend>,https://<project>-*-<team-slug>.vercel.app` (frontend zonenop-game: `https://play.fudio101.com`, `https://zonenop-game.vercel.app`) để chỉ trang của bạn (kể cả bản preview) kết nối được. Đừng dùng `https://*.vercel.app`: ai có tài khoản Vercel cũng tạo được subdomain đó.
5. Deploy xong, mở `https://<be_game>.vercel.app/api/health`. Kết quả mong đợi: `"ok": true`, `"store": "redis"`, `"region": "sin1"`, và `"commit"` là SHA vừa deploy (cần bật **Automatically expose System Environment Variables** của project; không thì `commit` là `null` và job `vercel` của workflow Deploy báo đỏ).
6. Ở project **zonenop-game** (Vercel hoặc `.env` của bản tự host), đặt URL này vào `NEXT_PUBLIC_TIENLEN_FALLBACK_URL` (máy dự phòng) — hoặc vào `NEXT_PUBLIC_TIENLEN_SERVER_URL` nếu dùng Vercel làm máy chính — rồi build lại (biến `NEXT_PUBLIC_*` gắn lúc build).

Preview của mọi nhánh dùng chung store Upstash với production: PR đổi cấu trúc state có thể ảnh hưởng phòng trên máy dự phòng ngay khi push (xem [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#bài-học-đã-gặp)).

Region đã được đặt là `sin1` trong `vercel.json`.

### Giới hạn của Vercel
- Mỗi kết nối WebSocket chỉ sống bằng thời gian tối đa của function, trên gói Hobby là **300 giây**. Khoảng 25 giây trước khi hết hạn, server gửi `{type:"reconnect"}`; client mở kết nối mới rồi mới đóng kết nối cũ, nên người chơi không bị văng.
- Phải có Redis. Người chơi trong cùng một phòng có thể nằm trên những instance khác nhau, và store trong RAM chỉ dùng được khi chạy một tiến trình duy nhất (chạy local / tự host).
- WebSocket trên Vercel vẫn đang **Beta**.

## Tự host trên VPS có IP public (mẫu `docker-compose.yml` + Caddy)

Mẫu này **không** phải cách máy chính đang chạy (máy chính dùng `compose.selfhost.yml` sau Traefik + Cloudflare Tunnel, xem mục kế tiếp). Dùng nó khi có một VPS mở được cổng 80/443: `docker-compose.yml` dựng ba service — `be_game` (`src/local.ts`), `redis` (bật AOF, volume `redis-data`) và `caddy` (HTTPS tự động, proxy cả WebSocket). Chỉ Caddy mở cổng 80/443; Redis và be_game nằm trong mạng nội bộ Docker.

1. Trỏ DNS (A/AAAA) của một tên miền, ví dụ `game.example.com`, về IP server; mở firewall cổng 80, 443 (TCP) và 443 (UDP).
2. Trên server: `git clone` repo, `cp .env.example .env`, rồi điền `GAME_DOMAIN=game.example.com` và `ALLOWED_ORIGIN=https://<domain-frontend>` (không để `*.vercel.app` nếu không cần).
3. `docker compose up -d --build`.
4. Kiểm tra `https://game.example.com/api/health` — mong đợi `"ok": true`, `"store": "redis"` (`region` hiển thị `local`).
5. Ở zonenop-game đặt `NEXT_PUBLIC_TIENLEN_SERVER_URL=https://game.example.com` rồi build lại (biến này gắn lúc build). Giữ bản Vercel chạy song song tới khi kiểm tra xong rồi mới tắt.

Ghi chú vận hành:
- Cập nhật: `git pull && docker compose up -d --build`. `SIGTERM` làm server đóng gọn: ngừng nhận kết nối mới và đóng mọi WebSocket bằng mã 1001, client tự kết nối lại (tối đa 10 giây chờ).
- Phòng và bảng xếp hạng nằm trong volume `redis-data`; hãy sao lưu volume này. Không có Redis thì store RAM mất hết khi restart.
- Không còn giới hạn 300 giây của Vercel nên server không gửi `reconnect` định kỳ.
- Dùng nginx thay Caddy thì cần `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` và `proxy_read_timeout` dài (ví dụ 3600s), nếu không WebSocket bị cắt sau 60 giây.
- Chạy nhiều bản `be_game` vẫn đúng vì trạng thái phòng dùng chung qua Redis.

## Máy chính và tự động deploy (CD qua SSH)

Bản đang chạy thật ở `https://play-api.fudio101.com` (máy chủ `vsmart-zangyapro`, sau Cloudflare Tunnel + Traefik), dùng `compose.selfhost.yml`: be_game + Redis, không publish cổng nào. `.github/workflows/deploy.yml` tự deploy mỗi khi CI pass trên một lần push vào `main` (gồm cả merge PR): runner vào tailnet bằng Tailscale OIDC, gửi đúng commit đã test qua SSH, `docker compose up -d --build`, rồi kiểm tra `/api/health` trong container và qua domain public: cả hai phải trả đúng `commit` vừa deploy (container cũ còn trả lời thì không qua). Job `vercel` chạy song song, đợi tới 10 phút cho tới khi bản Vercel cũng trả đúng `commit` (bật bằng repo variable `VERCEL_HEALTH_URL`).

Sơ đồ, nơi đặt từng cấu hình (`.env` trên server, secret GitHub, biến Vercel), cách chuẩn bị một lần, lệnh vận hành, quy tắc trên máy dùng chung và bảng xử lý sự cố: [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

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
| `BE_GAME_COUNT_COMMANDS` | _(trống)_ | `1` = log số lệnh Redis mỗi 60 giây (đo trước khi chuyển sang Upstash; xem `docs/SELF_HOSTING.md`) |
| `BUILD_COMMIT` | _(deploy tự đặt)_ | Commit đang chạy trên máy tự host: workflow Deploy export, compose chuyển vào container; `/api/health` trả lại ở `commit` |
| `VERCEL`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA` | _(Vercel tự đặt)_ | Chỉ đọc: cảnh báo khi thiếu Redis trên Vercel, trường `region` và `commit` của `/api/health` |
