# Tài khoản, bảng điểm theo tài khoản và trang admin

Ngày: 2026-10-16. Repo: be_game (backend) và zonenop-game (frontend). Trạng thái: bản thiết kế đã được duyệt trong chat.

## 1. Mục tiêu

- Người chơi có **tài khoản** (username, mật khẩu, role `user` hoặc `admin`). **Bắt buộc đăng nhập** mới chơi hoặc xem bàn.
- **Bảng điểm theo tài khoản**, bắt đầu một mùa mới từ 0. Bảng cũ (theo tên, trong Redis) vẫn xem được ở tab "Mùa trước".
- **Trang `/admin`** (chỉ admin) với thống kê lượt truy cập, số máy khác nhau, người dùng, lượt chơi, số người chơi và số máy chơi theo ngày, kèm quản lý user.
- Hai backend (điện thoại và Vercel) dùng chung tài khoản: máy chính sập thì người chơi vẫn đăng nhập được ở máy dự phòng.

Không làm trong đợt này: quên mật khẩu qua email, đăng nhập bằng Google hay OAuth, người dùng tự xoá tài khoản, chuyển phòng chơi sang Postgres.

## 2. Kiến trúc

```
zonenop-game (play.fudio101.com, Vercel)
   │  HTTP + WebSocket, header/field `session` (token trong localStorage)
   ▼
be_game (điện thoại / Vercel) ──► Redis: phòng, pub/sub, bảng điểm mùa cũ, giới hạn số lần thử
   └──────────────────────────► Neon Postgres (dùng chung): users, game_results, page_views
```

- Postgres qua `pg` (node-postgres), có pool. Trên Vercel dùng chuỗi kết nối pooled của Neon. Env `DATABASE_URL` là bí mật, chỉ đặt trong `.env` trên điện thoại (quyền 600) và env của Vercel. Không commit, không in ra.
- Thiếu `DATABASE_URL` (chạy local hoặc trong test): dùng bộ lưu trong bộ nhớ có cùng interface (`createMemoryAccountStore`), giống cách `createMemoryRoomStore` đang làm.
- Migration là các file SQL đánh số trong `src/db/migrations/`, chạy lúc khởi động (`CREATE TABLE IF NOT EXISTS` cộng bảng `schema_migrations`), idempotent.

## 3. Dữ liệu

```sql
users(id uuid pk, username text unique not null,          -- lưu dạng đã chuẩn hoá: lower, NFC, trim
      display_name text not null,                          -- đúng như người dùng gõ khi đăng ký
      password_hash text not null,                         -- scrypt: "scrypt$N$r$p$salt$hash" (base64)
      role text not null default 'user' check (role in ('user','admin')),
      icon text not null default '', color text not null default '#fbbf24',
      disabled boolean not null default false, session_version int not null default 0,
      created_at timestamptz default now(), last_login_at timestamptz)

game_results(game text, record_id text, user_id uuid references users,
             points int not null, rank int not null, won boolean not null,
             at timestamptz not null, primary key (game, record_id, user_id))

page_views(id bigserial pk, at timestamptz default now(), day date default current_date,
           path text not null, device_id text not null, user_id uuid null)
-- index: page_views(day), page_views(device_id), game_results(at), game_results(game, user_id)
```

- Username: 3–20 ký tự, chỉ gồm chữ (có dấu), số, `_`, `.` và khoảng trắng đơn. Khi so trùng thì chuẩn hoá giống `nameKey` hiện có. Mật khẩu: 8–72 ký tự.
- Bảng điểm mùa này = `SUM(points)`, `COUNT(*)` (số ván), `COUNT(*) FILTER (WHERE won)` của `game_results`, nhóm theo game và user.

## 4. Đăng nhập (be_game)

| Route | Vào | Ra |
|---|---|---|
| `POST /api/auth/register` | `{username, password}` | `{session, user}` hoặc lỗi (trùng tên, sai định dạng, quá số lần thử) |
| `POST /api/auth/login` | `{username, password}` | `{session, user}`. Sai thông tin thì chỉ báo chung "Sai tên đăng nhập hoặc mật khẩu" |
| `POST /api/auth/logout` | header `Authorization: Bearer <session>` | `{ok}` (phiên bị thu hồi) |
| `GET /api/auth/me` | Bearer | `{user}` hoặc 401 |
| `PATCH /api/auth/me` | Bearer, `{icon?, color?, password?, oldPassword?}` | `{user}` |

- `user` = `{id, username: display_name, role, icon, color}`.
- **Token phiên**: `base64url(payload).base64url(HMAC-SHA256(payload, SESSION_SECRET))`, với payload = `{uid, ver, exp}`, thời hạn 30 ngày.
  - `ver` = `users.session_version`. Đăng xuất, đổi mật khẩu hoặc bị khoá đều tăng giá trị này, nên các token cũ hết hiệu lực.
  - Hai máy dùng chung `SESSION_SECRET`.
  - Kiểm tra token: đúng chữ ký, chưa hết hạn, có trong `users`, `ver` khớp, không bị khoá. Kết quả tra `users` được cache trong bộ nhớ 60 giây.
- **Băm mật khẩu**: `crypto.scrypt`, N = 2^15, r = 8, p = 1, salt ngẫu nhiên 16 byte, so sánh bằng `timingSafeEqual`.
- **Giới hạn số lần thử** (Redis `INCR` + `EXPIRE`, dùng chung bởi cả hai máy):
  - register: 5 lần mỗi giờ mỗi IP;
  - login: 10 lần mỗi 15 phút mỗi IP và 5 lần mỗi 15 phút mỗi username.

  Vượt mức thì trả 429 kèm thông báo tiếng Việt.
- **Admin đầu tiên**: env `ADMIN_USERNAMES` (danh sách cách nhau dấu phẩy). Khi đăng ký hoặc đăng nhập, username có trong danh sách thì được nâng lên `admin`. Không bao giờ tự hạ quyền.
- CORS: dùng `ALLOWED_ORIGIN` như hiện nay, thêm header `Authorization` vào danh sách cho phép.

## 5. Game (be_game)

- Lệnh `join` và `watch` qua WebSocket cần thêm trường `session` (cùng với `device`, xem §6). Thiếu hoặc không hợp lệ thì ack `{ok:false, error:"Cần đăng nhập"}`.
  - Tên trong bàn = `display_name` của tài khoản. Trường `name` client gửi lên bị bỏ qua.
  - Look (icon, màu) lấy từ tài khoản.
  - Token ghế (per-browser, dùng để vào lại bàn) giữ nguyên như cũ.
- Hai người khác tài khoản không bao giờ trùng tên, vì username là duy nhất. Nhờ vậy `GameRecord.results[].name` ánh xạ được về `users`.
- Khi `hub.mutate` thấy có `GameRecord` mới, nó vẫn gọi `recordGame` (Redis, mùa cũ) và gọi thêm `accounts.recordResults(game, rec)`.
  - Mỗi người trong `results` thành một dòng `game_results`, với `points = delta`, `won = rank === 1` và user tìm theo username.
  - Dùng `ON CONFLICT DO NOTHING`, nên hai máy cùng ghi một ván cũng không bị trùng.
  - Lỗi thì chỉ log, không làm hỏng ván.
- `GET /api/<game>/leaderboard` trả bảng mùa này từ Postgres (top 50: `name, points, games, wins, icon, color`). Thêm `?season=old` để lấy bảng Redis như trước.

## 6. Theo dõi lượt truy cập

- `POST /api/track` với `{path, device}` và Bearer nếu có.
  - `device` là một id ngẫu nhiên do client tạo một lần, lưu ở `localStorage["games:device"]`, dài 16–64 ký tự `[A-Za-z0-9_-]`.
  - Server chỉ chấp nhận `path` dài ≤ 200 ký tự và bắt đầu bằng `/`.
  - Giới hạn 60 request mỗi phút mỗi IP. Bỏ qua bot thường gặp, nhận ra qua User-Agent.
- Frontend gửi beacon (`navigator.sendBeacon`, có fallback `fetch keepalive`) mỗi lần đổi trang, kể cả trang đăng nhập.

## 7. Admin (be_game)

- `GET /api/admin/stats?days=7|30|90` (role admin) trả về:
  - `totals`: tổng số user, user mới trong kỳ, lượt xem, số máy khác nhau, số ván, số người chơi khác nhau, số máy chơi khác nhau;
  - `daily[]`: `{day, views, devices, games, players, newUsers}`;
  - `byGame[]`: `{game, games, players}`;
  - `topPages[]`: `{path, views}`, top 10;
  - `topPlayers[]`: `{name, games, points}`, top 10.

  "Máy chơi" được đếm theo `device` mà client gửi kèm lệnh join. Hub ghi vào `page_views` một dòng có `path = "/play/<game>"` khi join thành công, nên không cần thêm bảng mới.
- `GET /api/admin/users?q=&page=` liệt kê user, 50 user mỗi trang: tên, role, ngày tạo, lần đăng nhập cuối, số ván, có bị khoá không.
- `PATCH /api/admin/users/:id` với `{role?, disabled?, password?}`: đặt lại mật khẩu thay cho chức năng quên mật khẩu.
  - Không tự hạ quyền chính mình.
  - Khoá tài khoản thì tăng `session_version`.
- Mọi route admin trả 403 nếu người gọi không phải admin.

## 8. Frontend (zonenop-game)

- **Phiên**: `src/components/auth/`.
  - `useSession()` lưu token trong `localStorage["games:session"]`, gọi `/api/auth/me` khi mở trang.
  - Lỗi 401 thì đăng xuất ở client.
  - Mọi request backend (gồm cả `fetchApi` và lệnh join WebSocket) gửi kèm token.
  - Khi chuyển sang máy dự phòng, cùng token vẫn dùng được.
- **Cổng đăng nhập** thay cho ô nhập tên hiện tại:
  - Trang `/dang-nhap` có hai tab Đăng nhập / Đăng ký, theo phong cách `game-ui`.
  - Trang game chưa đăng nhập thì chuyển hướng tới `/dang-nhap?next=…`.
  - Biểu tượng và màu chọn ngay khi đăng ký, dùng lại `ProfilePicker`.
- **Menu tài khoản** ở thanh trên (avatar): đổi biểu tượng và màu (`PATCH /api/auth/me`, thay cho `saveProfile` cục bộ, nên `LookDialog` của Cờ Tỷ Phú cũng gọi API này), đổi mật khẩu, đăng xuất, và mục "Quản trị" nếu là admin.
- **Bảng điểm**: hai tab "Mùa này" / "Mùa trước".
- **`/admin`**:
  - Thẻ chỉ số ở trên cùng.
  - Biểu đồ đường lượt xem và số máy theo ngày.
  - Biểu đồ cột số ván theo ngày, chia theo game.
  - Bảng trang được xem nhiều nhất và người chơi tích cực nhất.
  - Tab "Người dùng" có tìm kiếm, khoá / mở khoá, đổi role và đặt lại mật khẩu.

  Dùng Recharts, nạp lười nên không làm nặng bundle các trang game. Trang có `noindex`. Không phải admin thì hiện 403.

## 9. Lỗi và bảo mật

- Không bao giờ log mật khẩu, token, `DATABASE_URL` hay `SESSION_SECRET`.
- Neon không kết nối được:
  - Đăng nhập, đăng ký và `join` trả "Máy chủ tài khoản đang lỗi, thử lại sau".
  - Phiên đang có vẫn dùng được trong 60 giây nhờ cache.
  - Ghi `game_results` và `page_views` lỗi thì bỏ qua và log.
- Token nằm trong localStorage nên dễ bị XSS đánh cắp. Bù lại: site không render HTML do người dùng nhập, chat chỉ là text, token có hạn 30 ngày và thu hồi được.

## 10. Kiểm thử

- be_game (vitest):
  - Băm và kiểm tra mật khẩu.
  - Ký, kiểm tra và thu hồi token.
  - Chuẩn hoá và kiểm tra username.
  - Giới hạn số lần thử (ioredis-mock).
  - Các route auth và admin chạy qua `createGameServer` với store bộ nhớ.
  - Truy vấn thống kê và bảng điểm chạy trên `pg-mem`.
  - `join` thiếu hoặc sai phiên bị từ chối; ván kết thúc ghi đúng một lần `game_results` dù hai hub cùng ghi.
- zonenop-game: unit test cho `useSession` (lưu, xoá, 401) và cho phần chuẩn hoá dữ liệu biểu đồ admin. Cùng Playwright e2e trên khung điện thoại với be_game local (store bộ nhớ):
  1. Đăng ký.
  2. Vào Tiến Lên với bot và chơi một ván.
  3. Kiểm tra bảng điểm mùa này.
  4. Đăng nhập admin.
  5. Kiểm tra `/admin` có số liệu.

## 11. Triển khai

1. Người dùng: đổi mật khẩu Neon. Đặt `DATABASE_URL` mới (chuỗi pooled) vào `~/apps/be_game/.env` và Vercel be-game. Đặt thêm `SESSION_SECRET` (32 byte ngẫu nhiên, tạo bằng `openssl rand -base64 32` trên điện thoại) và `ADMIN_USERNAMES`.
2. Merge be_game: migration tự chạy, đăng nhập và route mới hoạt động.
3. Release zonenop-game: từ lúc này bắt buộc đăng nhập. Người đang ở trong bàn sẽ được yêu cầu đăng nhập ở lần kết nối kế tiếp.
4. Kiểm tra: đăng ký, chơi một ván, bảng điểm, `/admin`, và hai `/api/health` (thêm trường `accounts: "postgres" | "memory"`).

## 12. Rủi ro

- Neon free tier ngủ khi không có truy cập (cold start khoảng 1 giây): lần đăng nhập đầu chậm. Chấp nhận được.
- `page_views` tăng mãi. Giữ 180 ngày: mỗi ngày một lần, lúc khởi động hoặc qua lệnh admin, xoá bản ghi cũ hơn.
- Bắt buộc đăng nhập sẽ làm mất người chơi thử. Đây là quyết định của chủ dự án.
