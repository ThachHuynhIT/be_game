# be_game — Môi trường, phát hành và lưu ý vận hành

be_game chạy **hai backend thật cùng lúc**, cùng code từ nhánh `main`: server tự host `https://play-api.fudio101.com` là máy chính, Vercel `https://be-game-omega.vercel.app` là máy dự phòng. Portfolio tự chuyển sang máy dự phòng khi máy chính không trả lời. Tài liệu này mô tả các môi trường, luồng từ PR tới hai backend, những gì phải giữ tương thích, và các bài học vận hành. Thao tác trên server (lệnh, cấu hình, sự cố) nằm ở [`SELF_HOSTING.md`](SELF_HOSTING.md); kiến trúc code ở [`GUIDE.md`](GUIDE.md).

Mục lục: [Môi trường](#các-môi-trường) · [Portfolio chọn backend](#portfolio-chọn-backend-thế-nào) · [Luồng phát hành](#luồng-phát-hành) · [Biến môi trường](#biến-môi-trường-theo-nơi-chạy) · [Giữ tương thích](#giữ-tương-thích-khi-đổi-code) · [Kiểm tra sau deploy](#kiểm-tra-sau-deploy) · [Sự cố và quay lại](#sự-cố-và-quay-lại) · [Bảo mật](#bảo-mật) · [Bài học](#bài-học-đã-gặp)

---

## Các môi trường

| Môi trường | URL | Chạy ở đâu | Store | Được deploy khi | Vai trò |
|---|---|---|---|---|---|
| **Tự host (chính)** | `https://play-api.fudio101.com` | Điện thoại `vsmart-zangyapro` (arm64), `compose.selfhost.yml`, sau Cloudflare Tunnel + Traefik của chủ máy | Upstash chung với máy dự phòng (sau khi chuyển; trước đó và khi quay lại: Redis trong compose, `./data/redis`) | Workflow **Deploy** sau khi CI pass trên một lần push vào `main` | Phục vụ portfolio |
| **Vercel production (dự phòng)** | `https://be-game-omega.vercel.app` | Vercel Functions, region `sin1`, Fluid compute | Upstash Redis (Singapore) | Vercel Git: **mỗi push vào `main`** | Portfolio tự chuyển sang khi máy chính không trả lời; nơi quay về khi cần |
| **Vercel preview** | `be-game-<hash>-thachs-projects-48e5eaf9.vercel.app` | Như trên | **Cùng Upstash Redis với production** (xem [Bài học](#bài-học-đã-gặp)) | Vercel Git: **mỗi push vào mọi nhánh khác** | Thử PR với frontend thật |
| **Local** | `http://localhost:4000` | `npm run dev` | RAM (hoặc `REDIS_URL` nếu đặt) | Tay | Phát triển, test |
| `docker-compose.yml` (Caddy) | — | Mẫu cho VPS có IP public | Redis volume | — | **Không dùng hiện tại**; giữ làm mẫu (README → "Tự host") |

```mermaid
flowchart LR
  P["portfolio<br/>(trình duyệt)"] -- "1. thử GET /api/rooms (3 s)" --> M["play-api.fudio101.com<br/>máy chính"]
  P -- "2. không trả lời → dùng" --> V["be-game-omega.vercel.app<br/>dự phòng"]
  M -- "REDIS_URL" --> U[("Upstash Redis<br/>kho chung")]
  V -- "REDIS_URL" --> U
  GH["push main"] -- "CI pass → workflow Deploy" --> M
  GH -- "Vercel Git" --> V
```

Sơ đồ vẽ trạng thái **sau khi chuyển sang kho chung**; khi `REDIS_URL` của máy chính trống, máy chính dùng Redis cục bộ trong compose.

## Portfolio chọn backend thế nào

Ở repo portfolio, `src/components/games/gameClient.ts` (chi tiết: `portfolio/docs/GAMES_GUIDE.md` §1.2):

- `NEXT_PUBLIC_TIENLEN_SERVER_URL` = máy chính, `NEXT_PUBLIC_TIENLEN_FALLBACK_URL` = máy dự phòng. Cả hai được gắn vào bundle **lúc build**: đổi thì phải redeploy portfolio.
- Sảnh và bàn mới dùng máy đầu tiên trả lời `GET /api/rooms` trong 3 giây; lựa chọn được nhớ 60 giây.
- **Hai máy dùng chung Upstash** (sau khi chuyển; cách chuyển và quay lại: [`SELF_HOSTING.md`](SELF_HOSTING.md#chuyển-sang--quay-lại-kho-chung)): phòng, sảnh và bảng điểm là một. Mỗi phòng vẫn được ghim vào máy tạo ra nó; máy đó không trả lời thì client tự thử máy còn lại (cần bản zonenop-game có failover theo phòng; bản cũ vẫn chờ máy đã ghim) và vào lại đúng phòng đang chơi (cùng mã, lượt, bài, tiền). `GET /api/health` của mỗi máy trả `redisHost` và `sharedStore`: hai máy phải báo cùng `redisHost`, `sharedStore: true`. Khi hai máy còn Redis riêng (trước khi chuyển, hoặc sau khi quay lại Redis cục bộ), `sharedStore` là `false` và hành vi cũ giữ nguyên: phòng không chuyển qua lại, ván đang chơi trên máy chính chờ máy chính sống lại.
- Link mời chưa biết máy: thử máy đang dùng, gặp "Không tìm thấy phòng" thì thử máy còn lại.

Hệ quả cho backend: **`GET /api/rooms` phải luôn rẻ và luôn có trên mọi môi trường** (portfolio dùng nó để thử máy còn sống), và chuỗi lỗi `"Không tìm thấy phòng"` của hub là một phần của giao thức — đổi nó thì phải đổi `ROOM_NOT_FOUND` bên portfolio cùng lúc.

## Luồng phát hành

1. **Nhánh → PR vào `main`.** CI (`.github/workflows/ci.yml`): `npm run typecheck`, `npm test` (gồm fuzz), kiểm tra hai file compose, build image Docker và gọi thử `/api`. Vercel build **preview** cho nhánh; dùng nó để thử với portfolio nếu cần (preview dùng chung Redis dự phòng — cẩn thận khi PR đổi cấu trúc state).
2. **Merge vào `main`.** Hai việc chạy **song song, độc lập**:
   - Vercel deploy production → máy dự phòng chạy commit mới sau khoảng 1 phút.
   - CI chạy trên `main`; xanh thì workflow **Deploy** đưa đúng commit đó lên máy chính (Tailscale OIDC → SSH → `docker compose up -d --build` → health). Chi tiết từng bước: [`SELF_HOSTING.md` → Luồng deploy](SELF_HOSTING.md#luồng-deploy).
3. CI trên `main` đỏ (ví dụ test chập chờn) thì **máy chính không được deploy nhưng Vercel vẫn deploy** → hai máy lệch phiên bản. Sửa CI rồi push lại, hoặc chạy Deploy bằng tay (Actions → Deploy → Run workflow, trên `main`) sau khi CI xanh.
4. Thay đổi cần cả frontend: merge và deploy be_game **trước**, kiểm tra cả hai máy, rồi mới deploy portfolio (xem mục dưới).

Chỉ `main` được deploy lên máy chính; CI của PR không bao giờ deploy. Không push thẳng vào `main`.

## Biến môi trường theo nơi chạy

| Biến | Local | Tự host (`~/apps/be_game/.env` + compose) | Vercel `be-game` |
|---|---|---|---|
| `REDIS_URL` / `KV_URL` / `UPSTASH_REDIS_URL` | trống → RAM | trống → compose dùng `redis://redis:6379`; đặt URL Upstash (bí mật, quyền `600`) để dùng chung kho với máy dự phòng | Upstash (integration), production **và** preview |
| `ALLOWED_ORIGIN` | trống → mọi origin | `https://portfolio-thach.vercel.app,https://portfolio-*-thachs-projects-48e5eaf9.vercel.app,http://localhost:3000,https://zonenop-game.vercel.app,https://zonenop-game-*-thachs-projects-48e5eaf9.vercel.app,https://play.fudio101.com` | **giống máy chính** (production, preview, development). Đổi một bên thì đổi bên kia, và Vercel cần redeploy mới áp dụng |
| `GAME_DOMAIN` | — | `play-api.fudio101.com` (bắt buộc; Traefik route theo nó) | — |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | compose đặt `PORT=4000` | không dùng |
| `VERCEL`, `VERCEL_REGION` | — | — | Vercel tự đặt; `/api/health` trả `region: "sin1"` |

Secret của workflow Deploy (environment `self-hosted` trên GitHub) và biến bên portfolio: bảng đầy đủ ở [`SELF_HOSTING.md` → Cấu hình](SELF_HOSTING.md#cấu-hình-nằm-ở-đâu). Mẫu cho local: `.env.example`.

## Giữ tương thích khi đổi code

Ba thứ được deploy độc lập và không cùng lúc: máy chính, máy dự phòng, portfolio (bundle cố định lúc build, người chơi có thể còn mở tab cũ hàng giờ). Vì vậy:

- **Giao thức chỉ thêm, không đổi tên hay bỏ trong một bước.** Field mới trong lệnh client → server phải optional ở server; field mới trong view phải optional ở client (portfolio khai báo `?`). Muốn bỏ một field: bỏ chỗ dùng ở portfolio trước, deploy, rồi mới bỏ ở be_game.
- **State trong Redis sống qua deploy** (TTL 12 giờ, AOF trên máy chính). Code mới phải đọc được phòng tạo bởi code cũ: settings qua `xxxSettingsOf(room)`, field mới optional có mặc định (GUIDE → "Phòng cũ trong Redis").
- **Thứ tự deploy khi frontend cần backend mới:** be_game (`main` → cả hai máy) → kiểm tra cả hai `/api/health` → portfolio.
- **Bản sao ở portfolio** (`src/lib/<game>/`): đổi luật/kiểu ở be_game thì sửa bản portfolio trong cùng đợt (GUIDE → "Đồng bộ với portfolio").
- **Deploy làm rớt WebSocket vài giây** (container được tạo lại; trên Vercel instance mới). Client tự kết nối lại, phòng còn nguyên trong Redis. `SIGTERM` đóng mọi socket bằng mã 1001 để client kết nối lại ngay (`src/server/app.ts`).

## Kiểm tra sau deploy

```bash
curl -s https://play-api.fudio101.com/api/health        # "ok":true,"store":"redis","region":"local"
curl -s https://be-game-omega.vercel.app/api/health # "ok":true,"store":"redis","region":"sin1"
ssh vsmart-zangyapro cat ~/apps/be_game/REVISION    # commit đang chạy trên máy chính
```

- Commit trên Vercel: Vercel → project `be-game` → Deployments (bản Production). Hai commit phải giống nhau; khác thì xem bước 3 của [Luồng phát hành](#luồng-phát-hành).
- Thử WebSocket thật: mở portfolio, tạo bàn, kiểm tra vào được.
- Workflow Deploy đã tự kiểm tra health trong container và (vì có variable `GAME_DOMAIN`) qua domain public.

## Sự cố và quay lại

| Tình huống | Ảnh hưởng | Làm gì |
|---|---|---|
| Máy chính tắt (pin, mất điện, mạng) | Bàn mới tự sang Vercel; bàn đang chơi trên máy chính treo tới khi máy sống lại | `tailscale status \| grep vsmart`; offline thì báo chủ máy (chỉ họ bật lại được). Không cần đổi gì ở portfolio |
| Bản mới lỗi trên cả hai máy | Mọi người chơi | Revert commit trên `main` → cả hai máy tự deploy lại. Gấp: Vercel → Instant Rollback cho máy dự phòng |
| Bản mới chỉ lỗi trên máy chính (môi trường khác) | Người chơi trên máy chính | Revert, hoặc tạm chuyển hẳn sang Vercel: đổi `NEXT_PUBLIC_TIENLEN_SERVER_URL` của portfolio về `https://be-game-omega.vercel.app` rồi redeploy portfolio |
| Workflow Deploy đỏ | Máy chính giữ bản cũ, Vercel đã có bản mới (lệch) | Đọc log; bảng sự cố ở [`SELF_HOSTING.md`](SELF_HOSTING.md#xử-lý-sự-cố) |
| Upstash hết quota / lỗi | Máy dự phòng và mọi preview hỏng; máy chính không ảnh hưởng | Kiểm tra trên Vercel Storage |

## Bảo mật

- `ALLOWED_ORIGIN` chặn trang lạ mở WebSocket từ trình duyệt; client không phải trình duyệt (không gửi `Origin`) luôn được nhận, nên đây không phải xác thực. Không dùng `https://*.vercel.app` (ai cũng tạo được); dùng mẫu theo project + team như ở bảng trên.
- Không có secret nào trong repo: `.env` bị ignore; key deploy, thông tin Tailscale nằm trong environment `self-hosted` của GitHub; Redis Vercel do integration quản lý.
- Key deploy trên máy chính bị giới hạn (`restrict,from=<dải IP tailnet>`); Tailscale dùng OIDC, không có secret lâu dài.
- Token người chơi không bao giờ nằm trong view (GUIDE → "Bảo mật view").

## Bài học đã gặp

**Hạ tầng / Vercel**
- Trên Vercel chỉ có 5 function (`api/*.ts`); `/api` trần **không phải function → 404**. Đừng dùng `/api` để kiểm tra máy còn sống; dùng `/api/rooms` hoặc `/api/health`.
- **Preview của be_game dùng chung Upstash Redis với production.** Một PR đổi cấu trúc state hay khoá Redis có thể làm hỏng phòng trên máy dự phòng ngay khi push nhánh. Với thay đổi kiểu đó: tránh mở phòng trên preview, hoặc tách store cho preview (Vercel → Storage → chỉ gắn store riêng cho Preview).
- **Upstash free tier (500k lệnh/tháng) cạn vì tab sảnh để mở**, không phải vì ván chơi: mỗi tab poll `/rooms` của cả 7 game mỗi 5–10 s, mỗi lần 2 + số phòng lệnh Redis. Vì vậy `recentRooms` / `leaderboard` của store Redis được cache ngắn trong process (`src/server/store.ts`) và dọn index tối đa 1 lần/phút. Không dùng cache CDN (`s-maxage`) cho các endpoint này: header CORS phụ thuộc `Origin`. Preview của mọi nhánh cũng tốn quota này.
- Gói Hobby giới hạn WebSocket 300 giây/kết nối; server gửi `reconnect` trước khi hết hạn (README → "Giới hạn của Vercel"). Máy tự host không có giới hạn này.

**Máy tự host**
- Firewall của host chặn traffic tailnet tới cổng Docker publish kiểu bridge → đi qua Traefik (`traefik_network`), không publish cổng.
- Host dùng containerd image store: build lại cùng tag thì image cũ tự biến mất; image không có `curl` → health check bằng `node -e "fetch(...)"` trong container.
- Build cache: mỗi app build bằng BuildKit builder riêng (`be_game`, `zonenop-game`), deploy tự dọn còn tối đa 1 GB / 2 GB rồi tắt builder. Không prune builder `default` (dùng chung với chủ máy); xem [`SELF_HOSTING.md`](SELF_HOSTING.md).
- Máy là điện thoại: có thể tắt cứng bất cứ lúc nào → `restart: unless-stopped`, dữ liệu ghi xuống đĩa (bind mount, AOF), và portfolio có máy dự phòng.
- Chủ máy có thể sửa file trong `~/apps/be_game` trực tiếp → so với repo trước khi deploy.

**CI / script**
- Script deploy chạy với `set -euo pipefail`: `| head` hay `| grep -q` làm lệnh trước nhận SIGPIPE → thoát 141 ngẫu nhiên. Lấy output vào biến rồi so.
- `compose.selfhost.yml` bắt buộc `GAME_DOMAIN` → mọi `docker compose config` trong CI phải truyền giá trị mẫu.
- **Test dùng `Math.random()` chưa inject sẽ chập chờn trên CI**, và CI đỏ trên `main` chặn deploy máy chính (Vercel vẫn deploy → lệch phiên bản). Mọi hàm phòng/ván nhận `random`, test truyền RNG có seed.

**Giao thức**
- Origin bị từ chối: be_game trả 403, nhưng qua Cloudflare/Traefik thường thành **502** khi mở WebSocket. Thấy 502 thì kiểm tra `ALLOWED_ORIGIN` trước.
- `"Không tìm thấy phòng"` được portfolio dùng để quyết định thử máy còn lại — giữ nguyên chuỗi này hoặc đổi đồng bộ.
