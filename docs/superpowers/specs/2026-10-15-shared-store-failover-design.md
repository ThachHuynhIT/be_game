# Máy chính và máy dự phòng dùng chung Upstash — chơi tiếp ván khi máy chính sập — thiết kế

Ngày: 2026-10-15 · Trạng thái: chờ duyệt · Repo: be_game (+ client trong zonenop-game)

## 1. Bối cảnh và mục tiêu

be_game chạy hai backend cùng lúc: **máy chính** tự host trên điện thoại `vsmart-zangyapro`
(`https://play-api.fudio101.com`, Redis riêng trong Docker, AOF) và **máy dự phòng** Vercel
(`https://be-game-omega.vercel.app`, Upstash Redis Singapore). Hai máy **không chung dữ liệu**; client ghim mỗi
phòng vào máy tạo ra nó.

Sự cố 15/10/2026: điện thoại mất nguồn, tắt cứng 08:08 → 10:47 (≈ 2 giờ 39 phút). Sảnh và phòng mới tự sang máy
dự phòng, nhưng **mọi ván đang chơi trên máy chính bị kẹt** đến khi điện thoại bật lại (dữ liệu không mất — AOF —
nhưng không ai truy cập được).

**Mục tiêu (người dùng chọn):** khi máy chính sập, người đang trong phòng tự chuyển sang máy dự phòng và **chơi tiếp
đúng ván đó** (bài, tiền, lượt, ghế), không tạo phòng mới, không mất nước đi nào.

**Hướng đã chọn:** cả hai máy dùng **một** Redis — Upstash của máy dự phòng. (Đã cân nhắc và loại: sao chép từng ván
từ Redis cục bộ sang Upstash — nhanh hơn, ít lệnh hơn nhưng có thể mất vài nước cuối và cần cơ chế "ai giữ ván"
khi máy chính bật lại; client tự mang trạng thái sang — không được vì mỗi người chỉ thấy bài của mình.)

**Thành công nghĩa là:** trong thử nghiệm có hai backend dùng chung một Redis, tắt backend chính giữa ván → mọi
người chơi tự vào lại backend phụ trong ≤ 15 giây với cùng mã phòng, cùng lượt, cùng tiền/bài; bật lại backend chính
không tạo bản thứ hai của ván; bảng xếp hạng và sảnh là một.

### Ngoài phạm vi

- Tự động chuyển *ngược* về máy chính khi nó sống lại (không cần: cùng dữ liệu).
- Dự phòng cho chính Upstash (Upstash sập → cả hai máy sập; chấp nhận).
- Sửa logic game, protocol, luật.

## 2. Kiến trúc

```
Trình duyệt ──► play-api.fudio101.com (điện thoại) ──┐
      │  (máy chính không trả lời)                    ├──► Upstash Redis (Singapore) — kho duy nhất:
      └──────► be-game-omega.vercel.app (dự phòng) ───┘     phòng · sảnh · bảng xếp hạng · pub/sub
```

- **Máy chính:** `~/apps/be_game/.env` đặt `REDIS_URL=<URL Upstash rediss://…>` (cùng URL máy dự phòng). be_game đã
  chọn Redis theo `REDIS_URL || KV_URL || UPSTASH_REDIS_URL` (`src/server/store.ts:redisUrl`) và đã chạy nhiều
  instance trên cùng Upstash ở Vercel (CAS `SAVE_SCRIPT` + `PUBLISH` version) → **không đổi logic server**.
  `compose.selfhost.yml`: biến `REDIS_URL` của service be_game lấy từ `.env` với mặc định `redis://redis:6379`
  (`${REDIS_URL:-redis://redis:6379}`), để quay lại chỉ cần xoá dòng trong `.env`. Container `redis` cục bộ giữ
  nguyên (dữ liệu cũ, quay lại nhanh).
- **Chung:** phòng, sảnh, bảng xếp hạng, kênh `…:changed`. Hai người cùng phòng ở hai máy khác nhau vẫn thấy cùng
  ván (pub/sub qua Upstash). `tick` chạy trên cả hai máy → CAS bảo đảm chỉ một lần ghi thắng (như nhiều instance
  Vercel hiện nay).
- **Sức khoẻ:** `/api/health` đã trả `redisHost`; sau chuyển đổi cả hai máy phải báo cùng host. Thêm trường
  `sharedStore: true` khi `redisHost` không phải `redis`/`localhost` — chỉ để vận hành dễ đọc, client không dùng.

## 3. Client (zonenop-game `src/components/games/gameClient.ts`)

Hiện tại `useGameRoom.open()`: nếu đã biết máy của phòng (`roomBase`, từ `sessionStorage["games:roomServers"]`)
thì **chỉ** thử máy đó; không trả lời → chờ và thử lại mãi.

Mới:

1. Có `roomBase` và nó `unreachable` → thử `join` lần lượt ở **các máy còn lại** (`candidateBases()` trừ `roomBase`).
2. Máy khác trả `ok` → dùng máy đó: `roomBase = base`, `rememberRoomServer(...)`, trạng thái `joined`.
3. Máy khác trả `not-found` ("Không tìm thấy phòng" — hai máy chưa chung kho) → bỏ qua, giữ hành vi cũ (chờ máy
   cũ, `scheduleRetry`).
4. Máy đã ghim trả lời bình thường → không thử máy khác (không đổi gì so với hiện nay).

Không cần cờ cấu hình: trước khi chuyển sang kho chung, bước 3 giữ hành vi cũ; sau khi chuyển, bước 2 cho chơi tiếp.
Không đổi: chọn máy cho sảnh và phòng mới (ưu tiên máy chính), nối lại bằng token, protocol. Đổi máy giữa chừng
dùng cùng token nên server gắn lại đúng ghế.

## 4. Chuyển dữ liệu hiện có (một lần)

Script `src/tools/migrate-store.ts` (trong `src/` để có trong image Docker; không nằm dưới `api/` nên không lộ ra
Vercel). Chạy:

```bash
docker compose -f compose.selfhost.yml run --rm --no-deps be_game \
  node_modules/.bin/tsx src/tools/migrate-store.ts --from redis://redis:6379 --to "$UPSTASH_URL" [--dry-run]
```

Với mỗi game trong `GameKind` (`src/server/store.ts`: tienlen, meono, typhu, splendor, bang, cangua, oanquan; namespace `<game>:` — export thêm một mảng `GAME_KINDS` cạnh type để script lặp):

| Dữ liệu | Khoá | Cách chép |
|---|---|---|
| Bảng xếp hạng | `<game>:lb:points` (zset), `<game>:lb:p:<key>` (hash) | **Gộp**: `ZINCRBY` điểm; `HINCRBY` `points`, `games`, `wins`; `name`, `last` lấy theo `last` mới hơn |
| Phòng | `<game>:room:<code>` (hash `state`, `version`, TTL) + `<game>:rooms` (zset) | Chép nếu đích **chưa có** mã đó: `HSET` + `EXPIRE` theo TTL còn lại + `ZADD` index cùng score |
| Chống ghi điểm hai lần | `<game>:lb:done:<id>` | Không chép (tự hết hạn) |

- `--dry-run`: chỉ in số khoá/phòng/người chơi sẽ chép, không ghi.
- Chạy được hai chiều (`--from`/`--to` bất kỳ) → dùng lại khi quay lại.
- In tóm tắt: số người gộp, số phòng chép/bỏ qua (đã có ở đích).
- Không in URL/mật khẩu (chỉ host).

**Các bước chuyển (≈ 1–2 phút gián đoạn máy chính; máy dự phòng vẫn chạy):**

1. `docker compose -f compose.selfhost.yml stop be_game`
2. chạy script `--dry-run`, xem số liệu; chạy thật.
3. thêm `REDIS_URL=<Upstash>` vào `~/apps/be_game/.env` (quyền 600).
4. `docker compose -f compose.selfhost.yml up -d be_game`
5. `curl https://play-api.fudio101.com/api/health` và `https://be-game-omega.vercel.app/api/health` → cùng `redisHost`,
   `sharedStore: true`; bảng xếp hạng có cả điểm cũ của máy chính.

URL Upstash là bí mật: lấy từ biến `REDIS_URL`/`KV_URL` của project Vercel `be-game` (người dùng dán, hoặc
`vercel env pull` vào file tạm rồi xoá); chỉ nằm trong `.env` trên điện thoại; không commit, không in ra.

## 5. Hạn mức Upstash

- Ghi phòng đến chủ yếu từ **heartbeat**: ping mỗi 10 s, server ghi khi `lastSeen` cũ hơn `HEARTBEAT_WRITE_MS` (8 s) →
  mỗi người ≈ 1 lần `SAVE_SCRIPT`/10 s. Bàn 4 người ≈ 1 400 lần/giờ + nước đi + sảnh (đã cache 4 s/instance) ≈
  2 000 lệnh/giờ nếu một `EVAL` tính là 1 lệnh, ≈ 5 lần hơn nếu Upstash tính từng lệnh trong script.
- **Đo thật** trước khi chuyển: chạy bàn bot 10 phút trên backend local trỏ vào Upstash, đọc số lệnh trên dashboard
  Upstash trước/sau → quy ra lệnh/giờ-bàn, so với hạn mức gói hiện tại.
- Nếu vượt: (a) gói trả theo mức dùng có trần ngân sách, hoặc (b) tăng `HEARTBEAT_WRITE_MS` lên 20 s (giữ
  `PRESENCE_TIMEOUT_MS` 25 s → phải tăng tương ứng lên ≥ 45 s; sửa có test) — người dùng quyết dựa trên số đo.

## 6. Quay lại

Xoá dòng `REDIS_URL` trong `.env` → `docker compose up -d be_game` → máy chính về Redis cục bộ. Muốn giữ dữ liệu phát
sinh trên Upstash: chạy script `--from <Upstash> --to redis://redis:6379` trước khi đổi. Client không cần đổi (bước 3
mục 3 tự trở lại hành vi cũ).

## 7. Kiểm tra

1. **Unit (be_game, vitest):** `migrate-store` chạy trên hai instance `ioredis-mock` (devDependency mới, 8.x) làm nguồn và đích: gộp bảng xếp hạng cộng đúng (cùng người ở hai nguồn → tổng), phòng đã có ở đích không bị
   ghi đè, TTL được giữ (± vài giây), `--dry-run` không ghi gì, `lb:done:*` không chép.
2. **Unit (zonenop-game, vitest):** tách quyết định thử máy khác thành hàm thuần
   (`nextBasesAfterUnreachable(roomBase, candidates)` hoặc tương đương) và test: máy ghim không trả lời → thử máy còn
   lại; máy còn lại `not-found` → giữ máy ghim; máy ghim trả lời → không thử máy khác.
3. **Thử thật trên máy (bắt buộc trước khi chuyển điện thoại):** một Redis local dùng chung, hai be_game local
   (cổng 4123 chính, 4124 phụ), frontend dev trỏ `NEXT_PUBLIC_TIENLEN_SERVER_URL=:4123`,
   `NEXT_PUBLIC_TIENLEN_FALLBACK_URL=:4124`; bot + người chơi (Playwright) trong một ván Cờ Tỷ Phú và một ván Tiến Lên;
   dừng tiến trình 4123 giữa ván → trong ≤ 15 s người chơi ở 4124, cùng mã phòng, cùng lượt và tiền/bài, chơi tiếp được;
   bật lại 4123 → không có ván thứ hai, người mới vào sảnh thấy đúng một phòng.
4. **Sau khi chuyển điện thoại:** hai `/api/health` cùng `redisHost`; một ván bot ngắn trên `play-api` rồi đọc phòng từ
   `be-game-omega` (`/api/<game>/rooms`) thấy cùng phòng.
5. `npm run typecheck && npm test` (cả hai repo) và CI xanh.

## 8. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Hết hạn mức Upstash → cả hai máy hỏng | Đo trước (mục 5); trần ngân sách; giảm tần suất heartbeat nếu cần |
| Độ trễ điện thoại → Singapore (~40–80 ms/lệnh) | Game theo lượt; đo khi thử (mục 7.3) |
| Lỡ in/commit URL Upstash | Script chỉ in host; `.env` quyền 600; không đặt trong repo/GitHub secrets |
| Gộp bảng xếp hạng sai | Unit test + `--dry-run` + đối chiếu top 10 trước/sau |
| Upstash sập | Ngoài phạm vi; quay lại Redis cục bộ theo mục 6 |
