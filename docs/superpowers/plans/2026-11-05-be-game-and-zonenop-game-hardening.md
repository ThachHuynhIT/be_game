# be_game và zonenop-game hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giảm rủi ro tài khoản, cấu hình, protocol và hồi quy khi bảo trì hai repo; mọi thay đổi sản phẩm còn phụ thuộc phê duyệt kế hoạch và các quyết định được ghi bên dưới.

**Architecture:** Củng cố các ranh giới HTTP/WebSocket, account service, Redis CAS và client hiện có; bổ sung kiểm chứng trước khi tối ưu hoặc tách module. Giữ các lần phát hành độc lập tương thích, triển khai backend trước frontend theo `be_game:docs/DEPLOYMENT.md:89-98`.

**Tech Stack:** Giữ TypeScript strict/CommonJS, HTTP + `ws`, `ioredis`, `pg`, Vitest của BE (`be_game:tsconfig.json:3-15`, `be_game:package.json:15-29`); Next 16.3.0, React 19.2.8, Vitest, ESLint của FE (`zonenop-game:package.json:25-50`). `jsdom`, `@testing-library/react`, Playwright là bổ sung được đề xuất, chưa cài.

**Spec:** Yêu cầu chủ repo ngày 2026-11-05 và năm báo cáo `result-A.md` … `result-E.md` tại đường dẫn ghi ở §8. Báo cáo là đầu vào để đối chiếu, không thay thế bằng chứng nguồn.

## 1. Tóm tắt, phạm vi, những gì KHÔNG làm

Kế hoạch dựa trên file đang có ngày 2026-11-05: BE HEAD `99ecea8dda53b8412cd4b3be2fba04a7685df46c`, nhánh `main`; FE HEAD `e462ff27bcc74f14eea32bad968ed11c17655559`, nhánh `claude/codex-plan-review-games-738caf` (kết quả lệnh Git chỉ đọc, §8). Đây là hai snapshot cục bộ, không phải xác nhận bản đang chạy ngoài production.

Phạm vi: BE-1…BE-8, FE-1…FE-6; các phát hiện liên quan trực tiếp gồm IP proxy, payload không hợp lệ, card ẩn, đấu giá/Nối Chữ chưa có trên BE `main` dù đã có nhánh BE tương ứng chưa merge (§2), migration chạy lại và chi phí health. Thứ tự ưu tiên: bảo vệ admin → chống khoá đăng nhập/cấu hình mở → test Redis và hợp đồng → headers/session → test trình duyệt → refactor/đo hiệu năng → diễn tập kho chung có phê duyệt.

### Global Constraints

- Phiên soạn plan chỉ ghi đúng file này; không sửa code, lockfile, cấu hình, báo cáo, `.env` hoặc repo đối ứng; không cài package, chạy test/build, thao tác Git có ghi, deploy hay migration. Các checkbox dưới đây là công việc tương lai, chưa thực hiện.
- BE: nhánh công việc tạo từ `main`, PR vào `main`; merge vào `main` là phát hành, primary chờ CI nhưng Vercel triển khai qua Git riêng (`be_game:CLAUDE.md:88-91`, `be_game:CLAUDE.md:98-102`, `be_game:.github/workflows/deploy.yml:8-28`).
- FE: nhánh công việc tạo từ `develop`, PR vào `develop`; `main` chỉ nhận merge từ `develop`; mọi merge cần chủ repo đồng ý rõ ràng (`zonenop-game:CLAUDE.md:148-158`, `zonenop-game:CLAUDE.md:186-208`). Theo yêu cầu nhiệm vụ, mọi merge BE cũng cần chủ repo đồng ý.
- D1–D5 chưa chốt. Không biến khuyến nghị thành yêu cầu đã được phê duyệt. Việc phụ thuộc quyết định phải giữ trạng thái **chờ quyết định Dx**; có thể chuẩn bị test/bằng chứng trước nhưng chưa đổi hành vi phụ thuộc.
- Không đổi luật, tính điểm, định dạng token phiên, key Redis, TTL phòng hoặc invariant CAS trong đợt hardening; game vẫn là state machine thuần, state là JSON, lệnh bị từ chối không được lưu (`be_game:CLAUDE.md:65-71`, `be_game:src/server/hub.ts:498-505`).
- Chỉ thêm field protocol optional; code mới đọc được phòng cũ, client cũ và hai bản backup Vercel vẫn được kiểm thử (`be_game:docs/DEPLOYMENT.md:91-98`). Không dùng việc đồng bộ type để siết yêu cầu session đã có (`be_game:src/server/hub.ts:401-417`).
- Không thêm file function trong `api/` cho route mới; nếu cần route thì dùng router hiện hữu (`be_game:CLAUDE.md:59`). Không đổi CommonJS của BE hoặc tổ chức lại thành monorepo (`be_game:tsconfig.json:3-8`).
- Code/comment bằng tiếng Anh, nội dung người chơi và plan bằng tiếng Việt. Không log session, seat token, password, database/Redis URL có credentials, SSH key hoặc dữ liệu request thô.
- Refactor từng bàn, mỗi PR không đổi hành vi; giữ entrypoint/export, storage key, điều kiện phím tắt, countdown và reconnect. FE dùng SCSS Modules cho phần mới khi cần style, không đổi style hàng loạt (`zonenop-game:CLAUDE.md:67-93`).

Không làm: viết lại kiến trúc, đổi framework/store/thuật toán hash, VIẾT luật đấu giá hoặc backend Nối Chữ mới trong đợt này, chuyển sang delta/event sourcing, bật enforce CSP ngay, tự đổi chính sách mật khẩu/session, tự cutover Redis, tự chạy production drill, tự sửa dữ liệu quyền admin. Hai nhánh BE `origin/feature/typhu-auction` và `origin/feature/noi-chu` đã tồn tại, chưa merge vào `main` (§2); merge chúng là quyết định/PR riêng của chủ repo, nằm ngoài plan nhưng là phụ thuộc phát hành FE theo §5–6. Các thay đổi sản phẩm khác chỉ được nêu như nhánh có điều kiện hoặc cần tách yêu cầu sau này.

### Review Focus

1. Người đăng ký trước chiếm tên admin chưa có: T01 kiểm tra tên chuẩn hoá và các phương án D1.
2. Tấn công username từ IP A làm IP B không đăng nhập được: T02 kiểm tra hai IP, TTL và lỗi limiter.
3. Payload hợp lệ nhưng cũ/thiếu optional/card ẩn bị validator loại: T06–T07 dùng view tạo từ BE và fixture cũ.
4. Primary sống nhưng trả “không tìm thấy phòng”, hoặc primary mất mạng: T10–T11 phân biệt lỗi nghiệp vụ với lỗi mạng, không làm mất room pin.
5. Snapshot lặp và unmount làm phát lại FX/rò timer: T12–T18 kiểm tra event key, cleanup và StrictMode.

## 2. Kết quả kiểm chứng và phân loại độ lệch protocol

P0 = đường cấp quyền cao cần xử lý trước phát hành hardening; P1 = bảo mật/tính đúng/khả năng khôi phục; P2 = khả năng bảo trì và tối ưu sau số đo. “Xác nhận” chỉ áp dụng phạm vi source/config đã đọc. “Sai hoặc đã sửa” cũng dùng khi nhận định ban đầu quá rộng hoặc số liệu không còn đúng; không có nghĩa toàn bộ hạng mục đã hoàn tất.

| ID | Mô tả đã đối chiếu | Trạng thái | Bằng chứng file:dòng | Ưu tiên |
|---|---|---|---|---|
| BE-1 | Mật khẩu 1–72 code point sau NFC là quyết định có chủ ý đã có commit và test; đăng ký tên chưa có trong `ADMIN_USERNAMES` gọi `promote()` trước cấp session. Nguy cơ admin có điều kiện, không khẳng định đã bị khai thác. | Xác nhận | `be_game:dd8743a` — “Accounts: passwords 1-72 chars; PATCH /api/auth/me can rename username”; `be_game:src/accounts/username.ts:13-17`; `be_game:test/accounts-auth.test.ts:63-68`; `be_game:src/accounts/service.ts:84-90`; `be_game:src/accounts/service.ts:123-148`; `be_game:test/accounts-routes.test.ts:194-201` | P0 |
| BE-2 | `ALLOWED_ORIGIN` rỗng hoặc chứa `*` cho mọi Origin; thiếu Origin luôn được nhận. WS/auth từ chối Origin khác, các route đọc công khai chỉ bị giới hạn đọc bằng CORS; chưa biết env production. | Xác nhận | `be_game:src/server/hub.ts:552-566`; `be_game:src/server/app.ts:50-81`; `be_game:src/server/app.ts:109-117`; `be_game:src/server/authRoutes.ts:105-114`; `be_game:compose.selfhost.yml:19-22` | P1 |
| BE-3 | Bốn npm scripts, CI typecheck/test/Docker; chưa có cấu hình lint/format/audit tường minh và CI Redis service. Fake `eval` và concurrency memory không chứng minh Lua CAS trên Redis thật. Không suy luận GitHub Security ngoài repo đang tắt. | Xác nhận | `be_game:package.json:9-29`; `be_game:.github/workflows/ci.yml:15-54`; `be_game:src/server/store.ts:197-205`; `be_game:test/store-cache.test.ts:26-31`; `be_game:test/hub.test.ts:201-214`; kiểm kê §8 | P1 |
| BE-4 | Dùng `console.*`, nhưng đã có counter lệnh Redis và `stepsMs` trong health; nhận định “chưa có metric nào” sai. Chưa thấy pipeline telemetry tập trung trong phạm vi quét. | Sai hoặc đã sửa | `be_game:src/server/hub.ts:529-530`; `be_game:src/server/store.ts:357-367`; `be_game:src/server/store.ts:393-394`; `be_game:src/server/app.ts:163-179`; `be_game:src/server/app.ts:201-207` | P2 |
| BE-5 | Bucket username toàn cục 5/900 giây bị tiêu trước xác minh mật khẩu; lượt thứ 6 bị 429 kể cả đúng từ IP khác. Bucket IP riêng 10/900 giây; lỗi limiter hiện fail open. | Xác nhận | `be_game:src/accounts/service.ts:151-173`; `be_game:src/accounts/service.ts:92-105`; `be_game:src/accounts/rateLimit.ts:11-16`; `be_game:src/accounts/rateLimit.ts:31-37` | P1 |
| BE-6 | Bốn file luật lần lượt 1.372/1.360/1.224/1.122 dòng; 9 dòng dùng kiểu `any` có 12 lần xuất hiện, không phải 9 kiểu. Cast admin patch có validation tiếp ở service nên không gọi là hoàn toàn bỏ validation. | Xác nhận | `be_game:src/bang/game.ts:1369-1372`; `be_game:src/bang/actions.ts:1357-1360`; `be_game:src/typhu/game.ts:1221-1224`; `be_game:src/meono/game.ts:1119-1122`; `be_game:src/server/authRoutes.ts:195`; `be_game:src/accounts/service.ts:244-255`; danh sách `any` §8 | P2 |
| BE-7 | Mutation parse draft toàn phòng; stringify khi không discard, store Redis stringify lại. Có cache nên “luôn đọc Redis mỗi lệnh” sai; tối đa 12 attempts, chưa đo byte/latency runtime. | Xác nhận | `be_game:src/server/hub.ts:140-174`; `be_game:src/server/hub.ts:191-200`; `be_game:src/server/store.ts:244-262` | P2 |
| BE-8 | Đã có công cụ/Compose hỗ trợ kho chung, nhưng tài liệu nói chưa cutover/diễn tập. Chưa kiểm chứng runtime; `sharedStore:true` chỉ là heuristic hostname, không chứng minh hai máy cùng dữ liệu. | Xác nhận | `be_game:compose.selfhost.yml:19-21`; `be_game:src/tools/migrate-store.ts:83-101`; `be_game:docs/SELF_HOSTING.md:163-186`; `be_game:src/server/app.ts:102-103`; `be_game:docs/DEPLOYMENT.md:13-15` | P1 |
| FE-1 | Repo chưa khai báo security headers trong Next/Compose; session lưu localStorage và gửi Bearer. Chưa xác nhận headers do Cloudflare/Traefik/Vercel ngoài repo. Token có TTL 30 ngày nhưng có thu hồi sớm. | Xác nhận | `zonenop-game:next.config.ts:1-10`; `zonenop-game:compose.selfhost.yml:28-35`; `zonenop-game:src/components/auth/session.ts:18-19`; `zonenop-game:src/components/auth/session.ts:85-99`; `zonenop-game:src/components/auth/session.ts:128-142`; `be_game:src/accounts/session.ts:3-24`; `be_game:src/accounts/service.ts:169-202` | P1 |
| FE-2 | Có drift, nhưng không phải 11/14: 10/14 cặp có diff nội dung theo Git, 12/14 khác thô; tính thêm combos/rules là 10/16 và 12/16. Client parse JSON gán kiểu rồi truy cập, chưa validate envelope/view. | Sai hoặc đã sửa | Toàn bộ 16 cặp và trích dẫn hai bên trong bảng sau; `zonenop-game:src/components/games/gameClient.ts:372-385`; `zonenop-game:src/components/games/gameClient.ts:512-514` | P1 |
| FE-3 | Sáu component lớn 1.824/1.756/1.702/948/816/749 dòng. Có 21 disable `exhaustive-deps`, không phải 16; thêm 7 rule Hooks tắt theo thư mục. `TyPhuTable` đã tách, còn 679 dòng. | Sai hoặc đã sửa | `zonenop-game:src/components/game/ContraGame.tsx:1823-1824`; `zonenop-game:src/components/meono/MeoTable.tsx:1755-1756`; `zonenop-game:src/components/bang/BangTable.tsx:1701-1702`; `zonenop-game:src/components/splendor/SplendorTable.tsx:947-948`; `zonenop-game:src/components/tienlen/TienLenTable.tsx:815-816`; `zonenop-game:src/components/oanquan/OAnQuanTable.tsx:748-749`; `zonenop-game:src/components/typhu/TyPhuTable.tsx:53-79`; `zonenop-game:src/components/typhu/TyPhuTable.tsx:678-679`; `zonenop-game:eslint.config.mjs:12-22`; 21 vị trí ở §8 | P2 |
| FE-4 | 26 file `.test.ts` hiện có, Node-only; chưa có suite render component/E2E trong phạm vi kiểm kê. Chưa khai báo jsdom, Testing Library hay Playwright trực tiếp. | Xác nhận | `zonenop-game:vitest.config.mts:6-19`; `zonenop-game:package.json:5-50`; `zonenop-game:src/components/game-ui/logic.test.ts:1-9`; `zonenop-game:src/components/auth/session.test.ts:7-13`; `zonenop-game:.github/workflows/ci.yml:29-42`; kiểm kê §8 | P1 |
| FE-5 | Hai secrets được nội suy trực tiếp vào `run:`; `WEB_DOMAIN` cũng có mẫu tương tự. Chưa chứng minh payload độc hại/khai thác. | Xác nhận | `zonenop-game:.github/workflows/deploy.yml:68-74`; `zonenop-game:.github/workflows/deploy.yml:161-166` | P1 |
| FE-6 | Assets 286 file, 8.645.264 byte (8,645 MB; 8,245 MiB), không phải số đo chính xác 8,9 MB; không phải lượng tải mỗi trang. Đã có 6 rule a11y mức warn qua preset; chưa tìm thấy browser a11y/CWV runner. | Sai hoặc đã sửa | Metadata nhị phân đo bằng `Get-ChildItem`/`Measure-Object` (§8, không có dòng nguồn); `zonenop-game:eslint.config.mjs:1-7`; `zonenop-game:node_modules/eslint-config-next/dist/index.js:173-188`; `zonenop-game:.github/workflows/ci.yml:32-42`; `zonenop-game:package.json:5-14` | P2 |

### Bảng phân loại từng cặp

Mốc so sánh của bảng là **be_game `main`, HEAD `99ecea8`** với FE HEAD `e462ff2` (cũng là SHA `develop` cục bộ đã kiểm bằng `git rev-parse HEAD develop`, §8). FE đã merge UI đấu giá qua PR #92 (`zonenop-game:de658f8`); các nhánh BE chưa merge được đối chiếu riêng bên dưới, không trộn vào số đếm drift của `main`.

“Chỉ comment-import” bao gồm format/xuống dòng; hai cặp chỉ LF/CRLF được ghi riêng để không coi là drift logic. “Khác vô hại” nghĩa là khác biệt của cặp này chưa thấy làm lệch wire hiện tại, không phải chứng nhận toàn bộ game an toàn. “Có thể gây lỗi” gồm type/union không mô tả đúng đường chạy, chưa mặc nhiên là lỗi người chơi đã tái hiện. Mỗi cặp đã mở cả hai file, đếm dòng, so raw và bản chuẩn hoá CRLF; các diff nội dung đã đối chiếu bằng `git diff --no-index` hoặc đọc vùng nguồn (§8).

| Game | File | Loại | Bằng chứng hai bên và ý nghĩa |
|---|---|---|---|
| Tiến Lên | `cards.ts` | giống hệt | `be_game:src/game/cards.ts:1-52` ↔ `zonenop-game:src/lib/tienlen/cards.ts:1-52` |
| Tiến Lên | `combos.ts` | giống hệt | `be_game:src/game/combos.ts:1-91` ↔ `zonenop-game:src/lib/tienlen/combos.ts:1-91` |
| Tiến Lên | `rules.ts` | giống hệt | `be_game:src/game/rules.ts:1-28` ↔ `zonenop-game:src/lib/tienlen/rules.ts:1-28` |
| Tiến Lên | `protocol.ts` | có thể gây lỗi | BE có `signedOut`, FE union bản sao thiếu: `be_game:src/game/protocol.ts:156-162` ↔ `zonenop-game:src/lib/tienlen/protocol.ts:195-200`. Transport FE thực tế đã có/xử lý nó: `zonenop-game:src/components/games/gameClient.ts:346`, `zonenop-game:src/components/games/gameClient.ts:493-510`; không kết luận logout đang hỏng. |
| Mèo Nổ | `cards.ts` | khác vô hại | Shape card tương ứng: `be_game:src/meono/cards.ts:4-72` ↔ `zonenop-game:src/lib/meono/cards.ts:5-67`; BE counts `be_game:src/meono/cards.ts:123-148`, FE catalogue `zonenop-game:src/lib/meono/cards.ts:114-125`, `zonenop-game:src/lib/meono/cards.ts:161-168`; presets tương ứng tại `be_game:src/meono/cards.ts:219-237` ↔ `zonenop-game:src/lib/meono/cards.ts:604-622`. Không ép hai catalogue bằng nhau nguyên văn. |
| Mèo Nổ | `protocol.ts` | có thể gây lỗi | FE thiếu `settings.preset`, `dig`, `see`: `be_game:src/meono/protocol.ts:143-148` ↔ `zonenop-game:src/lib/meono/protocol.ts:170-173`; UI vẫn gửi tại `zonenop-game:src/components/meono/MeoTable.tsx:1327`, `zonenop-game:src/components/meono/MeoTable.tsx:1380-1383`, `zonenop-game:src/components/meono/MeoTable.tsx:1584`, qua hàm nhận message rộng `zonenop-game:src/components/meono/MeoTable.tsx:139-146`. |
| Cờ Tỷ Phú | `board.ts` | giống hệt | `be_game:src/typhu/board.ts:1-313` ↔ `zonenop-game:src/lib/typhu/board.ts:1-313` |
| Cờ Tỷ Phú | `protocol.ts` | có thể gây lỗi | BE `main` chưa có phase auction: `be_game:src/typhu/game.ts:52` ↔ `zonenop-game:src/lib/typhu/protocol.ts:10`; command `be_game:src/typhu/protocol.ts:168-184` ↔ `zonenop-game:src/lib/typhu/protocol.ts:224-238`. BE `main` default từ chối tại `be_game:src/typhu/room.ts:361-414`; FE đã disable khi setting thiếu tại `zonenop-game:src/components/typhu/waiting/TableSettings.tsx:220-227`, chỉ chọn panel khi phase auction tại `zonenop-game:src/components/typhu/centre/Centre.tsx:58`. Backend đấu giá đã có ở `origin/feature/typhu-auction` (`8858fd8`, `8fd9dfb`), chưa merge vào `main`; kết quả so nhánh ở đoạn dưới. Giữ guard T06, không viết luật mới. |
| Splendor | `cards.ts` | chỉ comment-import | Chỉ LF/CRLF; nội dung chuẩn hoá giống nhau: `be_game:src/splendor/cards.ts:1-121` ↔ `zonenop-game:src/lib/splendor/cards.ts:1-121`. |
| Splendor | `protocol.ts` | khác vô hại | `chat` → `chat?`, bỏ re-export runtime chung: `be_game:src/splendor/protocol.ts:1-5`, `be_game:src/splendor/protocol.ts:69-72` ↔ `zonenop-game:src/lib/splendor/protocol.ts:1-8`, `zonenop-game:src/lib/splendor/protocol.ts:72-75`; `ChatBox` có default tại `zonenop-game:src/components/games/ChatBox.tsx:14-22`. |
| Bang! | `cards.ts` | chỉ comment-import | Chỉ comment bản sao: `be_game:src/bang/cards.ts:1-5` ↔ `zonenop-game:src/lib/bang/cards.ts:1-5`. |
| Bang! | `protocol.ts` | chỉ comment-import | Comment/import alias: `be_game:src/bang/protocol.ts:1-5` ↔ `zonenop-game:src/lib/bang/protocol.ts:1-5`. |
| Cá Ngựa | `board.ts` | chỉ comment-import | Chỉ LF/CRLF; `be_game:src/cangua/board.ts:1-84` ↔ `zonenop-game:src/lib/cangua/board.ts:1-84`. |
| Cá Ngựa | `protocol.ts` | khác vô hại | Bỏ re-export runtime, ngoài đổi comment/import: `be_game:src/cangua/protocol.ts:1-4` ↔ `zonenop-game:src/lib/cangua/protocol.ts:1-7`; diff phần còn lại không đổi field/union. |
| Ô Ăn Quan | `board.ts` | chỉ comment-import | Thêm comment đầu file: `be_game:src/oanquan/board.ts:1-3` ↔ `zonenop-game:src/lib/oanquan/board.ts:1-7`. |
| Ô Ăn Quan | `protocol.ts` | khác vô hại | Bỏ re-export runtime, ngoài đổi comment/import: `be_game:src/oanquan/protocol.ts:1-4` ↔ `zonenop-game:src/lib/oanquan/protocol.ts:1-7`; diff phần còn lại không đổi field/union. |

Tổng 16 cặp = 4 giống hệt + 5 chỉ comment-import + 4 khác vô hại + 3 có thể gây lỗi. Phạm vi 14 cặp chỉ bỏ `combos.ts` và `rules.ts`; hai cặp EOL giải thích chênh giữa 10 diff nội dung và 12 diff thô (bằng chứng từng cặp ở bảng trên).

Đối chiếu riêng nhánh đấu giá BE tại `8fd9dfb` (`origin/feature/typhu-auction`): `src/typhu/protocol.ts:44-45` có `settings.auction?`, `:109` có auction view, `:193-194` có `bid`/`fold`; `src/typhu/game.ts:57` có phase `auction`. So với FE `src/lib/typhu/protocol.ts:83-84`, `:136-151`, `:204-238`, toàn bộ `TPCommand` giống nhau sau khi bỏ whitespace (lệnh đọc/so trong bộ nhớ ở §8). View có cùng các field auction, nhưng FE cho `folded`/`floor`/`floorFor` optional còn BE nhánh này yêu cầu chúng khi có auction; FE cũng giữ nhiều setting optional cho server cũ. Vì vậy phần đấu giá đã có backend đối ứng trên nhánh chưa merge, còn bảng trên vẫn phản ánh lệch với `main`; đây là kiểm tra source, chưa phải xác nhận tương thích runtime. `git log main..origin/feature/typhu-auction` xác nhận có `8858fd8` “typhu: add optional property auctions” và `8fd9dfb` “feat(typhu): auction fold, instant win, decliner floor, 80% opening price” (§8).

Các lỗi hợp đồng không thể phát hiện bằng raw diff đơn thuần:

- BE phát `type:"hidden"` với ID âm nhưng cả hai `MCard.type` chỉ dùng `CardType` không có `hidden`: `be_game:src/meono/room.ts:364-370`, `be_game:src/meono/cards.ts:4-72`, `zonenop-game:src/lib/meono/cards.ts:5-67`. Validator mới phải dùng representation riêng cho view, không biến `hidden` thành lá có thể chia/chơi.
- Cả hai `ClientMessage` Tiến Lên thiếu dữ liệu transport như session/look/device dù FE đang gửi và BE dùng session: `be_game:src/game/protocol.ts:142-153`, `zonenop-game:src/lib/tienlen/protocol.ts:181-192`, `zonenop-game:src/components/games/gameClient.ts:533-540`, `be_game:src/server/hub.ts:409-417`.
- FE có Nối Chữ trong registry (`zonenop-game:src/lib/noichu/protocol.ts:11`, `zonenop-game:src/components/games/gamesRegistry.ts:24`); BE `main` `99ecea8` chỉ route 7 game (`be_game:src/server/app.ts:20-42`) và upgrade route thiếu trả 404 (`be_game:src/server/app.ts:64-68`). Backend Nối Chữ đã tồn tại ở `origin/feature/noi-chu`, chưa merge vào `main`: commit thêm game `2db0ba5`, các commit `noichu:` tiếp theo và tip `40b7547` (log §8); `git ls-tree` xác nhận có `src/noichu/{board,game,protocol,room,words,extra}.ts` và dictionary. Không tính thành cặp thứ 17 trong bảng so với `main`; merge/deploy nhánh này là phụ thuộc phát hành riêng, T06 giữ guard khi backend thiếu capability, không viết backend mới.

## 3. CẦN CHỦ REPO QUYẾT ĐỊNH

Tất cả các lựa chọn dưới đây đang mở. Khi phê duyệt, ghi phương án, phạm vi áp dụng, người quyết định và ngày vào PR/kế hoạch. Không có trả lời mặc định đồng nghĩa phê duyệt.

### D1 — Chính sách mật khẩu user thường và bảo vệ admin (`ADMIN_USERNAMES`)

Cơ sở: Commit `be_game:dd8743a` “Accounts: passwords 1-72 chars; PATCH /api/auth/me can rename username” đã chủ ý hạ min từ 8 xuống 1 và thêm test nhận mật khẩu `"1"` (đã kiểm `git log --all`, `git show --stat` và diff source/test, §8). BE hiện chấp nhận 1–72 sau NFC, FE đặt min=1 (`be_game:src/accounts/username.ts:13-17`, `zonenop-game:src/components/auth/password.ts:1-12`); public register có thể promote (`be_game:src/accounts/service.ts:123-148`). **D1-a giữ đúng quyết định mật khẩu user thường đã có; D1-b/c là đảo lại quyết định đó cho thao tác đặt mật khẩu mới**, cần chủ repo chọn rõ ràng, không tự chọn. Ba phương án dưới đây gồm cả chính sách user và cơ chế bảo vệ admin; chủ repo có thể yêu cầu điều chỉnh trước khi chốt.

| Nhánh | Phương án | Ưu | Nhược |
|---|---|---|---|
| D1-a | Giữ user thường 1–72; giữ chỗ tên `ADMIN_USERNAMES`, bỏ auto-promote; cấp admin theo UID đã xác minh bằng công cụ vận hành | Giữ UX user, tách tên hiển thị khỏi quyền | Mật khẩu user vẫn dễ đoán; cần runbook/công cụ cấp quyền |
| D1-b | User thường 8–72 cho đăng ký/đổi/reset mới, login hash cũ còn dùng; bảo vệ/cấp admin theo UID như D1-a | Giảm mật khẩu quá ngắn, không khoá user hiện hữu, cơ chế quyền đơn giản | Đổi validation/UX hai repo; không tự nâng độ mạnh mật khẩu cũ |
| D1-c | User thường 12–72 cho thao tác đặt mới; giữ chỗ tên, bỏ auto-promote; mời admin bằng mã một lần có hạn sau xác minh danh tính vận hành | Tăng mức tối thiểu, kiểm soát cấp quyền và tự phục vụ theo lời mời | Ma sát lớn hơn, thêm secret/storage/chống replay invitation và quy trình thu hồi |

**Khuyến nghị, chưa chốt:** D1-b; admin đặt mật khẩu mới tối thiểu 12, tối đa 72 theo NFC cho cả ba phương án, giới hạn admin này cũng cần chủ repo xác nhận. Giữ role admin đã lưu, không tự hạ/cấp lại role hoặc buộc reset hàng loạt. T01/T10 chờ quyết định D1: a giữ test user 1 ký tự; b/c đổi test đặt mới và vẫn có regression login mật khẩu cũ. Với a/b thêm công cụ UID; c thêm invitation; cả ba đóng đường tự cấp admin chỉ bằng username công khai.

### D2 — Khi thiếu `ALLOWED_ORIGIN` ở production

| Nhánh | Phương án | Ưu | Nhược |
|---|---|---|---|
| D2-a | Cấu hình thiếu/rỗng/`*` làm cấu hình production không hợp lệ: Node từ chối khởi động, Vercel từ chối khởi tạo handler | Phát hiện sai env sớm, không âm thầm mở | Có thể làm deploy/health thất bại nếu chưa điền env cả hai backend |
| D2-b | Server vẫn sống; chỉ route nhạy cảm/WS từ chối khi cấu hình thiếu, health báo trạng thái cấu hình không hợp lệ | Giữ đường chẩn đoán, phù hợp serverless | Cần thống nhất 403/503, health/readiness và ngoại lệ route; lỗi dễ tồn tại lâu |
| D2-c | Giữ mở có cảnh báo nhưng phải bật cờ opt-in production tường minh (mới, nếu chọn) | Ít gián đoạn giai đoạn chuyển | Giữ bề mặt cross-origin rộng, phụ thuộc vận hành |

**Khuyến nghị, chưa chốt:** D2-a sau khi kiểm kê/đặt allowlist hợp lệ cho cả hai backend; D2-b là phương án nếu cần giữ health để sửa env. Chế độ dev riêng vẫn thuận tiện. T03 chờ quyết định D2; từng nhánh phải test rỗng/whitespace/`*`, same-host, không Origin và `/api/track`, giữ xác thực độc lập với Origin. Không cho `https://*.vercel.app` toàn nền tảng; tài liệu đã cảnh báo tại `be_game:docs/DEPLOYMENT.md:126-128`.

### D3 — Session localStorage + CSP hay cookie HttpOnly

Topology do chủ repo cung cấp, được tài liệu repo mô tả tại `zonenop-game:CLAUDE.md:9-14`: `https://play.fudio101.com` và `https://play-api.fudio101.com` cùng site nhưng khác origin; hai hostname `be-game-omega.vercel.app` và `zonenop-game.vercel.app` khác domain/site với nhau và với `fudio101.com`. Không coi “cùng site” là “cùng origin” hoặc giả định cookie của API tự đi theo khi chuyển sang backup.

| Nhánh | Phương án | Ưu | Nhược và nhánh triển khai |
|---|---|---|---|
| D3-a | Giữ Bearer/localStorage, CSP Report-Only rồi enforce sau kiểm chứng | Ít đổi API/WS và fallback, không phụ thuộc third-party cookie | JavaScript cùng origin vẫn đọc được token; CSP chỉ giảm rủi ro XSS, không loại bỏ. T09/T10 thêm lifecycle test, không đổi storage/transport |
| D3-b | Cookie HttpOnly host-only trên từng API; primary same-site dùng `Secure`/`SameSite` phù hợp, cross-origin fetch dùng credentials và CORS exact origin + credentials | Giảm khả năng trộm token qua JS ở primary | Backup cross-site có thể cần `SameSite=None; Secure` nhưng vẫn bị browser chặn third-party cookie; không thể dùng một Domain cookie cho các miền khác nhau. Phải giải quyết bootstrap/relogin backup, CSRF và xác thực WS; không gửi cookie/token trong URL |
| D3-c | Cookie HttpOnly tại mỗi frontend origin qua BFF auth mỏng; WS dùng vé ngắn hạn, một lần, do backend phát sau xác thực BFF (API mới nếu chọn) | Tránh dựa vào third-party cookie, giữ token dài hạn khỏi JS, có đường fallback qua BFF | Thêm route auth/proxy/ticket và vòng đời cookie/CSRF; Vercel không được giả định proxy WS dài hạn. JS chỉ giữ vé ngắn hạn, vẫn phải chống XSS và log vé |

**Khuyến nghị, chưa chốt:** D3-a cho đợt hardening nhỏ; nếu chủ repo yêu cầu HttpOnly, ưu tiên D3-c với thiết kế chuyển tiếp riêng nằm trong T10, không bật trước khi ma trận primary/backup chạy được. D3-b chỉ phù hợp sau khi chấp nhận/giải quyết giới hạn browser và đăng nhập backup. Nhánh cookie phải giữ Bearer cũ đủ thời gian chuyển tiếp (ít nhất TTL token 30 ngày từ lần ngừng cấp token cũ, trừ khi chủ repo quyết định thu hồi sớm), xác định ưu tiên cookie/Bearer, CSRF, logout/version, WS reconnect và rollback. TTL thực tại `be_game:src/accounts/session.ts:3-24`; phiên có thể thu hồi sớm tại `be_game:src/accounts/service.ts:169-202`. T10 chờ quyết định D3; T09 Report-Only và test có thể chuẩn bị độc lập.

### D4 — Nguồn sự thật cho protocol

Hai module targets khác nhau: BE CommonJS/Node, FE ESNext/bundler (`be_game:tsconfig.json:3-8`, `zonenop-game:tsconfig.json:3-13`); bản sao đã được quy định tại `be_game:CLAUDE.md:75-80`. FE có Zod dependency nhưng quét `src` chưa thấy sử dụng (`zonenop-game:package.json:35`; lệnh §8); không tự xoá dependency hoặc thêm Zod vào BE trước quyết định.

| Nhánh | Phương án | Ưu | Nhược |
|---|---|---|---|
| D4-a | Package chung chứa wire types/constants/dữ liệu chung, catalogue UI riêng | Một nguồn, ít sao chép; release version rõ | Cần nơi lưu/phát hành/quyền CI, package hỗ trợ CJS + bundler; chỉ types chưa validate runtime |
| D4-b | Schema nguồn sinh/suy ra types và validators | Hợp nhất type/runtime, phát hiện payload sai | Chi phí mô hình hoá chuẩn hoá hiện hữu, optional và card ẩn; cần quyết định nơi lưu schema, tool và artifact sinh |
| D4-c | Giữ bản sao + contract test theo hướng gửi/nhận, pin revision hai repo | Ít đổi tổ chức, xử lý drift sớm | Vẫn bảo trì hai bản, cần fixture thật và kiểm soát revision để không xanh giả |

**Khuyến nghị, chưa chốt:** D4-c cho giai đoạn này; có thể chuyển sang D4-b sau khi hợp đồng thực đã đầy đủ. T06/T07 chờ quyết định D4: a thêm package và test import CJS/bundler; b thêm schema/generation/check generated artifacts; c thêm manifest/fixtures/CI đối chiếu. Cả ba giữ view optional, transport auth đúng, catalogue riêng, không lấy type hiện tại làm schema strict một cách máy móc. Chốt version BE/FE đối ứng trước mỗi release, không lấy tip ngẫu nhiên của repo kia.

### D5 — Cách tách component lớn

`TyPhuTable` đã có facade/re-export, settings tải lười và transport orchestration (`zonenop-game:src/components/typhu/TyPhuTable.tsx:50-79`); đồng hồ riêng tại `zonenop-game:src/components/typhu/now.tsx:6-33` là mẫu tham khảo, không ép áp dụng mọi game.

| Nhánh | Phương án | Ưu | Nhược |
|---|---|---|---|
| D5-a | Tách theo trách nhiệm trong từng game: logic thuần → hook sở hữu state/effect → panel/dialog/waiting; giữ facade | Ranh giới kiểm thử rõ, review từng bước, không đụng luật | Cần bảo vệ lifecycle và API import; nhiều PR nhỏ |
| D5-b | Chỉ tách helper thuần và component lá lớn; giữ state/effect trong table | Rủi ro thấp, ít di chuyển lifecycle | Table vẫn còn nhiều điều phối; chỉ giảm một phần kích thước |
| D5-c | Gom các hook/panel giống nhau vào abstraction dùng chung ngay từ đầu | Giảm lặp khi mô hình trùng thật | Dễ abstraction quá mức và làm game khác hành vi; phạm vi/rủi ro cao |

**Khuyến nghị, chưa chốt:** D5-a, từng bàn một; Contra tách simulation/renderer/input vì là canvas, không ép vào mẫu panel. T12–T18 chờ quyết định D5: a làm đầy đủ các ranh giới nêu trong task; b chỉ lấy helper/component lá, giữ hooks tại table; c phải có bảng tương đồng và phê duyệt interface dùng chung trước, không triển khai abstraction xuyên tất cả game một lần. Mỗi PR không đổi hành vi, không coi số dòng thấp hơn là đủ hoàn thành.

## 4. Danh sách công việc theo thứ tự

Các bước sau chỉ thực hiện sau khi chủ repo duyệt kế hoạch; thứ tự trong mục này là thứ tự chuẩn bị, thứ tự merge/phát hành bắt buộc ở §5–6. Ước lượng S ≈ 0,5–1 ngày, M ≈ 2–4 ngày, L ≈ 5–8 ngày làm việc, chưa tính chờ quyết định/review/quan sát production. Đường dẫn “mới, sẽ thêm” là đề xuất chưa tồn tại; file hiện hữu được gắn bằng chứng ở trường Lý do hoặc File ảnh hưởng. Lệnh test trong task là lệnh tương lai, không phải kết quả đã chạy trong phiên viết plan.

### T01 — Đóng đường chiếm quyền admin, áp dụng chính sách mật khẩu được duyệt

**ID:** T01 (BE-1, P0).
**Repo:** be_game; validation/copy FE triển khai ở T10 sau BE.
**Mục tiêu:** Tên admin chưa được đăng ký không thể tự tạo session admin bằng public register; thực thi đúng D1, giữ tài khoản cũ dùng được.
**Lý do:** `promote()` ở register và login dựa vào username; min mật khẩu là 1 (`be_game:src/accounts/service.ts:123-168`, `be_game:src/accounts/username.ts:13-17`).
**File ảnh hưởng:** `src/accounts/service.ts`, `src/accounts/username.ts`, `test/accounts-auth.test.ts`, `test/accounts-routes.test.ts`, `README.md`, `.env.example`, `docs/DEPLOYMENT.md`; `src/tools/bootstrap-admin.ts` và `test/bootstrap-admin.test.ts` (mới, sẽ thêm nếu D1-a/b); `src/accounts/adminInvite.ts` và `test/admin-invite.test.ts` (mới, sẽ thêm nếu D1-c; storage/transaction và API lời mời phải được duyệt trước code).
**Các bước:**

- [ ] Ghi lựa chọn D1-a/b/c cùng giới hạn admin vào PR; lập danh sách thao tác register/updateMe/admin reset/promotion chịu policy, không đọc/in hash hay mật khẩu thật.
- [ ] Thêm regression test trước sửa: tên admin trống chưa ai sở hữu, khác hoa/thường, khoảng trắng/NFC, tên đã có, admin hiện hữu, login mật khẩu cũ, user không thể tự nâng role.
- [ ] Cả ba phương án bỏ auto-promote register/login và giữ chỗ tên. Theo D1-a/b: công cụ chỉ cấp role cho UID đã tồn tại sau xác minh vận hành; D1-c: invitation một lần có hạn được cấp qua đường vận hành đã xác thực, không dựa vào tên. Không tự chỉnh role đã lưu.
- [ ] Theo D1-a giữ min user=1; D1-b/c đổi min đặt mới tương ứng 8/12, max=72 và NFC; áp dụng nhất quán tại cả ba đường đặt mật khẩu. Login dùng hash cũ, không áp min mới lên mật khẩu đang xác minh; admin theo giới hạn riêng đã duyệt.
- [ ] Chạy `npm run typecheck`, `npm test`; cập nhật tài liệu cơ chế cấp quyền và rollback, gửi chủ repo review trước merge.

**Test cần thêm:** Bảng min−1/min/72/73, Unicode NFC/code point, policy admin, tên giữ chỗ chuẩn hoá, replay invitation nếu chọn, UID không tồn tại nếu chọn; session và role admin cũ không tự đổi. Test phải tái hiện hành vi trước sửa theo D1 đã chọn.
**Tiêu chí hoàn thành (đo được):** 0 trường hợp public register cấp admin ngoài cơ chế D1 đã duyệt; toàn bộ policy matrix xanh; login hash cũ xanh; diff không thay format scrypt/session.
**Rủi ro và rollback:** Có thể mất bootstrap admin hoặc khoá thao tác reset. Kiểm tra admin hiện hữu trước phát hành; rollback policy/config riêng, giữ đường đăng ký admin công khai đóng. Không revert mù toàn bộ về lỗ hổng cũ.
**Ước lượng (S/M/L):** M; L nếu chọn invitation.
**Phụ thuộc:** **chờ quyết định D1**; phê duyệt merge/vận hành của chủ repo; T10 đồng bộ validation FE sau khi BE đã phát hành.

### T02 — Ngăn username lockout và kiểm chứng nguồn IP

**ID:** T02 (BE-5, P1).
**Repo:** be_game.
**Mục tiêu:** Lỗi đăng nhập từ IP A không tiêu bucket username của IP B; IP từ proxy chỉ được tin trong topology đã kiểm chứng.
**Lý do:** Bucket username toàn cục đứng trước verify (`be_game:src/accounts/service.ts:151-167`); `clientIp()` ưu tiên header trước socket, không có kiểm tra peer ở hàm này (`be_game:src/server/authRoutes.ts:36-41`). Khả năng giả header ngoài production chưa xác nhận.
**File ảnh hưởng:** `src/accounts/service.ts`, `src/accounts/rateLimit.ts`, `src/server/authRoutes.ts`, `test/accounts-routes.test.ts`, `docs/DEPLOYMENT.md`; `test/accounts-rate-limit.test.ts` (mới, sẽ thêm); `.env.example`/Compose chỉ nếu cần cấu hình trusted proxy mới.
**Các bước:**

- [ ] Viết test hai IP: 5 sai ở A, login đúng ở B phải thành công; sai cùng cặp bị hạn chế; vẫn có trần IP chống dò nhiều tên.
- [ ] Thay hard block username toàn cục bằng cặp username chuẩn hoá–IP, namespace bucket mới; giữ trần IP 10/900 giây và cặp 5/900 giây làm đề xuất triển khai, không thêm hard block username toàn cục khác.
- [ ] Kiểm tra Cloudflare/Traefik/Vercel có ghi đè header và Node có đường trực tiếp hay không bằng cấu hình được chủ repo cung cấp; chưa có bằng chứng thì chưa tuyên bố production bị bypass. Đường trực tiếp lấy socket IP, header chỉ dùng khi peer/platform đã tin cậy; không coi `NODE_ENV=production` là bằng chứng proxy tin cậy.
- [ ] Giữ lỗi đăng nhập chung, namespace/TTL rõ ràng, không log raw username/IP; test fail-open hiện hữu và phát event khi limiter lỗi, không âm thầm đổi sang fail-closed.
- [ ] Chạy `npm run typecheck`, `npm test`; test memory và Redis thật trong T04, ghi runbook nguồn IP của từng môi trường.

**Test cần thêm:** TTL ngay trước/đúng 900 giây; tên sai không tạo key raw; khác case/NFC cùng bucket cặp; 10/IP; header giả trên kết nối trực tiếp, peer tin cậy, Vercel; limiter throw; dọn key hết hạn.
**Tiêu chí hoàn thành (đo được):** Kịch bản A→B thành công; A bị 429 đúng ngưỡng; không có key username toàn cục gây chặn B; các test nguồn IP đều xanh, topology production còn thiếu được ghi rõ.
**Rủi ro và rollback:** Cặp IP làm yếu chống bot phân tán theo username; theo dõi sai/429 và CPU verify. Có thể rollback riêng cấu hình proxy; không khôi phục hard lock username toàn cục như phương án mặc định.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** Không phụ thuộc D1–D5; phối hợp T04/T05 cho Redis và quan sát; thay đổi proxy production cần chủ repo duyệt.

### T03 — Chính sách Origin production có cấu hình rõ ràng

**ID:** T03 (BE-2, P1).
**Repo:** be_game.
**Mục tiêu:** Thiếu allowlist không âm thầm mở production ngoài phương án D2 đã được chấp nhận.
**Lý do:** Fallback mở và same-host exception tại `be_game:src/server/hub.ts:552-565`; auth/track có cách áp dụng khác tại `be_game:src/server/authRoutes.ts:105-114`; preflight/CORS tại `be_game:src/server/app.ts:50-55`, `be_game:src/server/app.ts:109-117`.
**File ảnh hưởng:** `src/server/hub.ts`, `src/server/app.ts`, `src/server/authRoutes.ts`, `test/origin.test.ts`, `test/accounts-routes.test.ts`, `compose.selfhost.yml`, `docker-compose.yml`, `.env.example`, `docs/DEPLOYMENT.md`; test WS tại `test/hub.test.ts` hoặc test server riêng (mới, sẽ thêm nếu cần).
**Các bước:**

- [ ] Lập ma trận allowlist cho FE primary, bản Vercel, preview được phép, local; kiểm tra cấu hình cả BE primary/backup mà không đưa secret vào log.
- [ ] Thêm test rỗng/whitespace/`*` đơn hoặc trong list, exact origin, project preview pattern, Origin lạ/null/malformed, same-host, thiếu Origin, OPTIONS và WS upgrade.
- [ ] Thực hiện D2-a: validation cấu hình fail sớm; D2-b: từ chối auth/admin/WS khi cấu hình thiếu, giữ chẩn đoán; D2-c: cờ mở opt-in mới kèm cảnh báo. Ghi riêng status/readiness theo nhánh đã duyệt; dev không bị áp quy tắc production ngoài ý định.
- [ ] Chốt bằng test cách xử lý `/api/track` và route đọc công khai, không đồng nhất “không có CORS header” với “HTTP đã bị từ chối”; giữ auth bắt buộc cho join/watch.
- [ ] Cập nhật env mẫu, Docker smoke CI với allowlist mẫu nếu D2-a; chạy `npm run typecheck`, `npm test`, CI hiện hữu; điền env thật trước bật enforcement.

**Test cần thêm:** Test HTTP và WS thật ở local, allowed/rejected Origin; không Origin giữ hợp đồng client phi trình duyệt nếu D2 không đổi điểm này; CORS phản chiếu exact origin và `Vary`; `/api/track` theo quyết định.
**Tiêu chí hoàn thành (đo được):** 100% ma trận có assertion; hai BE có cấu hình allowlist được kiểm chứng; tất cả client/domain được duyệt vẫn đăng nhập/join được; không có wildcard toàn Vercel vô tình được chấp nhận.
**Rủi ro và rollback:** Sai allowlist gây 403/WS qua proxy có thể biểu hiện 502 theo `be_game:docs/DEPLOYMENT.md:155-156`. Sửa allowlist về bản đã kiểm chứng; không bỏ trống để khôi phục dịch vụ; D2-a phải có env trước khi merge.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** **chờ quyết định D2**; phối hợp D3 nếu nhánh cookie cần thêm CORS credentials nhưng không bật credentials trước khi cần.

### T04 — CI Redis thật và công cụ chất lượng BE

**ID:** T04 (BE-3, P1).
**Repo:** be_game.
**Mục tiêu:** Kiểm chứng Lua CAS/pubsub trên Redis thật, rồi thêm kiểm tra chất lượng không tạo PR format toàn repo.
**Lý do:** CI hiện chỉ typecheck/test/Docker (`be_game:.github/workflows/ci.yml:15-54`); Lua cần version/TTL/index/pubsub (`be_game:src/server/store.ts:197-205`), fake eval không chạy script (`be_game:test/store-cache.test.ts:26-31`).
**File ảnh hưởng:** `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `test/store-redis.integration.test.ts`, `vitest.config.ts`, `vitest.redis.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.github/dependabot.yml`, `.github/workflows/codeql.yml` (các file sau `package-lock.json` trong danh sách này đều mới, sẽ thêm); `docs/GUIDE.md`.
**Các bước:**

- [ ] Thêm job `redis-integration` (mới, sẽ thêm) vào workflow `CI` hiện hữu, service image `redis:7`, healthcheck chờ sẵn sàng; URL trỏ Redis job cô lập, không dùng credentials/runtime production.
- [ ] Thêm script `npm run test:redis` (mới, sẽ thêm), cấu hình Redis riêng chỉ include integration file và bắt buộc fail nếu Redis CI không sẵn sàng; cấu hình mặc định mới loại integration khỏi Node suite để `npm test`/job `test` cũ không cần Redis. Không skip trong Redis job khiến CI xanh giả.
- [ ] Test hai connection cùng expectedVersion chỉ một save thắng; kiểm tra state/version/TTL/index và pub/sub khi thắng/thua, phòng hết TTL, subscribe/unsubscribe; chỉ dọn namespace test do job sở hữu.
- [ ] Thêm ESLint/Prettier cùng `npm run lint`, `npm run format:check` (đều mới, sẽ thêm), ban đầu kiểm tra file mới/đổi và module đã xử lý; không reformat toàn repo hoặc bật rule làm hàng trăm lỗi ngoài task.
- [ ] Thêm Dependabot config và workflow `CodeQL` trong `codeql.yml` (mới, sẽ thêm), quyền tối thiểu; bước `npm audit` (CLI có sẵn của npm, bước CI mới sẽ thêm) với baseline và exception có người chịu trách nhiệm/ngày hết hạn. Không ghi “dependency an toàn” khi chưa có kết quả audit.
- [ ] Chạy `npm run typecheck`, `npm test`, `npm run test:redis` (mới, sẽ thêm), các check lint/format mới và CI Docker; tách PR Redis khỏi PR tooling như §5.

**Test cần thêm:** Concurrency Redis thật ít nhất 20 vòng có barrier, không dùng sleep đoán; thua CAS không publish/cập nhật index/reset TTL, TTL so trong sai số thời gian có kiểm soát; pub/sub chỉ assert thông báo nhận trên từng subscriber, không giả định delivery exactly-once trên mạng.
**Tiêu chí hoàn thành (đo được):** Job Redis chạy thật không skip; 20/20 tranh chấp đúng một thắng; CI `test`, `docker`, `redis-integration` xanh; công cụ mới có kết quả/baseline rõ và không sửa format ngoài phạm vi.
**Rủi ro và rollback:** Test timing flake hoặc scan tạo nhiễu. Dùng barrier/timeout hữu hạn, log chẩn đoán không secrets; rollback job/tooling riêng, giữ regression test và không sửa Lua chỉ để test xanh.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** Không phụ thuộc D1–D5; phục vụ T02/T20/T21; runner cần Docker service.

### T05 — Logging có cấu trúc và số đo mutation

**ID:** T05 (BE-4, BE-7, P2).
**Repo:** be_game.
**Mục tiêu:** Có bằng chứng về lỗi/latency/CAS và kích thước state trước khi tối ưu; không triển khai hệ telemetry mới quá phạm vi.
**Lý do:** Đã có counter/health timing (`be_game:src/server/store.ts:357-394`, `be_game:src/server/app.ts:163-205`), nhưng mutate vẫn parse/stringify/retry (`be_game:src/server/hub.ts:143-174`).
**File ảnh hưởng:** `src/server/logger.ts`, `src/server/metrics.ts`, `test/observability.test.ts` (mới, sẽ thêm); `src/server/hub.ts`, `src/server/store.ts`, `src/server/authRoutes.ts`, `src/accounts/service.ts`, `docs/SELF_HOSTING.md`.
**Các bước:**

- [ ] Viết test schema log và redaction bằng password/session/token/URL giả, nested error/cause; logger chỉ nhận ngữ cảnh allowlist, không dump request/state/user.
- [ ] Thêm logger JSON nhỏ bằng runtime hiện có: level/event/game/commit/error đã lọc; chuyển các điểm lỗi quan trọng trước, giữ CLI migration dễ đọc và không đổi payload health.
- [ ] Đo mutation duration, parse/stringify duration, byte UTF-8, attempt/CAS conflict/store error, kết nối/phòng active bằng counter/gauge/histogram tổng hợp; nhãn hữu hạn theo game/operation/outcome, không user/room/token/IP.
- [ ] Test counter/gauge cleanup, cache no-op/retry; giới hạn sampling và overhead, ghi cách so counter process với dashboard Upstash (counter hiện không đầy đủ theo `be_game:docs/SELF_HOSTING.md:229-234`).
- [ ] Chạy `npm run typecheck`, `npm test`; lấy baseline 24–48 giờ sau phát hành được duyệt, ghi mẫu/tải trước và sau, chưa đổi cách lưu state.

**Test cần thêm:** Redaction đệ quy, logger không throw làm hỏng lệnh game, không chứa secret dù error có URL; retry counter đúng và rejected command không ghi success; gauge trở về baseline sau close/unsubscribe.
**Tiêu chí hoàn thành (đo được):** 0 secret trong corpus log test; có p50/p95/p99 và sample count theo game/operation hoặc ghi rõ chưa đủ mẫu; label cardinality hữu hạn; cùng fixture benchmark overhead mục tiêu ≤5% (ngưỡng đề xuất, đo rồi review).
**Rủi ro và rollback:** Log quá nhiều/metrics làm chậm, vô tình lộ thông tin. Sampling/cờ tắt instrumentation mới, revert riêng; không bỏ các error cần vận hành.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** Không phụ thuộc quyết định sản phẩm; số đo bắt buộc trước T20, hỗ trợ T21.

### T06 — Hợp đồng hai repo và guard cho backend cũ

**ID:** T06 (FE-2, P1).
**Repo:** be_game trước; zonenop-game sau.
**Mục tiêu:** Có nguồn hợp đồng đúng đường chạy và kiểm tra tương thích, không chỉ so text hai bản sao.
**Lý do:** Ba cặp có thể gây lỗi và các khoảng trống card ẩn/transport/Nối Chữ đã dẫn chứng ở §2; cast adapter không validate (`be_game:src/server/adapters.ts:194`).
**File ảnh hưởng:** Các cặp protocol/cards trong §2 khi cần; `src/server/hub.ts`, `src/server/adapters.ts`, FE `src/components/games/gameClient.ts`, `src/components/games/gamesRegistry.ts`, `src/components/typhu/waiting/TableSettings.tsx`; `test/protocol-contract.test.ts` và `test/fixtures/protocol/` ở BE, `src/lib/protocol-contract.test.ts` và `scripts/check-protocol.mjs` ở FE (mới, sẽ thêm nếu D4-c). D4-a/b thay phần manifest bằng package/schema tại đường dẫn được chủ repo duyệt trong PR, không tạo trước quyết định.
**Các bước:**

- [ ] Ghi D4 và pin SHA đối ứng; lấy fixtures từ hàm view/đường command thật cho 7 game BE, player và spectator, phòng cũ thiếu optional, Mèo Nổ bị nguyền, signedOut hai reason; lọc mọi token/private hand ngoài người sở hữu.
- [ ] Theo D4-c: manifest 16 cặp phân biệt data nguyên văn với catalogue/type; contract test theo chiều BE phát → FE nhận, FE gửi → BE xử lý. Theo D4-a: tách wire package khỏi `game.ts`/`room.ts`, test CJS và bundler. Theo D4-b: schema và bước generation/check drift, test validators với payload thật trước dùng strict.
- [ ] Bổ sung type FE Mèo Nổ cho `preset/dig/see`, hợp nhất `signedOut` transport; cập nhật transport join/watch có session/look/device đúng hành vi hiện hữu, không biến session thành tuỳ chọn ở bước xác thực.
- [ ] Giữ `chat?` và các fallback phòng cũ; mô tả card view ẩn riêng, không thêm `hidden` vào deck chơi được. Giữ auction optional/disabled trên BE cũ; đối chiếu với nhánh `origin/feature/typhu-auction` đã có (§2), không viết luật đấu giá mới ở BE.
- [ ] Xác minh revision có đấu giá/Nối Chữ trên từng backend trước release FE theo §5–6; hai nhánh BE tương ứng đã có nhưng chưa merge (§2). Nếu thiếu capability, FE giữ guard theo backend đang kết nối và thông báo chưa hỗ trợ, không gửi bid/fold hoặc WS Nối Chữ vào backend không hỗ trợ. Không suy từ lỗi mạng thành không hỗ trợ, không thêm backend game mới.
- [ ] Thêm `npm run test:contract` (mới, sẽ thêm ở repo cần runner đối chiếu) và bước CI trong hai `ci.yml` hiện hữu; checkout SHA đối ứng với quyền read-only và cơ chế chạy được trên fork PR, không phụ thuộc secret production; BE phát hành trước FE.

**Test cần thêm:** Fixtures cũ/mới/field thừa; card ẩn ID âm; cả signedOut reason; settings.preset/dig/see; auction vắng không gửi bid/fold; registry game thiếu capability; contract cố ý lệch phải làm CI đỏ, expected EOL/comment drift vẫn xanh.
**Tiêu chí hoàn thành (đo được):** 16 cặp có rule rõ; 7 game có player/spectator fixture và ma trận command liên quan; không còn các type thiếu vừa xác nhận; Nối Chữ không quảng bá khả năng chơi với BE thiếu route; SHA đối ứng hiển thị trong CI.
**Rủi ro và rollback:** Contract xanh giả khi fixture tự viết theo type sai hoặc lấy revision tuỳ ý; package/schema gây bundle/module lỗi. Dùng view thật và fixture cũ đã pin; rollback consumer về bản trước, giữ optional/guard, không đổi wire required.
**Ước lượng (S/M/L):** M với D4-c, L với D4-a/b.
**Phụ thuộc:** **chờ quyết định D4**; T04 để bổ sung kiểm tra BE; phát hành theo §6. PR hardening BE phải rebase/kiểm xung đột với hai nhánh tính năng chưa merge ở §2 theo thứ tự chủ repo chọn; T06 chạm `src/typhu/*` và hub/adapters nên cần đối chiếu lại hợp đồng sau tích hợp, không tự merge hai nhánh đó.

### T07 — Validate message tại ranh giới trước truy cập/mutation

**ID:** T07 (FE-2, BE-6 liên quan, P1).
**Repo:** be_game và zonenop-game.
**Mục tiêu:** JSON không đúng shape không gây exception/ghi state; dữ liệu hợp lệ cũ và field mới optional vẫn nhận được.
**Lý do:** FE truy cập `msg.type` ngoài catch parse và `.looks` trên view ép kiểu (`zonenop-game:src/components/games/gameClient.ts:372-385`, `zonenop-game:src/components/games/gameClient.ts:512-514`); BE mới kiểm object/type ở transport nhưng có validation thủ công sau đó (`be_game:src/server/hub.ts:340-348`, `be_game:src/game/room.ts:407-412`).
**File ảnh hưởng:** BE `src/server/hub.ts`, `src/server/adapters.ts`, `test/hub.test.ts`; FE `src/components/games/gameClient.ts`, `src/components/games/gameClient.test.ts`; validator/schema files (mới, sẽ thêm theo D4, xác định trong PR); các game command/view chỉ sửa khi test chỉ ra thiếu validation.
**Các bước:**

- [ ] Viết test JSON lỗi/null/primitive/array, envelope không type/type lạ, ack thiếu id/ok, state thiếu/null view, field số sai kiểu, payload quá lớn và command bị từ chối; ghi baseline chuẩn hoá hiện hữu.
- [ ] Parse về `unknown`; narrow envelope trước truy cập, validate view theo game ở nơi biết game. Theo D4-a dùng validator export từ package nếu có, D4-b dùng schema nguồn, D4-c dùng validator cục bộ và fixture hợp đồng; không thêm thư viện schema vào BE chỉ vì FE đã có Zod.
- [ ] Giữ field thừa cho forward compatibility, optional/default cho backend cũ; message loại mới chưa biết được bỏ qua an toàn/ghi event đã lọc, không đóng cả phiên chỉ vì field mới.
- [ ] Validate trước mutation nhưng giữ chuẩn hoá có chủ ý mà test hiện hữu đang dùng; không “siết” card IDs/boolean làm đổi luật hoặc từ chối client cũ mà không review. Session sai/thiếu vẫn bị từ chối như trước.
- [ ] Chạy typecheck/test hai repo, contract test mới và T11 smoke; không đưa validator strict vào production trước khi corpus view thật đều pass.

**Test cần thêm:** Payload malformed nêu trên; ack sai không resolve request khác; state invalid không thay view đang hiển thị; valid next message vẫn xử lý; unknown field giữ được; rejected command không đổi version/state, không lộ private view; cursed hand hợp lệ pass.
**Tiêu chí hoàn thành (đo được):** 0 uncaught exception trên corpus malformed; 100% fixture cũ/mới hợp lệ pass; room/version không đổi khi reject; không mất pending request hợp lệ vì ack giả sai shape.
**Rủi ro và rollback:** Validator quá chặt có thể ngắt bàn đang chơi. Triển khai quan sát/reject tối thiểu envelope trước, view từng game sau contract; cờ tắt validator view mới nếu cần, giữ kiểm null/envelope an toàn và auth.
**Ước lượng (S/M/L):** M–L theo D4.
**Phụ thuộc:** **chờ quyết định D4**; T06 định nghĩa hợp đồng thực; BE trước FE.

### T08 — Bỏ nội suy secrets/config trực tiếp vào shell deploy FE

**ID:** T08 (FE-5, P1).
**Repo:** zonenop-game.
**Mục tiêu:** SSH key/known hosts/domain được đọc như dữ liệu, không thành cú pháp shell.
**Lý do:** Hai secret tại `zonenop-game:.github/workflows/deploy.yml:68-74`, domain tại `zonenop-game:.github/workflows/deploy.yml:161-166`.
**File ảnh hưởng:** `.github/workflows/deploy.yml`; `scripts/check-deploy-env.mjs` hoặc test tương đương (mới, sẽ thêm; chỉ fixture giả, không chạy deploy); tài liệu triển khai liên quan nếu thay cách cấu hình.
**Các bước:**

- [ ] Thêm kiểm tra tĩnh ba vị trí đã xác nhận; fixture shell nhiều dòng chứa quote, dollar-parentheses và backtick, sentinel chứng minh không bị thực thi.
- [ ] Chuyển hai secret sang step `env:`; shell dùng biến có quote và `printf`, giữ tên secrets, file path và mode SSH cũ. Chuyển `WEB_DOMAIN` sang env, validate hostname trước ghép URL.
- [ ] Quét lại toàn bộ `run:` với `${{ secrets.* }}`, `${{ github.event.* }}`, `${{ vars.* }}`; biến có thể ảnh hưởng command phải đi qua env/validation phù hợp, không thay triggers/quyền deploy ngoài phạm vi.
- [ ] Chạy fixture trong shell Ubuntu của CI với dữ liệu giả, xác nhận byte/nội dung được giữ và sentinel không xuất hiện; chạy bốn kiểm tra FE hiện hữu, review diff workflow; deploy thật chỉ sau chủ repo đồng ý release.

**Test cần thêm:** Fixture multiline, quote, `$()`/backtick được giữ literal; không log secret; hostname không hợp lệ bị từ chối; assert không còn ba nội suy trực tiếp.
**Tiêu chí hoàn thành (đo được):** 0/3 vị trí cũ còn lại; sentinel không thực thi; config SSH test có quyền đúng; workflow parse/review và CI xanh.
**Rủi ro và rollback:** SSH key mất newline hoặc quoting khiến deploy lỗi. Kiểm tra fixture trước, rollback riêng step/config quoting đã biết tốt mà không lộ secret; không chạy workflow deploy để “thử” trên production trong PR.
**Ước lượng (S/M/L):** S.
**Phụ thuộc:** Không phụ thuộc D1–D5; release FE theo §5, có thể merge develop sớm sau approval.

### T09 — Security headers và CSP bắt đầu bằng Report-Only

**ID:** T09 (FE-1, P1).
**Repo:** zonenop-game; tầng HTTPS phối hợp chủ repo.
**Mục tiêu:** Có headers quản lý trong repo và CSP được quan sát trước enforcement, không làm hỏng theme/WS/fallback.
**Lý do:** Next config chưa có headers (`zonenop-game:next.config.ts:1-10`); ThemeProvider chưa truyền nonce (`zonenop-game:src/app/layout.tsx:59-64`), dependency có script inline (`zonenop-game:node_modules/next-themes/dist/index.mjs:1`); endpoint primary/fallback/WS lấy từ env (`zonenop-game:src/components/games/gameClient.ts:25-46`).
**File ảnh hưởng:** `next.config.ts`, `src/app/layout.tsx`; `src/lib/security-headers.ts`, test headers và `src/proxy.ts` (mới, sẽ thêm; proxy chỉ nếu phương án nonce được duyệt); CSP report endpoint/collector (mới, nếu chọn thu tập trung, không log URL room/session); `docs/GAMES_GUIDE.md`.
**Các bước:**

- [ ] Kiểm kê response headers thực ở primary/Vercel sau khi được phép truy cập; kiểm kê tài nguyên theo route, Next hydration, next-themes script, style runtime, fonts/ảnh cùng origin, HTTP(S)/WS(S) của cả hai BE. Không thêm origin ngoài không có bằng chứng.
- [ ] Thêm `X-Content-Type-Options: nosniff`, `Referrer-Policy` phù hợp; CSP đầu tiên là `Content-Security-Policy-Report-Only`, hạn chế `object-src`, `base-uri`, dự kiến `frame-ancestors`; nhớ frame-ancestors ở Report-Only chưa chặn nhúng. HSTS chỉ ở tầng HTTPS sau xác minh, không tự bật includeSubDomains/preload.
- [ ] Xác định cách cho Next/next-themes inline script và style: nonce theo request hoặc hash khi nội dung thật ổn định; nếu nonce, dùng `src/proxy.ts` và đo tác động dynamic rendering trước phê duyệt. Tài liệu Next cài sẵn xác nhận proxy convention và dynamic nonce tại `zonenop-game:node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11-23`, `zonenop-game:node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:179-197`.
- [ ] Chạy browser smoke đăng ký/login, đổi theme, hub/lobby, join/watch/reconnect, FX và cả backend fallback trên primary/Vercel; thu violation bằng listener browser trong CI, collector production chỉ nếu được duyệt, có rate limit và dữ liệu tối thiểu.
- [ ] Sau ít nhất 7 ngày quan sát đề xuất và 0 violation hợp lệ trong ma trận test, trình PR enforce riêng cho chủ repo duyệt. Không mở `unsafe-eval`/wildcard hoặc `unsafe-inline` script như kết quả cuối chỉ để hết report.

**Test cần thêm:** HTTP headers thực và CSP syntax; Next hydration/theme không lỗi; connect primary/backup HTTP+WS; inline styles hiển thị; trang lạ không được nhúng sau enforce; policy production không có localhost; report không chứa secrets.
**Tiêu chí hoàn thành (đo được):** Report-Only xuất hiện ở hai frontend; 100% luồng smoke xanh; danh sách nguồn và violation có kết luận; enforce là gate riêng, chỉ hoàn thành giai đoạn enforce khi chủ repo duyệt và kiểm tra lại nhúng/CSP.
**Rủi ro và rollback:** CSP chặn hydration/font/FX hoặc nonce làm mất static cache. Trước mắt Report-Only, rollback enforce về Report-Only, không xoá toàn bộ headers; nonce phải có số đo build/render/caching trước đưa vào.
**Ước lượng (S/M/L):** M; L nếu nonce cần đổi rendering.
**Phụ thuộc:** T11 cung cấp browser test; **chờ quyết định D3** cho biến thể session/CSP cuối; cách nonce/hash và HSTS phải được chủ repo review, không tự chốt kiến trúc rendering.

### T10 — Session lifecycle, đồng bộ mật khẩu FE và nhánh HttpOnly nếu được chọn

**ID:** T10 (FE-1, BE-1 liên repo, P1).
**Repo:** be_game trước, zonenop-game sau khi có thay đổi API; FE-only nếu giữ Bearer.
**Mục tiêu:** Chính sách D1/D3 nhất quán mà client cũ, primary và backup vẫn đăng nhập/reconnect được.
**Lý do:** FE lưu và gửi token tại `zonenop-game:src/components/auth/session.ts:85-99`, `zonenop-game:src/components/auth/session.ts:128-142`; WS gửi session trong join tại `zonenop-game:src/components/games/gameClient.ts:533-540`; version/revoke tại `be_game:src/accounts/service.ts:169-202`.
**File ảnh hưởng:** FE `src/components/auth/password.ts`, `password.test.ts`, `session.ts`, `session.test.ts`, `AuthForm.tsx`, `src/components/games/gameClient.ts`, `gameSignOut.test.ts`; BE `src/server/authRoutes.ts`, `src/server/hub.ts`, `src/accounts/session.ts`, account tests nếu cookie/ticket được chọn. BFF route/ticket handler và test (mới, sẽ thêm chỉ khi D3-c; thiết kế đường dẫn/API trong PR trước code), tài liệu auth/triển khai hai repo.
**Các bước:**

- [ ] Sau D1, đồng bộ validation đặt mật khẩu mới và thông báo FE theo NFC/code point; login không áp min mới vào mật khẩu cũ. Test đăng ký/update/admin reset cả hai repo cùng policy.
- [ ] Với D3-a: giữ localStorage/Bearer/WS hiện hữu, thêm test storage blocked, reload, đa tab, login thay phiên, password/logout/revoke, TTL ngay trước/đúng 30 ngày. Kết hợp T09, không tuyên bố CSP làm token không thể đọc qua JS.
- [ ] Với D3-b: BE bổ sung cookie auth song song Bearer, CORS credentials exact origin, CSRF cho mutation, cookie flags/path/expiry, ưu tiên auth khi có cả hai; xác thực WS từ cookie ở upgrade và fallback login riêng. Dừng phát hành nếu browser block third-party cookie làm backup mất đăng nhập; không dùng tự động hạ xuống token URL.
- [ ] Với D3-c: duyệt BFF auth mỏng ở từng FE origin, server giữ token dài hạn, cookie host-only HttpOnly/Secure; backend phát vé WS ngắn hạn một lần sau xác thực BFF, kiểm tra Origin và chống replay. Không thiết kế Vercel làm proxy WS dài hạn; giữ transport cũ trong chuyển tiếp.
- [ ] Chạy ma trận bốn cặp FE/BE (primary-primary, primary-backup, Vercel-primary, Vercel-backup), browser có/không third-party cookie; kiểm tra pin phòng và “not found” là kết quả cuối, chỉ failover vì unreachable. Đặt ngày ngừng cấp token cũ và cửa sổ giữ Bearer, không tự loại client cũ.
- [ ] Chạy các check hai repo, T06 contract/T11 E2E; nếu cookie được chọn, release additive BE ở cả hai host trước bật FE, removal Bearer là việc riêng ngoài đợt này.

**Test cần thêm:** TTL boundary, revoke/disabled/cache và delayed signedOut không xoá session mới; session sau đổi password; CSRF/Origin và replay ticket nếu chọn; logout cả cookie/Bearer/WS; third-party-cookie-blocked; fallback không lộ token.
**Tiêu chí hoàn thành (đo được):** Toàn bộ policy/lifecycle và bốn cặp host xanh; 0 token dài hạn đọc được từ JS trong chế độ HttpOnly mới nếu chọn, nhưng client Bearer cũ còn chạy trong cửa sổ; D3-b không được ghi done khi backup bị chặn cookie chưa giải quyết.
**Rủi ro và rollback:** Logout hàng loạt, credential precedence hoặc browser policy làm mất phiên. Giữ mode cũ trong migration; rollback cờ FE/BFF, BE tiếp tục chấp nhận Bearer; không khôi phục phiên đã revoke hoặc tiết lộ token để cứu fallback.
**Ước lượng (S/M/L):** M nếu D3-a; L nếu D3-b/c, cần chủ repo duyệt riêng thiết kế API cụ thể trước code.
**Phụ thuộc:** **chờ quyết định D1 và D3**; T01 BE trước phần policy FE; T03 nếu cookie CORS; T06/T07 và T11 cho compatibility.

### T11 — Component tests và E2E smoke với backend local trong CI

**ID:** T11 (FE-4, P1).
**Repo:** zonenop-game; checkout be_game chỉ để khởi động backend test.
**Mục tiêu:** Render/tương tác component thật và smoke đăng ký → tạo phòng → vào phòng qua HTTP/WS thật, không chỉ mock transport.
**Lý do:** Vitest hiện Node-only và include `.test.ts` (`zonenop-game:vitest.config.mts:6-19`); scripts/deps chưa có bộ DOM/E2E (`zonenop-game:package.json:5-50`); BE chạy local bằng `start` (`be_game:package.json:10-13`, `be_game:src/local.ts:6-14`).
**File ảnh hưởng:** FE `package.json`, `package-lock.json`, `vitest.config.mts`, `.github/workflows/ci.yml`; `vitest.components.config.mts`, `src/test/setup.ts`, `src/components/auth/AuthForm.test.tsx`, `src/components/game-ui/GameButton.test.tsx`, `playwright.config.ts`, `e2e/auth-room.spec.ts` (mới, sẽ thêm).
**Các bước:**

- [ ] Thêm dev dependencies `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@playwright/test` (mới, sẽ thêm); dùng Vitest hiện hữu, giữ Node suite và alias, include `.test.tsx` trong cấu hình DOM riêng.
- [ ] Thêm `npm run test:components` và `npm run test:e2e` (mới, sẽ thêm); giữ nghĩa `npm test` hiện hữu. Component test kiểm UI thật bằng role/label, mock network ở ranh giới, không snapshot toàn bộ DOM.
- [ ] Thêm job `browser-smoke` (mới, sẽ thêm) trong workflow `CI` hiện hữu; checkout BE SHA đã pin bằng quyền đọc, cài từ lockfile trong CI tương lai, Node BE 22 và FE theo CI hiện hữu 24 (`be_game:.github/workflows/ci.yml:19-26`, `zonenop-game:.github/workflows/ci.yml:23-42`).
- [ ] Khởi động BE local bằng `npm start` trong thư mục checkout, `HOST=127.0.0.1`, port 4000, accounts memory test rõ ràng, session secret giả, Origin localhost FE, không Redis/Neon production. Chờ `/api` readiness nhẹ; FE `npm run build` với backend URL local rồi `npm start`, chờ HTTP sẵn sàng. Cài browser Playwright trong CI, teardown process dù pass/fail.
- [ ] Browser A đăng ký user duy nhất/tạo phòng Tiến Lên, browser B đăng ký user khác/vào bằng mã, assert hai ghế và không “Cần đăng nhập”; reload A vào lại đúng ghế. Dùng retry assertion dựa UI/state, không fixed sleep hoặc bật retry để che lỗi.
- [ ] Lưu trace/screenshot/log đã lọc khi fail; chạy cùng backend pin hiện tại và fixture/version cũ trong contract job; giữ bốn check FE hiện hữu và CI BE xanh.

**Test cần thêm:** AuthForm lỗi validation/loading/submit, button disabled/keyboard; smoke chính có hai context riêng; session hết hạn, reconnect sau socket close, spectator không gửi lệnh. Failover dùng hai BE local và network fault có kiểm soát, không gọi primary/Vercel thật từ CI.
**Tiêu chí hoàn thành (đo được):** Suite Node cũ vẫn chạy; component suite render được; 3 lượt CI liên tiếp smoke đăng ký/tạo/vào/reload xanh không retry che lỗi; tắt backend phải làm smoke fail; process dừng và artifacts chỉ lưu khi cần.
**Rủi ro và rollback:** CI flake, cross-repo permission, sai env build làm test gọi production. Assert base URL localhost từ config và network request; fail khi BE SHA không checkout được, không âm thầm mock; rollback job browser riêng, giữ test cho chẩn đoán.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** Không cần chờ D1–D5 để dựng harness; dùng password đủ policy đang chọn, T06 cung cấp SHA/fixture; bổ sung case D3 cookie sau quyết định.

### T12 — Tách bàn Tiến Lên trước để kiểm chứng cách làm

**ID:** T12 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Tách helper/seat/waiting khỏi table, giữ API `useTienLenRoom`, thao tác bài và phím tắt.
**Lý do:** `sortHand` sao chép mảng và countdown/transport đã rõ ranh giới (`zonenop-game:src/components/tienlen/TienLenTable.tsx:41-58`); table 816 dòng (`zonenop-game:src/components/tienlen/TienLenTable.tsx:815-816`), selection effect có disable tại `zonenop-game:src/components/tienlen/TienLenTable.tsx:164`.
**File ảnh hưởng:** `src/components/tienlen/TienLenTable.tsx`; `handLogic.ts`, `handLogic.test.ts`, `SeatViews.tsx`, `WaitingPanel.tsx`, `SettingsPanel.tsx`, `TienLenTable.test.tsx` trong cùng thư mục (mới, sẽ thêm); `useHandSelection.ts` (mới, chỉ D5-a).
**Các bước:**

- [ ] Ghi baseline component test cho sort rank/suit, chọn bài, play/pass ngoài lượt, spectator và shortcut.
- [ ] Theo D5-a tách helper → hook selection → seat/waiting/settings; theo D5-b chỉ helper và component lá, giữ selection/effect ở table; theo D5-c duyệt interface dùng chung rồi chỉ thử tại bàn này.
- [ ] Giữ `sortHand` không mutate input và thứ tự kéo tay; không thay props/export/WS/storage. Sửa dependency effect chỉ sau test snapshot lặp/hand đổi, không thêm cả object vào deps máy móc.
- [ ] Chạy bốn check FE, component suite mới, T11 smoke; so screenshot desktop/mobile, bàn phím và countdown trước/sau; mỗi PR chỉ bàn này, không đổi luật/style.

**Test cần thêm:** Bài rời tay bị bỏ chọn nhưng bài còn vẫn giữ, kéo tay khác sort tự động, play/pass đúng điều kiện, reconnect snapshot không reset sai selection, cleanup countdown/unmount.
**Tiêu chí hoàn thành (đo được):** Payload command/visible state trước-sau bằng nhau trên fixtures; sort không mutate; 0 disable mới; không tăng rerender toàn bàn theo countdown; check/smoke xanh.
**Rủi ro và rollback:** Reset selection hoặc double shortcut. Revert PR refactor riêng, giữ test hồi quy và facade; không đụng `useTienLenRoom` transport trong PR này.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** **chờ quyết định D5**; T11; không xếp chung PR với T06/T07 transport.

### T13 — Tách bàn Splendor

**ID:** T13 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Tách tính chi phí, player/card/discard/waiting UI mà giữ selection token và export rules.
**Lý do:** `paymentPlan()` xử lý bonus/token/gold riêng (`zonenop-game:src/components/splendor/SplendorTable.tsx:75-85`); export rules tại `zonenop-game:src/components/splendor/SplendorTable.tsx:893`; file 948 dòng (`zonenop-game:src/components/splendor/SplendorTable.tsx:947-948`).
**File ảnh hưởng:** `src/components/splendor/SplendorTable.tsx`; `payment.ts`, `payment.test.ts`, `PlayerPanel.tsx`, `CardModal.tsx`, `DiscardPanel.tsx`, `Waiting.tsx`, `RulesDialog.tsx`, `SplendorTable.test.tsx` trong cùng thư mục (mới, sẽ thêm); `useTokenSelection.ts` (mới, chỉ D5-a).
**Các bước:**

- [ ] Thêm characterization tests cho bonus/gold, thiếu tiền, lấy hai cùng màu/ba màu, trả đá khi quá giới hạn và reset theo phase/turn.
- [ ] Theo D5-a tách payment → hook selection → panels/dialogs/waiting; D5-b giữ hook trong table, chỉ tách helper/component lá; D5-c chỉ dùng abstraction đã duyệt qua T12, nếu không tương đồng thì quay lại chủ repo quyết định.
- [ ] Giữ export `SplendorRules` qua entrypoint cũ, props và command payload; không thay ngưỡng luật hoặc giao diện.
- [ ] Chạy bốn check FE, component suite mới, smoke; so keyboard/focus và desktop/mobile trước/sau.

**Test cần thêm:** Gold chỉ bù thiếu, không mua khi thiếu; reset token khi phase/turn thay đổi nhưng không reset vì snapshot lặp; reserve/buy/discard gửi đúng payload và chỉ một lần.
**Tiêu chí hoàn thành (đo được):** Bảng payment fixtures cùng output trước/sau; exports/import consumers còn build; interactions cùng payload và disabled state; 0 lỗi check/smoke.
**Rủi ro và rollback:** Tính gold khác hoặc stale selection; revert PR Splendor riêng, giữ facade/test, không gộp đổi luật.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** **chờ quyết định D5**; T11 và rút kinh nghiệm T12.

### T14 — Tách bàn Ô Ăn Quan

**ID:** T14 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Tách player/waiting/dialog/move controls, giữ board/replay hiện hữu.
**Lý do:** Move bị khoá khi replay (`zonenop-game:src/components/oanquan/OAnQuanTable.tsx:91-104`); board đã có frame/timing/queue riêng (`zonenop-game:src/components/oanquan/Board.tsx:8-28`), export rules tại `zonenop-game:src/components/oanquan/OAnQuanTable.tsx:685`, table 749 dòng (`zonenop-game:src/components/oanquan/OAnQuanTable.tsx:748-749`).
**File ảnh hưởng:** `src/components/oanquan/OAnQuanTable.tsx`; `PlayerStrip.tsx`, `Waiting.tsx`, `RulesDialog.tsx`, `MoveControls.tsx`, `OAnQuanTable.test.tsx` trong cùng thư mục (mới, sẽ thêm); `useMoveControls.ts` (mới, chỉ D5-a). `Board.tsx` chỉ sửa nếu test chứng minh cần, không viết lại replay.
**Các bước:**

- [ ] Test selection ô/hướng, replay đang chạy, spectator, reseed notice và keyboard; cố định fixture replay theo seq.
- [ ] Theo D5-a tách UI và hook move/notice; D5-b chỉ UI lá, giữ lifecycle tại table; D5-c kiểm chứng abstraction không làm mất guard replay trước áp dụng.
- [ ] Giữ `OAnQuanRules` export cũ, `canMove` và replay queue/timing; không đổi animation hoặc luật rải/capture trong PR tách.
- [ ] Chạy bốn check FE/component suite mới; test background/resume, screenshot, smoke trước merge.

**Test cần thêm:** Không gửi lệnh khi animating/spectator; reset selection sau nước mới, snapshot lặp không hiện notice lại; unmount giữa replay không còn timer/listener.
**Tiêu chí hoàn thành (đo được):** 0 command khi bị khoá; từng event chỉ phát notice một lần; fixtures replay trước/sau cùng trạng thái; suite/smoke xanh.
**Rủi ro và rollback:** Enable thao tác sớm hoặc mất replay queue; revert PR Ô Ăn Quan, giữ `Board` API cũ và test.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** **chờ quyết định D5**; T11/T12.

### T15 — Tách bàn Mèo Nổ

**ID:** T15 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Tách hand logic, choice/waiting/seat/FX mà giữ card order, compact preference và hành động đã đồng bộ protocol.
**Lý do:** `classify/groupIdentical` và key compact ở cùng table (`zonenop-game:src/components/meono/MeoTable.tsx:85-120`); gửi `see/dig/preset` thực tế tại `zonenop-game:src/components/meono/MeoTable.tsx:1327`, `zonenop-game:src/components/meono/MeoTable.tsx:1380-1383`, `zonenop-game:src/components/meono/MeoTable.tsx:1584`; table 1.756 dòng (`zonenop-game:src/components/meono/MeoTable.tsx:1755-1756`).
**File ảnh hưởng:** `src/components/meono/MeoTable.tsx`; `handLogic.ts`, `handLogic.test.ts`, `ChoicePanel.tsx`, `Seat.tsx`, `Waiting.tsx`, `BoomOverlay.tsx`, `MeoTable.test.tsx` trong cùng thư mục (mới, sẽ thêm); `useHandSelection.ts`/`useLogEffects.ts` (mới, chỉ D5-a).
**Các bước:**

- [ ] Test classify một lá/combo, grouped annoyed cards, selection và cursed hidden IDs; freeze expected command và event sequences.
- [ ] Theo D5-a tách helper → selection/FX hooks → choice/seat/waiting/overlay; D5-b chỉ helper/component lá, giữ effects; D5-c không dùng generic hand model nếu không mô tả được card ẩn/order hiện hữu.
- [ ] Giữ key `meono:compactHand`, thứ tự hand/alter, props và event key FX. Xử lý dependency `ChoicePanel` bằng test thay order/metadata và snapshot lặp, không đổi semantics trong refactor.
- [ ] Chạy bốn check FE, component suite mới, contract và smoke; kiểm tra compact/non-compact, reconnect và overlay trên mobile/desktop.

**Test cần thêm:** Pair/triple/five, lá không thể chơi, grouped annoyed riêng, hand đổi giữ selection đúng; see/dig/preset gửi đúng union đã sửa; snapshot lặp không boom lại, `view.alter` mới cập nhật đúng, unmount dọn FX.
**Tiêu chí hoàn thành (đo được):** Tất cả command/event fixtures tương đương trước/sau; key preference không đổi; 0 effect disable mới; card ẩn còn render/chọn được theo hợp đồng đã duyệt; checks xanh.
**Rủi ro và rollback:** Mất thứ tự bài hoặc phát FX lặp. Revert riêng PR UI Mèo Nổ, giữ T06/T07 protocol và facade; không trộn sửa luật với tách table.
**Ước lượng (S/M/L):** L.
**Phụ thuộc:** **chờ quyết định D5**; T06/T07 về card ẩn/type phải ổn định trước refactor; T11/T12.

### T16 — Tách bàn Bang!

**ID:** T16 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Tách nhu cầu hành động, panels và state điều khiển, giữ clock skew ổn định và prompt lifecycle.
**Lý do:** `makeLocalize` có closure skew được giữ bằng `useState(makeLocalize)` (`zonenop-game:src/components/bang/BangTable.tsx:62-95`); table 1.702 dòng (`zonenop-game:src/components/bang/BangTable.tsx:1701-1702`), selection effect disable tại `zonenop-game:src/components/bang/BangTable.tsx:592`.
**File ảnh hưởng:** `src/components/bang/BangTable.tsx`; `actionNeeds.ts`, `actionNeeds.test.ts`, `ActionPanel.tsx`, `PromptPanel.tsx`, `DrawPanel.tsx`, `Waiting.tsx`, `PlayerTile.tsx`, `BangTable.test.tsx` trong cùng thư mục (mới, sẽ thêm); `useActionMode.ts` (mới, chỉ D5-a).
**Các bước:**

- [ ] Test nhu cầu target/card/options của hành động, đổi mode/prompt/turn và hand card biến mất; kiểm tra deadline trước/sau reconnect.
- [ ] Theo D5-a tách helper nhu cầu → state hook → panels/players/waiting; D5-b chỉ helper/panel lá, giữ hook; D5-c chỉ tái dùng interface đã chứng minh không gom nhầm các trạng thái prompt khác nhau.
- [ ] Giữ khởi tạo localize một lần mỗi mount, command payload, hand limit và reset selection; không tạo lại clock closure mỗi render.
- [ ] Chạy bốn check FE/component suite mới/contract/smoke; kiểm tra keyboard, pending action và unmount trong prompt.

**Test cần thêm:** Bảng trường hợp Needs, chọn mục tiêu sai/đúng, mode confirmation, card rời tay, snapshot lặp không reset mode, skew/deadline không nhảy vì rerender, gửi action một lần.
**Tiêu chí hoàn thành (đo được):** Output helper/command fixtures bằng baseline; localize instance giữ ổn định trong mount; prompt state/cleanup đúng; CI và smoke xanh.
**Rủi ro và rollback:** Reset mode hoặc mất clock skew làm người chơi bấm sai; revert PR Bang UI riêng, giữ helpers/test, không đổi server game rules.
**Ước lượng (S/M/L):** L.
**Phụ thuộc:** **chờ quyết định D5**; T11/T12, hợp đồng T06 ổn định.

### T17 — Tách Contra theo simulation/renderer/input

**ID:** T17 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Giảm component canvas lớn nhưng giữ simulation 60 Hz, input và cleanup.
**Lý do:** File 1.824 dòng (`zonenop-game:src/components/game/ContraGame.tsx:1823-1824`); vòng lặp fixed step hiện đã có (`zonenop-game:src/components/game/ContraGame.tsx:642-673`), disable ở `zonenop-game:src/components/game/ContraGame.tsx:709`.
**File ảnh hưởng:** `src/components/game/ContraGame.tsx`; `src/components/game/contra/types.ts`, `levels.ts`, `simulation.ts`, `renderer.ts`, `useContraLoop.ts`, `simulation.test.ts`, `ContraGame.test.tsx` (mới, sẽ thêm theo D5-a; D5-b chỉ types/levels/helper thuần và test, không chuyển loop).
**Các bước:**

- [ ] Ghi fixture tick/input cho collision, damage, chuyển level; đo số tick tương đương ở elapsed time 60/120/144 Hz và tab resume có clamp.
- [ ] Theo D5-a tách types/level factories → simulation → renderer → input/RAF hook; giữ mutable game state trong ref và fixed tick. D5-b chỉ helper/data; D5-c không áp abstraction room-table vào canvas, cần phương án Contra riêng được chủ repo duyệt.
- [ ] Component giữ canvas/entrypoint, Enter/Escape/visibility/pause, listener/RAF cleanup; không đổi physics, hình ảnh hoặc gameplay trong refactor.
- [ ] Chạy bốn check FE, pure simulation tests, component test mock canvas tối thiểu và browser smoke Contra; so hình/tick và test mount/unmount lặp.

**Test cần thêm:** Tick deterministic với input cố định, collision/damage, level transition, keydown/up, visibility resume không catch-up vô hạn, RAF/listener không nhân đôi trong StrictMode.
**Tiêu chí hoàn thành (đo được):** Cùng elapsed time/input cho cùng state simulation; 0 RAF/listener còn sau unmount; không tăng tick khi remount; browser controls/visual check và CI xanh.
**Rủi ro và rollback:** Đổi nhịp physics do closure/timing. Revert riêng Contra PR về loop cũ, giữ fixture baseline; không tối ưu rendering đồng thời.
**Ước lượng (S/M/L):** L.
**Phụ thuộc:** **chờ quyết định D5**; T11; làm sau một bàn mẫu đã chứng minh cách test/refactor.

### T18 — Effect dùng chung và thu hẹp lint overrides

**ID:** T18 (FE-3, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Rà các disable ngoài bàn đã tách; giảm suppression có bằng chứng hành vi, không bật rule cả repo một lần.
**Lý do:** Bảy Hooks rules đang tắt theo game folder (`zonenop-game:eslint.config.mjs:12-22`); 21 vị trí exhaustive-deps liệt kê đầy đủ ở §8, gồm timer/FX/chat/board ngoài table.
**File ảnh hưởng:** `src/components/games/ChatBox.tsx`, `TurnIndicator.tsx`, `src/components/cangua/Board.tsx`, `src/components/tienlen/Effects.tsx`, `src/components/typhu/TyPhuTable.tsx`, `board/walk.ts`, `board/Cell.tsx`, `fx/MoneyFx.tsx`, `fx/TurnBanner.tsx` trong thư mục TyPhu; `eslint.config.mjs`; component/hook tests colocate `.test.tsx` (mới, sẽ thêm).
**Các bước:**

- [ ] Lập bảng 21 effect: dữ liệu đọc, key sự kiện, cleanup, kỳ vọng snapshot lặp; mỗi effect chỉ có một task/PR sở hữu, không sửa lại phần T12–T17 đã xử lý.
- [ ] Test ba tình huống cho mỗi effect được sửa: cùng event gửi lại, dữ liệu phụ đổi nhưng key không đổi, unmount khi timer đang chạy; thêm selection/turn mới tương ứng.
- [ ] Theo D5-a tách hook khi thực sự có trách nhiệm riêng; D5-b giữ lifecycle tại component; D5-c chỉ chia sẻ sau khi ít nhất hai trường hợp có semantics giống và được duyệt. Bỏ từng suppression khi test chứng minh tương đương.
- [ ] Thu hẹp override ESLint theo file/module đã làm sạch; bật từng rule cho vùng đó, ghi lý do suppression còn lại. Chạy lint/typecheck/test/build/component suite mới và smoke.

**Test cần thêm:** FX chỉ một lần theo key, observer/timer cleanup, không cancel/restart animation do object snapshot mới, chat unread đúng, money/turn effects không lặp, reduced-motion vẫn được tôn trọng.
**Tiêu chí hoàn thành (đo được):** Không tăng tổng disable từ baseline 21; từng suppression bỏ có test; module mới không cần override rộng; rule còn tắt có owner/lý do cụ thể, không yêu cầu giảm về 0 bằng sửa hành vi.
**Rủi ro và rollback:** Thêm deps máy móc gây replay/hủy FX, timer leak. Revert từng effect/override nhỏ, giữ test; không bật đồng loạt rồi sửa hàng loạt.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** **chờ quyết định D5**; T11 và sau PR bàn tương ứng; không dùng abstraction toàn cục chưa duyệt.

### T19 — Loại `any` tại ranh giới HTTP/DB/Redis

**ID:** T19 (BE-6, P2).
**Repo:** be_game.
**Mục tiêu:** Narrow input/DB rows có kiểu, giữ status/error và chuẩn hoá hiện hữu.
**Lý do:** 9 dòng/12 kiểu `any` ở 6 file (dẫn chứng đầy đủ §8); admin patch route cast tại `be_game:src/server/authRoutes.ts:195` nhưng service có kiểm tra tại `be_game:src/accounts/service.ts:244-255`.
**File ảnh hưởng:** `src/server/authRoutes.ts`, `src/accounts/store.ts`, `service.ts`, `pg.ts`, `migrations.ts`, `src/server/store.ts`; `test/accounts-routes.test.ts`, `test/accounts-store.test.ts`, test counter hiện hữu hoặc mới nếu chưa có coverage.
**Các bước:**

- [ ] Test admin patch role/disabled/password kiểu sai và DB row có nullable field, migration callback, memory patch Date/session version và Redis counter.
- [ ] Narrow `unknown` ở HTTP rồi tạo patch có kiểu; khai báo row DB/query result và interface Redis tối thiểu phù hợp overload thật, tránh thay `any` bằng chuỗi `as unknown as` không kiểm chứng.
- [ ] Tách PR account boundary khỏi PR Redis counter types; giữ API runtime/status/error, không sửa luật hoặc đổi migration đã áp dụng.
- [ ] Chạy `npm run typecheck`, `npm test`, Redis integration mới và contract nếu đụng transport; quét lại kiểu `any`, phân biệt string literal/comment.

**Test cần thêm:** Các patch sai trả đúng lỗi cũ, tự hạ quyền/tự khoá vẫn bị chặn, field nullable DB giữ nguyên, counter wrap/restore đúng, query/migration không mất thông tin kiểu cần thiết.
**Tiêu chí hoàn thành (đo được):** 0 explicit `any` trong 9 dòng đã xác nhận hoặc exception có lý do/owner được review; không tăng cast kép; suite/typecheck xanh và HTTP contract không đổi.
**Rủi ro và rollback:** Type quá hẹp làm bỏ field DB hợp lệ hoặc đổi lỗi; revert từng boundary PR, giữ test và cấu trúc DB/session cũ.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** T01/T02/T07 ổn định để tránh sửa cùng boundary; T04 cho kiểm tra Redis; không phụ thuộc quyết định kiến trúc mới.

### T20 — Đo rồi giảm serialize lặp nếu có lợi

**ID:** T20 (BE-7, P2).
**Repo:** be_game.
**Mục tiêu:** Tối ưu chi phí serialize đã đo, không thay mô hình state hoặc CAS.
**Lý do:** Hub stringify `after` rồi Redis store stringify state lại (`be_game:src/server/hub.ts:150-163`, `be_game:src/server/store.ts:249-262`); `RoomStore.save` là contract hiện hữu (`be_game:src/server/store.ts:28-42`). Chưa có số đo state byte/latency production.
**File ảnh hưởng:** `src/server/hub.ts`, `src/server/store.ts`, `test/hub.test.ts`, `test/store-redis.integration.test.ts` (mới ở T04); `test/serialization.test.ts` và `scripts/bench-serialization.ts` (mới, sẽ thêm), `docs/GUIDE.md`.
**Các bước:**

- [ ] Lấy baseline T05 theo game/tải/room age, fixture JSON tổng hợp có log/chat, UTF-8; không bịa số byte từ số dòng code hoặc dùng dữ liệu người chơi chưa làm sạch.
- [ ] Benchmark parse/stringify riêng và end-to-end mutation trên cùng fixture/Node, warmup rồi ít nhất 30 lượt đo, ghi p50/p95/sample count/GC caveat. Nếu không phải bottleneck hoặc lợi ích dưới nhiễu, kết thúc bằng báo cáo số đo, không đổi code lưu.
- [ ] Chỉ khi số đo chứng minh lợi ích và chủ repo duyệt tối ưu: thêm đường nội bộ truyền JSON đã tính vào Redis save, giữ `save(state,version)` cho caller cũ; kiểm tra JSON tương ứng đúng draft/code/version, không đổi script/key/TTL/pubsub.
- [ ] Chạy test no-op/discard/stale cache/CAS collision/phòng cũ và Redis thật; so benchmark trước/sau cùng tải, dừng tối ưu nếu không cải thiện hoặc làm xấu p95.

**Test cần thêm:** Rejected command không lưu draft dù có thay đổi tạm, cached no-op vẫn fresh-check, retry dùng draft/version mới, serialized JSON đúng state, UTF-8 byte count, save cũ/mới cùng kết quả.
**Tiêu chí hoàn thành (đo được):** Có báo cáo baseline và kết luận làm/không làm; nếu tối ưu, giảm một stringify trên mỗi save Redis thành công ở đường mới và không hồi quy p95 quá 5% (ngưỡng đề xuất cần review); CAS/TTL/index/pubsub không đổi qua integration.
**Rủi ro và rollback:** JSON cũ được gắn với version mới gây mất dữ liệu. Đường mới nội bộ và test tranh chấp; tắt/revert đường tối ưu, giữ `save` cũ; không chuyển delta/partial write trong task.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** T04/T05; approval cho tối ưu sau báo cáo, không coi khuyến nghị serialize là lựa chọn đã chốt.

### T21 — Migration chạy lại an toàn và diễn tập shared-store trước mọi cutover

**ID:** T21 (BE-8, P1).
**Repo:** be_game; zonenop-game tham gia test reconnect/failover.
**Mục tiêu:** Hoàn thiện điều kiện diễn tập, không tự chuyển production sang Upstash; tránh cộng đôi leaderboard khi retry migration lỗi giữa chừng.
**Lý do:** Migration cộng từng player nhưng marker cuối toàn bộ run (`be_game:src/tools/migrate-store.ts:21-36`, `be_game:src/tools/migrate-store.ts:83-101`); tài liệu yêu cầu drill/đo quota/commit/clock trước chuyển (`be_game:docs/SELF_HOSTING.md:178-186`), hai kho riêng theo tài liệu deployment (`be_game:docs/DEPLOYMENT.md:13-15`).
**File ảnh hưởng:** `src/tools/migrate-store.ts`, `test/migrate-store.test.ts`, Redis integration file T04; `docs/SELF_HOSTING.md`, `docs/DEPLOYMENT.md`, `docs/superpowers/plans/2026-10-15-shared-store-failover.md` trong PR thực thi sau này; FE `gameClient.test.ts`/E2E khi bổ sung failover. Không sửa các file này trong phiên soạn plan hiện tại.
**Các bước:**

- [ ] Viết test lỗi sau player/game đầu rồi retry: tổng points/games/wins không bị cộng hai lần; test marker cũ, dry-run không ghi, cùng source/destination bị từ chối, TTL/room collision, lỗi trong transaction.
- [ ] Thiết kế checkpoint theo migration/source/game/player, gắn thao tác cộng và marker nguyên tử, kiểm tra trước mọi write; không chỉ thêm checkpoint sau `multi.exec()` vì crash giữa cộng và checkpoint vẫn có thể nhân đôi. Tôn trọng marker hoàn tất cũ, hạn chế `--force`, ghi rõ giới hạn khi dữ liệu nguồn tiếp tục thay đổi.
- [ ] Diễn tập trên hai backend và Redis thử riêng, nguồn được quiesce/snapshot trong cửa sổ migration, không trộn ghi mới vào nguồn/đích; dry-run rồi migration thật với dữ liệu giả; ngắt sau từng checkpoint rồi resume, so tổng và TTL.
- [ ] Sau chủ repo duyệt drill: hai backend cùng kho thử, cùng commit/clock; mở ván, ngắt một backend, xác nhận client vào đúng phòng/state/ghế và thao tác tiếp ≤15 giây; test cả chiều primary→backup và phục hồi, pin/not-found với kho riêng. Mốc 15 giây là tiêu chí cần đo, chưa phải kết quả.
- [ ] Đo lệnh Redis 24–48 giờ trước cutover, so dashboard/quota và overhead deep health; `sharedStore:true` không đủ, xác minh bằng thao tác cùng phòng/nonce dữ liệu thử trên hai backend, không in URL có mật khẩu.
- [ ] Trình biên bản drill, backup/checksum/restore, room collision và rollback cho chủ repo. Chỉ lập lịch cutover nếu được đồng ý riêng; dừng ở trạng thái “sẵn sàng, chưa cutover” nếu chưa có approval.

**Test cần thêm:** Redis thật crash/retry/marker atomic, room TTL và collision, dry-run không ghi, source thay đổi bị phát hiện hoặc bị chặn bằng quy trình quiesce; hai hub pub/sub; phiên account đi theo backend; disconnect/rejoin giữ đúng hand/private view.
**Tiêu chí hoàn thành (đo được):** Retry sau lỗi không nhân đôi tổng; drill có timestamp/SHA/duration và state checksum, ≤15 giây hoặc ghi fail; cùng store được chứng minh bằng dữ liệu, clock lệch ≤2 giây; bảng điều kiện quota/backup/restore đủ, production chưa bị đổi nếu chưa duyệt.
**Rủi ro và rollback:** Kho chung thành điểm lỗi chung, quota tăng, migration partial, rollback về local có thể mất cập nhật mới. Freeze writers, snapshot trước và sau, đối chiếu dữ liệu/điểm trước quyết định restore; không chuyển qua lại URL mù hoặc ghi đè kho đích. Revert code không tự sửa số liệu đã cộng sai.
**Ước lượng (S/M/L):** L, cộng thời gian quan sát 24–48 giờ.
**Phụ thuộc:** T04/T05/T06/T07/T11; quyền vận hành và phê duyệt riêng chủ repo cho drill/cutover; nếu chưa có môi trường thử/Upstash thì đánh dấu chưa kiểm chứng, không giả lập thành bằng chứng production.

### T22 — Tách file luật BE theo ranh giới hẹp, từng game một

**ID:** T22 (BE-6, P2).
**Repo:** be_game.
**Mục tiêu:** Giảm chi phí review file luật lớn mà không đổi state machine/export/luật.
**Lý do:** Bang game/actions 1.372/1.360 dòng, TyPhu game 1.224, Meo game 1.122, đã đo cuối file tại `be_game:src/bang/game.ts:1369-1372`, `be_game:src/bang/actions.ts:1357-1360`, `be_game:src/typhu/game.ts:1221-1224`, `be_game:src/meono/game.ts:1119-1122`; quy tắc thuần tại `be_game:CLAUDE.md:65-71`.
**File ảnh hưởng:** `src/bang/game.ts`, `src/bang/actions.ts`, `src/typhu/game.ts`, `src/meono/game.ts`; `src/bang/game-types.ts`, `src/bang/action-types.ts`, `src/typhu/game-types.ts`, `src/meono/game-types.ts` (mới, sẽ thêm cho type/constant thuần không I/O); test luật/fuzz hiện có theo game. Module helper bổ sung chỉ sau review ranh giới cụ thể, không đặt generic engine mới.
**Các bước:**

- [ ] Lập dependency/export map và test characterization bằng now/RNG seed cố định; đo coverage các nhánh sẽ chuyển, chọn nhóm type/constants độc lập trước để không tạo import cycle.
- [ ] Mỗi PR chỉ một game hoặc Bang actions riêng: di chuyển type/constants độc lập sang file đề xuất, re-export từ đường cũ; nhóm logic tiếp theo chỉ tách khi có trách nhiệm rõ và test pin output. Không tách chỉ để đạt hạn mức dòng.
- [ ] Giữ now/random truyền xuống, JSON round-trip, optional/default phòng cũ và rejected-command invariant; không đổi wire/state hoặc thay behaviour để khớp refactor.
- [ ] Chạy `npm run typecheck`, `npm test` gồm test luật/fuzz hiện hữu, Redis integration mới và contract khi type public bị di chuyển; so state/result với fixtures baseline trước/sau cùng seed.

**Test cần thêm:** Chỉ thêm characterization cho nhánh chuyển chưa được pin; JSON round-trip/state cũ, rejected command không đổi state, timer deadline và RNG theo seed không đổi; export facade vẫn import được.
**Tiêu chí hoàn thành (đo được):** Cùng now/seed/command sequence cho state/result giống baseline; không import cycle runtime; 0 thay đổi wire/state; từng PR có diff chủ yếu di chuyển và tất cả check xanh.
**Rủi ro và rollback:** Cycle do type/runtime import hoặc mất export. Dùng type-only import khi phù hợp, giữ facade, revert từng game PR; không đổi module target BE.
**Ước lượng (S/M/L):** L cho chuỗi PR, M mỗi game.
**Phụ thuộc:** T04/T06/T19 ổn định; ưu tiên sau các P0/P1, chủ repo duyệt ranh giới mỗi PR; không bắt buộc refactor lớn để giải quyết bảo mật. Rebase/kiểm xung đột với hai nhánh BE ở §2 theo thứ tự chủ repo quyết định, đặc biệt nhánh đấu giá sửa `src/typhu/game.ts`/`protocol.ts`/`room.ts` (`8858fd8`, `8fd9dfb`; diff stat §8); không để T22 làm mất luật hoặc export của nhánh tính năng.

### T23 — Asset budget, a11y trình duyệt và baseline hiệu năng

**ID:** T23 (FE-6, P2).
**Repo:** zonenop-game.
**Mục tiêu:** Đo lượng tải/hiệu năng và khả năng dùng bàn phím thật, chỉ tối ưu asset có bằng chứng.
**Lý do:** Metadata hiện 286 file/8.645.264 byte (§8); ESLint đã có static a11y warn nhưng không thay đo DOM/CWV (`zonenop-game:eslint.config.mjs:1-7`, `zonenop-game:node_modules/eslint-config-next/dist/index.js:173-188`, `zonenop-game:.github/workflows/ci.yml:32-42`).
**File ảnh hưởng:** FE `package.json`, `package-lock.json`, `.github/workflows/ci.yml`; `scripts/check-assets.mjs`, `e2e/accessibility.spec.ts`, `lighthouserc.cjs`, `docs/performance-baseline.md` (mới, sẽ thêm); `public/games/` chỉ file được đo là cần tối ưu, không đổi URL; UI liên quan chỉ sửa lỗi a11y được test chứng minh.
**Các bước:**

- [ ] Đo baseline asset theo file/game và network thực từng route; ghi tổng disk bytes khác transfer/load bytes. Thêm `npm run check:assets` (mới, sẽ thêm), ban đầu cảnh báo tăng so baseline rồi chủ repo duyệt budget chặn.
- [ ] Thêm Playwright + `@axe-core/playwright` (dependency mới, sẽ thêm) trên hub/login/lobby/dialog/bàn/admin fixture; `npm run test:a11y` (mới, sẽ thêm). Test focus trap/restore, keyboard navigation, accessible name, contrast/reduced-motion ngoài axe.
- [ ] Thêm Lighthouse CI bằng `@lhci/cli` và `npm run test:performance` (mới, sẽ thêm) trên server production local trong CI, cấu hình/tải cố định, ít nhất 3 lượt/route lấy median. `browser-quality` là job mới sẽ thêm vào `CI`, không bịa workflow sẵn có.
- [ ] Lập budget LCP/CLS/TBT/transfer đề xuất từ baseline, phân biệt lab TBT với field INP; số liệu CWV người dùng thực chỉ thu nếu chủ repo đồng ý telemetry riêng, không đưa user/room code vào labels.
- [ ] Chỉ recompress/lazy-load asset đo được là cần, giữ hình/chữ lá bài rõ trên PC/mobile và URL cũ; tách PR sửa a11y khỏi PR tối ưu ảnh để rollback dễ. Chạy bốn check FE và browser suites mới.

**Test cần thêm:** 0 axe serious/critical trên route đại diện hoặc exception cụ thể được review; keyboard/focus dialog, theme contrast, reduced-motion; asset manifest phát hiện tăng; hiệu năng benchmark lặp cùng cấu hình.
**Tiêu chí hoàn thành (đo được):** Có baseline 3 lượt/route, byte disk/transfer tách riêng, 0 vi phạm serious/critical chưa được duyệt; budget chặn chỉ sau owner duyệt; ảnh đổi có visual comparison và không tăng request route khác.
**Rủi ro và rollback:** Tối ưu ảnh làm mờ chữ, Lighthouse nhiễu, axe xanh nhưng keyboard vẫn lỗi. Giữ ảnh gốc trong lịch sử PR, rollback theo asset; cảnh báo performance trước khi gate cứng; manual keyboard check vẫn bắt buộc.
**Ước lượng (S/M/L):** M.
**Phụ thuộc:** T11; dùng UI ổn định sau PR bàn liên quan; budget/telemetry mới cần chủ repo duyệt, không tự chọn dịch vụ ngoài.

## 5. Cách chia PR và thứ tự merge theo quy ước từng repo

Tên nhánh dưới đây là **đề xuất chưa tạo**. Không dùng worktree FE đang kiểm tra làm base tính năng; tạo nhánh từ `develop` sau khi chủ repo duyệt thực thi. BE từ `main`, PR vào `main` (`be_game:CLAUDE.md:102`); FE từ `develop`, PR vào `develop`, release `develop` → `main` là quyết định riêng (`zonenop-game:CLAUDE.md:148-158`). Mọi merge ở cả hai repo cần chủ repo đồng ý rõ ràng; CI xanh không phải quyền tự merge.

Tên nhánh FE dùng các tiền tố được phép tại `zonenop-game:CLAUDE.md:150-151`. Với BE, bảng chọn `feature/`, `fix/`, `chore/`, `ci/` theo các tiền tố đã thấy qua `git -C D:/WorkSpace/be_game branch -a` tại HEAD `99ecea8` (§8); đây là lựa chọn nhất quán cho plan, không khẳng định repo có quy định cấm mọi tiền tố khác.

**Phụ thuộc phát hành ngoài plan:** FE `develop` đã có UI đấu giá (PR #92, `de658f8`) và Nối Chữ trong registry (§2). Release `develop` → `main` chỉ được bật đầy đủ đấu giá/Nối Chữ sau khi **cả hai nhánh BE `origin/feature/typhu-auction` và `origin/feature/noi-chu` được chủ repo merge qua PR riêng và deploy lên CẢ HAI backend**, kiểm SHA/health và capability; nếu chưa đủ thì FE phải giữ guard capability T06 cho từng backend/tính năng chưa hỗ trợ. Thứ tự merge hai nhánh so với hardening **đang mở, chủ repo quyết định**; mọi PR hardening BE nên rebase/kiểm xung đột với cả hai nhánh trước merge, đặc biệt T06/T22 chạm `src/typhu/*` (bằng chứng thay đổi nhánh: `8858fd8`, `8fd9dfb`, `2db0ba5`; diff stat §8). Không gộp việc merge hai nhánh vào các PR hardening dưới đây.

Các gate được dùng trong bảng PR:

- **B:** BE `npm run typecheck`, `npm test`, toàn bộ workflow `CI` tại `.github/workflows/ci.yml` phải xanh, gồm job `test` và `docker` hiện hữu (`be_game:package.json:9-14`, `be_game:.github/workflows/ci.yml:15-54`). Sau T04, thêm job `redis-integration` và `npm run test:redis` (đều mới, sẽ thêm); lint/format/CodeQL mới chỉ thành gate sau PR tooling được duyệt. Không ghi BE có `npm run lint` trước T04 tooling.
- **F:** FE `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, workflow `CI` tại `.github/workflows/ci.yml` phải xanh (`zonenop-game:package.json:5-14`, `zonenop-game:.github/workflows/ci.yml:16-42`). Sau T11, thêm component suite/`browser-smoke` (mới, sẽ thêm); sau T23 thêm browser-quality/budget được duyệt (mới, sẽ thêm).
- **C:** Contract fixtures cũ/mới và BE/FE SHA đối ứng đã pin; `npm run test:contract` (mới, sẽ thêm theo D4) phải xanh nếu PR đụng hợp đồng.
- **U:** Component suite `npm run test:components`, E2E `npm run test:e2e` (đều mới, sẽ thêm ở T11), screenshot desktop/mobile, keyboard/focus và reconnect của bàn liên quan. Mỗi PR refactor không đổi hành vi; không dùng snapshot cập nhật hàng loạt để che regression.
- **O:** Chủ repo review biên bản/tác động vận hành và đồng ý riêng cho deploy/drill/cutover. Primary/backup cùng commit, allowlist/config đã có, không có state migration chưa kiểm chứng.

| Thứ tự merge đề xuất | Repo / nhánh đề xuất | Base → PR target | Phạm vi PR | Gate trước merge |
|---|---|---|---|---|
| 1 | BE `fix/admin-bootstrap-policy` | `main` → `main` | T01, sau D1 | B, O; không chờ refactor/tooling mới để sửa P0 |
| 2 | BE `fix/login-rate-limit` | `main` → `main` | T02; proxy thay đổi có bằng chứng | B; regression A→B, review topology |
| 3 | BE `fix/production-origin-policy` | `main` → `main` | T03, sau D2 và env rollout | B, O; allowlist hai host |
| 4 | BE `ci/redis-cas-integration` | `main` → `main` | T04 phần Redis/config Vitest | B + Redis job mới chạy thật |
| 5 | BE `chore/quality-security-checks` | `main` → `main` | T04 lint/format/Dependabot/CodeQL | B + check mới đã baseline/exception, không format toàn repo |
| 6 | BE `chore/structured-observability` | `main` → `main` | T05 | B + redaction/overhead |
| 7 | BE `fix/protocol-contract-boundaries` | `main` → `main` | T06/T07 phần BE, sau D4 | B, C, O; old-client fixtures |
| Chuẩn bị sớm, release sau BE cần thiết | FE `fix/deploy-shell-env` | `develop` → `develop` | T08 | F + shell fixture; mọi merge vẫn cần owner yes |
| Chuẩn bị sớm | FE `chore/component-browser-smoke` | `develop` → `develop` | T11, có thể tách DOM và E2E thành hai PR nếu review riêng | F + U, BE pin local |
| Sau BE protocol đã lên cả hai host | FE `fix/protocol-contract-client` | `develop` → `develop` | T06/T07 phần FE, guard Nối Chữ/auction | F, C, U |
| Sau harness | FE `fix/security-headers-report-only` | `develop` → `develop` | T09 giai đoạn report; enforce PR riêng `fix/security-headers-enforce` sau quan sát | F, U, O cho enforce |
| Sau D1/D3 và BE tương ứng | BE `feature/session-cookie-compat` nếu cần; FE `fix/auth-session-lifecycle` | BE `main` → `main`; FE `develop` → `develop` | T10; nếu D3-a chỉ FE/lifecycle tests, nếu b/c tách backend additive và FE chuyển tiếp | B/F theo repo, C, U, O; BE trước FE |
| Tiếp theo từng bàn | FE `refactor/tienlen-table` | `develop` → `develop` | T12 | F, U, D5 |
| Sau T12 | FE `refactor/splendor-table` | `develop` → `develop` | T13 | F, U, D5 |
| Tiếp theo | FE `refactor/oanquan-table` | `develop` → `develop` | T14 | F, U, D5 |
| Sau hợp đồng card ẩn | FE `refactor/meono-table` | `develop` → `develop` | T15 | F, C, U, D5 |
| Tiếp theo | FE `refactor/bang-table` | `develop` → `develop` | T16 | F, U, D5 |
| Sau ít nhất một bàn mẫu ổn định | FE `refactor/contra-modules` | `develop` → `develop` | T17 | F, U, simulation benchmark, D5 |
| Sau bàn tương ứng | FE `refactor/game-effects-dependencies` | `develop` → `develop` | T18, có thể chia PR theo effect family | F, U, suppression inventory |
| Sau boundary fixes | BE `chore/account-boundary-types`, `chore/redis-counter-types` | `main` → `main` | T19, hai PR độc lập | B, C nếu chạm transport |
| Sau số đo T05 | BE `feature/reuse-serialized-room` nếu đáng làm | `main` → `main` | T20, chỉ khi số đo/approval cho phép | B, C, benchmark + Redis CAS |
| Trước mọi cutover | BE `fix/migration-resume-safety` | `main` → `main` | T21 code/test/runbook; drill là hoạt động riêng | B + Redis failure injection, O |
| Sau P0/P1 | BE `chore/bang-game-types`, `chore/bang-action-types`, `chore/typhu-game-types`, `chore/meono-game-types` | `main` → `main` | T22, mỗi nhánh/PR chỉ nhóm tương ứng | B, C, luật/fuzz cùng seed |
| Sau harness / UI ổn định | FE `chore/browser-quality-budgets` | `develop` → `develop` | T23 baseline/a11y/performance; tối ưu ảnh PR riêng khi có số đo | F, U + browser-quality mới, budget được duyệt |
| Mỗi đợt release được owner chọn | FE `develop` | `main` ← `develop` | Chỉ release những PR đã duyệt; đấu giá/Nối Chữ theo phụ thuộc ngoài plan ở trên | F, C, U, O + owner yes riêng; hai nhánh BE đã merge/deploy cả hai host hoặc guard capability T06 còn hiệu lực |

Không bắt owner phê duyệt đồng thời cả chuỗi: từng PR có bằng chứng, test, quyết định liên quan và rollback riêng. Sau merge BE (kể cả hai nhánh tính năng ngoài plan), chờ workflow `Deploy` và Vercel đúng SHA rồi mới bật phần FE phụ thuộc; nếu chưa hỗ trợ đủ thì chỉ release với guard capability T06 đã kiểm; workflow Deploy hiện gắn CI/main ở cả hai repo (`be_game:.github/workflows/deploy.yml:8-28`, `zonenop-game:.github/workflows/deploy.yml:8-28`). Trigger production Vercel FE là việc chủ repo quyết định (`be_game:CLAUDE.md:94`); không tự thao tác dashboard.

## 6. Thứ tự triển khai liên repo và tương thích ngược

1. **Chuẩn bị:** Owner chốt D1–D5 cần cho đợt đầu và thứ tự merge hai nhánh BE đấu giá/Nối Chữ (§2) so với hardening; việc merge chúng là PR/quyết định riêng ngoài plan. Rebase/kiểm xung đột các PR hardening BE với cả hai nhánh, đặc biệt T06/T22 chạm `src/typhu/*`; review env/host copy và SHA đối ứng; không đụng secret giá trị. Trước deploy BE phải đối chiếu thay đổi chủ máy trên server với repo, vì tài liệu có cảnh báo chỉnh trực tiếp (`be_game:CLAUDE.md:92-93`). Không thực hiện đối chiếu server trong phiên plan này.
2. **BE trước:** Merge từng PR BE được duyệt vào `main`, đợi CI và Deploy; xác minh cả `play-api.fudio101.com` và `be-game-omega.vercel.app` báo đúng commit/health. Primary chờ CI nhưng Vercel Git vẫn có thể triển khai độc lập nên nếu primary đỏ hoặc SHA khác phải dừng FE (`be_game:CLAUDE.md:88-91`, `be_game:docs/DEPLOYMENT.md:93-105`).
3. **Kiểm thử client cũ:** Bundle FE đã phát hành và tab đang mở vẫn join/watch/reconnect, auth/session hợp lệ; phòng Redis cũ thiếu optional vẫn đọc được. D1 chỉ áp policy đặt mới, không đổi verify hash cũ. Origin allowlist chứa cả hai frontend được duyệt trước enforcement; không dựa vào wildcard toàn Vercel.
4. **FE:** PR tính năng vào `develop`; release `develop` → `main` có đấu giá/Nối Chữ chỉ bật đầy đủ sau khi `origin/feature/typhu-auction` và `origin/feature/noi-chu` đã được chủ repo merge qua PR riêng, deploy và kiểm SHA/health/capability trên **CẢ HAI backend** (`be_game:docs/DEPLOYMENT.md:96-105`; bằng chứng nhánh/FE ở §2). Nếu chưa đủ thì release chỉ khi FE giữ guard capability T06 cho từng tính năng/backend chưa hỗ trợ; không lấy việc đã merge UI vào `develop` làm bằng chứng BE đã phát hành. Owner đồng ý release riêng; smoke cả `play.fudio101.com` và `zonenop-game.vercel.app`, từng frontend kết nối primary lẫn backup trong môi trường thử và xác minh production sau release được duyệt.
5. **Hợp đồng additive:** Field mới server nhận phải optional; field mới client nhận cũng optional/default; không rename/remove/bắt buộc field trong một đợt (`be_game:docs/DEPLOYMENT.md:91-97`). Sửa `signedOut`, `hidden` và union đang thiếu là mô tả wire đang chạy, không thêm luật mới. Auction/Nối Chữ giữ capability guard; không bật game/phase mới dựa trên type FE đơn thuần (bằng chứng §2).
6. **Session nếu chọn cookie:** BE hỗ trợ song song trước; FE/bản Vercel bật sau ma trận browser/host, giữ cửa sổ Bearer như D3; field hoặc route auth mới chỉ thêm, không bỏ token/session path cũ trong kế hoạch này. BFF/cookie không được làm mất fallback hoặc coi third-party cookie chắc chắn hoạt động.
7. **Failover:** Trước kho chung, phòng pin vào backend, không tìm thấy ở pinned backend là final; unreachable mới thử backend còn lại theo tài liệu (`zonenop-game:CLAUDE.md:9-11`). Không hứa resume ván trên backup khi kho vẫn riêng. Sau T21 drill/approval mới cân nhắc cutover; `sharedStore` heuristic không thay kiểm chứng cùng dữ liệu (`be_game:src/server/app.ts:102-103`).
8. **CSP/hiệu năng:** Report-Only trước, quan sát rồi PR enforce riêng; refactor mỗi bàn có khoảng quan sát trước bàn tiếp theo. Budget performance/a11y mới bắt đầu báo cáo, nâng gate sau owner duyệt.

| Ma trận tối thiểu trước release | Điều phải chứng minh |
|---|---|
| BE mới + FE cũ, cả primary/backup | Đăng nhập cũ, join/watch, thao tác đúng/sai, heartbeat/reconnect, optional defaults không hỏng |
| BE mới + FE mới, hai frontend × hai backend | Đăng ký/tạo/vào, logout/replace/revoke, theme/CSP, HTTP/WS, storage/cookie theo D3 |
| BE `main` `99ecea8` hoặc phiên bản trước + FE mới | Không crash khi thiếu optional; guard T06 không cho bật đấu giá/gửi bid/fold hoặc chơi Nối Chữ khi backend thiếu capability (§2); auth không bị hạ yêu cầu để “tương thích” |
| BE đã merge cả hai nhánh đấu giá/Nối Chữ + FE `develop` chuẩn bị release | Cả hai backend có SHA tích hợp đã duyệt, health/capability đúng; test đấu giá và Nối Chữ trên hai frontend × hai backend trước bật đầy đủ (§2, §5; `be_game:docs/DEPLOYMENT.md:96-105`) |
| Hai backend lệch hỗ trợ đấu giá/Nối Chữ hoặc mới merge một nhánh | Dừng bật đầy đủ; chỉ release khi guard T06 chặn đúng từng capability thiếu trên backend đang kết nối, kể cả fallback; lỗi mạng không bị suy thành thiếu capability |
| Kho riêng + primary unreachable/not-found | Phân biệt lỗi mạng với phòng thiếu; giữ pin, không hứa dữ liệu tồn tại trên kho kia |
| Kho thử chung + hai backend cùng SHA | Pub/sub/state/ghế đúng, failover ≤15 giây là tiêu chí cần đạt và ghi số đo |
| Browser chặn third-party cookie | D3-a còn chạy; D3-b/c phải có nhánh backup được chứng minh trước bật |

Rollback theo PR và theo lớp: FE lỗi UI/CSP → rollback FE/enforce trước; BE lỗi API → dừng release FE, giữ BE additive hoặc revert tương thích được cả FE cũ/mới; migration/shared store phải theo biên bản dữ liệu, không chỉ revert code. State sống qua deploy, TTL 12 giờ (`be_game:src/server/store.ts:50-51`); revert không tự xoá state mới hoặc sửa leaderboard đã ghi.

## 7. Rủi ro tổng thể và theo dõi sau triển khai

Các ngưỡng dưới đây là **đề xuất cảnh báo cần owner duyệt**, chưa phải SLO production đã có. Lấy baseline trước release, ghi SHA/giờ bắt đầu/khoảng mẫu; mỗi đợt có người chịu trách nhiệm theo dõi và quyết định rollback. Không log dữ liệu cá nhân/raw payload chỉ để tạo dashboard.

| Rủi ro | Theo dõi/tiêu chí dừng đề xuất | Phản ứng/rollback |
|---|---|---|
| Admin bị cấp nhầm hoặc không đăng nhập quản trị | Event cấp quyền theo cơ chế D1, 0 public register tự cấp admin; kiểm tài khoản test và owner admin đã xác minh | Dừng release; đóng bootstrap/register liên quan; xử lý quyền/thu hồi phiên do owner duyệt, không tự sửa user production |
| Siết policy/limiter làm auth lỗi | Tỷ lệ 401/429/503 theo endpoint, không theo username/IP; nếu tăng >2 lần baseline trong 15 phút và đủ mẫu thì điều tra | Kiểm env/proxy/policy, rollback cấu hình riêng đã kiểm chứng; không mở lại admin takeover |
| Origin/CSP/cookie làm mất kết nối | WS upgrade failures, join/reconnect success, auth HTTP, CSP reports trên cả primary/Vercel; smoke cả bốn cặp host | Sửa exact allowlist; về Report-Only nếu enforce lỗi; rollback mode cookie/FE, giữ Bearer cũ |
| Thứ tự merge nhánh tính năng chưa chốt / FE phát hành trước BE | Chủ repo quyết định thứ tự hai PR BE đấu giá/Nối Chữ so với hardening; kiểm SHA/capability cả hai host, xung đột T06/T22 với `src/typhu/*` (`8858fd8`, `8fd9dfb`, `2db0ba5`; §2/§8) | Giữ quyết định mở; rebase/kiểm lại contract sau tích hợp; dừng bật đầy đủ hoặc giữ guard T06 đến khi cả hai nhánh đã merge/deploy cả hai backend |
| Validator từ chối payload hợp lệ | Counter parse/envelope/view reject hữu hạn theo game/type, synthetic fixtures cũ/mới; bất kỳ valid fixture fail đều chặn release | Tắt validator view mới nếu cần, giữ null/envelope/auth; thêm fixture thật đã làm sạch và sửa schema |
| CAS/serialize làm mất cập nhật hoặc chậm | p50/p95/p99 mutation và CAS attempts; p95 tăng >20% cùng tải trong 15 phút hoặc conflict tăng rõ phải điều tra | Dừng tối ưu, trả save path cũ; kiểm Redis/churn trước mở rộng thay đổi |
| Shared store/health dùng quá quota | Lệnh process chỉ là cận dưới, dashboard Upstash là nguồn đối chiếu; dự báo gần quota hoặc latency store tăng thì dừng cutover | Giữ local trước chuyển; sau chuyển dùng runbook freeze/snapshot/restore đã duyệt, không đổi URL mù |
| Deep health sinh dữ liệu/lệnh | Probe hiện create/load/subscribe/save phòng thật (`be_game:src/server/app.ts:184-205`), dùng probe `/api` nhẹ cho polling thường; deep health theo lịch hữu hạn | Không tăng tần suất deep probe; đề xuất coalesce/cache hoặc TTL riêng chỉ qua PR có test, giữ response deploy tương thích |
| Refactor phát FX lặp/rò timer/sai selection | JS errors, synthetic action assertions, listener/RAF counts, screenshot PC/mobile và phản hồi người chơi sau mỗi bàn | Rollback PR bàn/effect vừa phát hành, không gộp nhiều bàn làm khó khoanh vùng |
| Workflow secrets rò hoặc deploy bản sai | 0 secret trong fixture/log review, exact commit trên health; CI/deploy primary và Vercel cùng SHA | Dừng deploy, owner xử lý rotation nếu có lộ; không in secrets để debug |
| Test xanh giả/CI flake | Redis/browser job không skip, intentional failure có làm đỏ; fail rate/trace, SHA repo đối ứng hiển thị | Sửa harness, không tăng retries vô hạn hoặc bỏ gate để merge |

Nhịp theo dõi đề xuất: 0–30 phút sau mỗi deploy kiểm health/SHA/auth/join/reconnect/CSP; 24 giờ kiểm lỗi/tải/bốn cặp host; 24–48 giờ thu Redis baseline trước cutover; tối thiểu 7 ngày Report-Only trước đề xuất enforce CSP. Dùng synthetic account/room được owner cho phép và dọn theo namespace test; không mở phòng thử trên preview trỏ production Redis. Cảnh báo preview dùng chung kho đã ghi tại `be_game:docs/DEPLOYMENT.md:135-138`.

## 8. Phụ lục: những gì đã và chưa kiểm tra được

### Nguồn đã đọc và giới hạn bằng chứng

- Đã đọc 5 báo cáo ở `C:/Users/thach/AppData/Local/Temp/claude/6d6fbafcae993889/91b20ca3-2df5-47d8-80fa-32677f781a31/scratchpad/plan-work/result-A.md`, `result-B.md`, `result-C.md`, `result-D.md`, `result-E.md`; phần findings dùng để định hướng, citations trong plan được mở/đếm lại trên source hiện tại.
- BE root `D:/WorkSpace/be_game`; FE root `D:/WorkSpace/zonenop-game/.claude/worktrees/review-3-open-prs-0d4678`. Đã đọc `CLAUDE.md` hai repo, `AGENTS.md` FE, `docs/DEPLOYMENT.md` BE, vùng `docs/SELF_HOSTING.md` liên quan, rule docs và plan mẫu `docs/superpowers/plans/2026-10-16-accounts-admin.md`. Không tìm thấy `AGENTS.md` BE qua kiểm kê đã chạy, không khẳng định file ngoài phạm vi đọc không tồn tại.
- Đã đối chiếu scripts/workflows, các điểm auth/Origin/rate-limit/CAS/mutate/health/migration, 16 cặp protocol/data, component boundaries, test config/dependency, exhaustive-deps và static a11y preset; đã đo dòng bao gồm dòng trống bằng `.Count`, không dùng `Measure-Object -Line` để suy line citation.
- Không chạy npm, test/lint/typecheck/build, audit, Docker/Redis/HTTP/WS, browser, migration, benchmark hoặc deploy. Vì vậy không khẳng định suite xanh, payload malformed đã tái hiện, trạng thái production, quota, CWV, accessibility thực tế, header ngoài proxy hoặc cutover đã xảy ra.
- Không đọc `.env`/credentials thật hoặc admin production, không xác minh peer headers qua hạ tầng, không kiểm GitHub dashboard Security/branch protection/secrets, không kiểm khác biệt server tự host với repo. Hướng dẫn repo là bằng chứng quy ước, không phải bằng chứng trạng thái live.
- Git BE đầu phiên soạn ban đầu không có diff/untracked qua các lệnh đã chạy. Đầu lượt sửa E1–E3, chỉ plan này đang untracked ở BE; FE vẫn có file untracked `.claude/settings.local.json` sẵn có (đã kiểm `status --short --untracked-files=all`); không đọc/sửa/xoá file đó. Chỉ file plan này được ghi trong lượt sửa.
- Lượt sửa E1–E3 đã kiểm thêm commit mật khẩu `dd8743a`, BE HEAD/`main` `99ecea8`, tip hai nhánh BE chưa merge `8fd9dfb`/`40b7547`, cây `src/noichu`, protocol đấu giá và FE HEAD = `develop` `e462ff2`, merge PR #92 `de658f8`. Đây là refs cục bộ đã đọc, không fetch, không xác nhận remote mới nhất hoặc production; không chạy contract/runtime test cho hai nhánh.

### Kiểm kê phụ trợ có dẫn chứng

9 dòng/12 kiểu `any`: `be_game:src/accounts/store.ts:78` (1), `be_game:src/accounts/service.ts:313` (1), `be_game:src/accounts/pg.ts:7` (1), `be_game:src/accounts/pg.ts:221-224` (2 ở dòng 221/224), `be_game:src/accounts/migrations.ts:59` (1), `be_game:src/server/store.ts:357-360` (3 ở dòng 357/360), `be_game:src/server/authRoutes.ts:195` (3). Những chữ `any` trong string/comment không tính.

21 disable exhaustive-deps, đều là kết quả quét hiện tại, không tự chứng minh lỗi runtime:

| Nhóm | Vị trí |
|---|---|
| Contra | `zonenop-game:src/components/game/ContraGame.tsx:709-710` |
| Cá Ngựa | `zonenop-game:src/components/cangua/Board.tsx:86`; `zonenop-game:src/components/cangua/Board.tsx:347` |
| Mèo Nổ | `zonenop-game:src/components/meono/MeoTable.tsx:216`; `zonenop-game:src/components/meono/MeoTable.tsx:390`; `zonenop-game:src/components/meono/MeoTable.tsx:1295` |
| Bang! | `zonenop-game:src/components/bang/BangTable.tsx:592` |
| TyPhu table | `zonenop-game:src/components/typhu/TyPhuTable.tsx:250`; `zonenop-game:src/components/typhu/TyPhuTable.tsx:275`; `zonenop-game:src/components/typhu/TyPhuTable.tsx:285`; `zonenop-game:src/components/typhu/TyPhuTable.tsx:304` |
| Shared games | `zonenop-game:src/components/games/TurnIndicator.tsx:55`; `zonenop-game:src/components/games/ChatBox.tsx:54` |
| TyPhu modules | `zonenop-game:src/components/typhu/board/walk.ts:60`; `zonenop-game:src/components/typhu/fx/MoneyFx.tsx:97`; `zonenop-game:src/components/typhu/board/Cell.tsx:56`; `zonenop-game:src/components/typhu/board/Cell.tsx:114`; `zonenop-game:src/components/typhu/fx/TurnBanner.tsx:47` |
| Tiến Lên | `zonenop-game:src/components/tienlen/Effects.tsx:43`; `zonenop-game:src/components/tienlen/Effects.tsx:129`; `zonenop-game:src/components/tienlen/TienLenTable.tsx:164` |

Assets là file nhị phân nên không bịa `file:dòng`: bằng chứng metadata `Count=286`, `Sum Length=8645264`, lệnh đo dưới đây. Test inventory trả 26 `.test.ts`, không có `.test.tsx`/`.spec.tsx` trong phạm vi `src`; config Node và dependency declarations được dẫn chứng ở FE-4. Kết luận “chưa thấy” về tooling/header/runner luôn đi kèm phạm vi tìm, không suy ra cấu hình ngoài repo.

### Lệnh đọc đã chạy trong phiên soạn plan

Các lệnh được chạy theo nhóm qua PowerShell, in kết quả trực tiếp, không redirect ra file. `$r` là FE root ở trên; `$p` là thư mục chứa 5 báo cáo ở trên. Các vòng đọc source dùng hàm `Show` tại chỗ: đọc `Get-Content -Encoding UTF8`, in tên repo/file và chỉ số `$i` từ khoảng đã chọn; nội dung chính xác các khoảng nằm trong citations của plan. Đây là cách đọc/đánh số, không phải script được ghi vào repo.

| Nhóm | Lệnh/biểu thức đã chạy | Kết quả/giới hạn |
|---|---|---|
| Hướng dẫn | `Get-Content -LiteralPath .../using-superpowers/SKILL.md`, `.../writing-plans/SKILL.md`, `.../brainstorming/SKILL.md`, `.../verification-before-completion/SKILL.md`, reference Codex; `Get-Content -Encoding UTF8 -LiteralPath CLAUDE.md`; FE `CLAUDE.md`/`AGENTS.md`; BE `.claude/rules/docs.md`, deployment và plan mẫu | Đọc để áp quy trình; không tạo spec/commit/worktree vì yêu cầu chỉ một plan |
| Báo cáo | `Get-Content -Encoding UTF8 -LiteralPath "$p/result-A.md"` … `result-E.md`; `rg -n '^#{1,4} \|BE-[1-8]\|FE-[1-6]' ...` | Đã đọc findings của cả năm, không coi số dòng báo cáo là citation nguồn |
| Nhận diện | `git rev-parse HEAD`; `git branch --show-current`; FE `git -c safe.directory=D:/WorkSpace/zonenop-game/.claude/worktrees/review-3-open-prs-0d4678 -C $r rev-parse HEAD` và `branch --show-current` | SHA/nhánh ở §1; `-c` chỉ áp trong tiến trình, không sửa Git config |
| Bổ sung E1 — lịch sử mật khẩu | `git -C D:\WorkSpace\be_game log --all --oneline -i --grep "1-72"`; `git -C D:\WorkSpace\be_game show --stat dd8743a`; `git -C D:\WorkSpace\be_game show dd8743a -- src/accounts/username.ts test/accounts-auth.test.ts`; `git -C D:\WorkSpace\be_game log main --oneline -i --grep '1-72'` | `dd8743a` có trên `main`; diff min 8 → 1, thêm test nhận `"1"`; chính sách có chủ ý, D1-a giữ và D1-b/c đảo lại cho đặt mới |
| Bổ sung E2 — nhánh BE chưa merge | `git -C D:\WorkSpace\be_game log --oneline main..origin/feature/typhu-auction`; `git -C D:\WorkSpace\be_game log --oneline main..origin/feature/noi-chu`; `git -C D:\WorkSpace\be_game ls-tree -r --name-only origin/feature/noi-chu -- src/noichu`; `git -C D:\WorkSpace\be_game rev-parse HEAD main origin/feature/typhu-auction origin/feature/noi-chu` | Main/HEAD `99ecea8`; nhánh đấu giá tip `8fd9dfb` có `8858fd8`; Nối Chữ tip `40b7547`, commit thêm game `2db0ba5` và nhiều commit `noichu:`; cây source hiện hữu (§2) |
| Bổ sung E2 — đối chiếu đấu giá | `git -C D:\WorkSpace\be_game show origin/feature/typhu-auction:src/typhu/protocol.ts`; tương tự `src/typhu/game.ts`; đọc/đánh số FE `src/lib/typhu/protocol.ts`; trong bộ nhớ lấy phần từ `export type TPCommand =`, bỏ whitespace bằng `-replace '\s', ''`, so `-ceq` | `TPCommand_equal_ignoring_whitespace=True`; phase/auction view và chênh optional được dẫn ở §2; không ghi file tạm, không chứng nhận runtime |
| Bổ sung E2 — phạm vi xung đột | `git -C D:\WorkSpace\be_game diff --stat main...origin/feature/typhu-auction -- src/typhu`; `git -C D:\WorkSpace\be_game diff --stat main...origin/feature/noi-chu -- src/server src/noichu` | Đấu giá sửa game/protocol/room TyPhu; Nối Chữ thêm source và sửa app/adapters/store; cơ sở kiểm xung đột PR hardening |
| Bổ sung E2/E3 — FE và tiền tố nhánh | FE `git -c safe.directory=D:/WorkSpace/zonenop-game/.claude/worktrees/review-3-open-prs-0d4678 -C $r log --oneline -5` và `rev-parse HEAD develop`; đọc `CLAUDE.md:148-158`, `src/components/games/gamesRegistry.ts:17-25`; BE `git -C D:\WorkSpace\be_game branch -a` | FE `develop` = HEAD `e462ff2`, PR #92 `de658f8`; registry có Nối Chữ; FE cho feature/fix/refactor/chore, BE có feature/fix/chore/docs/ci cùng một số tiền tố khác; bảng §5 chọn các tiền tố đang dùng |
| Tình trạng đầu phiên | `git diff --name-only`; `git ls-files --others --exclude-standard`; cùng hai lệnh tại FE qua `-c safe.directory=... -C $r` | BE rỗng; FE untracked `.claude/settings.local.json` có sẵn; cảnh báo không đọc được user global ignore, nên không coi kiểm kê là audit mọi file ngoài repo |
| File/rules/workflows | `rg --files --hidden -g AGENTS.md -g CLAUDE.md -g '!.git' -g '!node_modules' -g '!.next' ...`; `rg --files --hidden .claude/rules`; `Get-ChildItem -Force -LiteralPath .github -Recurse -File`; FE `Get-ChildItem -LiteralPath "$r/.github/workflows" -File` | BE/FE đều thấy `ci.yml`, `deploy.yml`; các file mới trong plan được đánh dấu |
| Số dòng/source | `@(Get-Content -Encoding UTF8 -LiteralPath $f).Count`; đọc từng vùng bằng `Get-Content` + `for`/`ForEach-Object` đánh số; `rg -n` tìm khai báo/exports/components | Tính cả dòng trống, kiểm cuối file lớn và vùng citation; không sửa source |
| Bảo mật/metrics BE | `rg -n 'console\s*\.\|\bany\b' src/accounts src/server -g '*.ts'`; `rg -n 'npm audit\|eslint\|prettier\|dependabot\|codeql' package.json .github`; `rg --files --hidden -g '*eslint*' -g '*prettier*' -g '*dependabot*' -g '*codeql*' -g '!node_modules' -g '!.git'` | Quét khai báo/cấu hình hiện có, không chạy audit |
| Protocol | Vòng 16 cặp: `Get-Content -Raw -Encoding UTF8` hai bên, `-ceq`, thay CRLF bằng LF rồi `-ceq`, `.Count`; `git diff --no-index --no-ext-diff --unified=2 -- $x $y` cho 15 cặp, Mèo Nổ cards đọc trực tiếp type/count/catalogue/presets | Diff exit 1 nghĩa là có khác; bốn raw equal, hai chỉ EOL. Mèo Nổ cards không chạy full diff trong phiên này; phân loại dựa các vùng source đã đọc |
| FE hooks/test inventory | `rg -n 'exhaustive-deps' "$r/src"`; `rg --files "$r/src" -g '*.test.ts' -g '*.test.tsx' -g '*.spec.ts' -g '*.spec.tsx'`; `rg --files --hidden "$r" -g '*playwright*' -g '*cypress*' -g '*.test.tsx' -g '*.spec.tsx' -g '!node_modules' -g '!.next' -g '!.git'` | 21 disable, 26 file Node test, không tìm browser spec/config tương ứng |
| FE headers/CWV/schema | `rg -n 'Content-Security-Policy\|frame-ancestors\|Referrer-Policy\|X-Content-Type-Options\|Strict-Transport-Security\|X-Frame-Options\|useReportWebVitals\|PerformanceObserver\|Lighthouse\|pa11y\|@testing-library\|page\.goto\|dangerouslySetInnerHTML\|from .zod.' "$r/src" "$r/next.config.ts" "$r/.github" "$r/scripts"` | Không match trong phạm vi này; không bao gồm cấu hình edge ngoài repo |
| FE proxy/docs/dependency | `Test-Path` cho `middleware.ts`, `proxy.ts`, `src/middleware.ts`, `src/proxy.ts`, `vercel.json`; đọc local Next headers/proxy/CSP docs và eslint-config-next vùng a11y; `rg -n -o 'dangerouslySetInnerHTML\|nonce' "$r/node_modules/next-themes/dist/index.mjs"` | Không có các entry đã kiểm; dependency có inline theme script, không suy ra source app có XSS |
| Assets | `Get-ChildItem -LiteralPath "$r/public/games" -File -Recurse \| Measure-Object -Property Length -Sum` | 286 file, 8.645.264 byte; số byte trên đĩa, không phải tải mạng |
| Kiểm kê trước khi chọn file mới | `rg --files src/bang src/typhu src/meono`; `rg --files` các thư mục component game/auth/game-ui FE; `rg --files --hidden -g '*vitest*' -g '!.git' -g '!node_modules'` tại BE | Đối chiếu module hiện hữu; BE chưa thấy Vitest config theo tên quét, vì vậy hai config T04 được ghi mới |
| Tự kiểm plan | `Get-Content` và `.Count` trên chính file này; `rg -n '^## \|^### T\|^\*\*...'` để kiểm headings/trường task; kiểm range citation bằng đọc source chỉ trong bộ nhớ | Chỉ đọc để kiểm cấu trúc/số dòng; không chạy sản phẩm |

Lệnh không thành công và cách xử lý: (1) Git FE ban đầu báo dubious ownership; chạy lại bằng `git -c safe.directory=...` trong đúng lệnh đọc, không dùng `git config --global`. (2) Một lần thử pipe script so diff vào `python -` thất bại vì `python` không có trong PATH; không có script chạy/ghi file, đã dùng PowerShell/Git đọc thay. (3) Tìm không có match bằng `rg` và `git diff --no-index` có khác trả exit 1 là kết quả dự kiến; lần đọc `vitest.config.ts` BE không có file không tạo file đó. Một batch output đầu bị cắt, đã đọc riêng các báo cáo/vùng nguồn cần dùng trước trích dẫn.

Bổ sung kiểm tra tình trạng lượt sửa E1–E3: đã chạy `git --no-optional-locks status --short --untracked-files=all` tại cả hai repo (FE dùng `-c safe.directory=...` như trên) và BE `git diff --name-only`; BE chỉ có plan untracked, FE chỉ có `.claude/settings.local.json` sẵn có. Lượt này không chạy Git có ghi, không tạo nhánh/worktree/file tạm hoặc cài package.

### 5 việc nên làm đầu tiên

1. Chủ repo xem BE-1 và commit chủ ý `dd8743a`, chọn D1-a/b/c cùng giới hạn admin: a giữ chính sách user, b/c đảo lại cho đặt mới (§3); chuẩn bị regression test admin ở T01, **chờ quyết định D1** trước sửa policy/cấp quyền.
2. Làm T02 regression hai IP và kiểm chứng nguồn IP proxy; giữ error/session contract, không chờ refactor bàn.
3. Kiểm kê allowlist hai backend và hai frontend, trình lựa chọn D2; T03 **chờ quyết định D2**, điền env trước enforcement.
4. Thêm Redis CAS integration T04 với service `redis:7`; giữ unit suite cũ, bắt Redis job chạy thật không skip.
5. Làm T08 bỏ nội suy shell bằng env và fixture giả; đồng thời trình D3/D4/D5 và thứ tự merge hai nhánh BE đấu giá/Nối Chữ so với hardening (§2/§5/§7), không tự chốt. Chuẩn bị guard T06: release FE `develop` → `main` chỉ bật đầy đủ khi hai nhánh đã merge/deploy cả hai backend; nếu chưa đủ phải giữ guard capability. PR hardening BE rebase/kiểm xung đột, đặc biệt T06/T22; mọi merge vẫn cần chủ repo đồng ý.
