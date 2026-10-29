# Nối Chữ (`noichu`)
> Nối từ ghép 2 tiếng, hết giờ thì bị loại · 2–8 người · frontend `/noi-chu` · `/api/noichu/ws`, `/api/noichu/rooms`, `/api/noichu/leaderboard`

Hạ tầng chung (hub, adapter, store, giao thức WS, chat, emoji, khán giả, bảng xếp hạng) xem [`../GUIDE.md`](../GUIDE.md). File này chỉ mô tả phần riêng của Nối Chữ.

## Tệp

| File | Vai trò |
|---|---|
| `src/noichu/board.ts` | Hằng số và chuẩn hoá từ, **không import gì** nên chép nguyên văn sang `zonenop-game/src/lib/noichu/`: `MIN_PLAYERS = 2`, `MAX_PLAYERS = 8`, `TURN_SECONDS_OPTIONS`, `DEFAULT_TURN_SECONDS`, `MAX_WORDS`, `MAX_SYLLABLE_LENGTH`, `syllablesOf(word)`, `normalizeWord(text)` |
| `src/noichu/words.ts` | Tra từ điển (nạp một lần mỗi tiến trình, gộp `dict/words.ts` với `extra.ts` và khử trùng): `hasWord`, `wordsStartingWith`, `randomOpeningWord` |
| `src/noichu/extra.ts` | Từ bổ sung do dự án tự soạn (Apache-2.0, **không** nằm trong `dict/`): `EXTRA_WORDS` |
| `src/noichu/dict/` | Danh sách từ: `words.ts` (sinh ra, **GPL-2.0**), `LICENSE-GPL-2.0.txt`, `README.md` (nguồn, giấy phép, quyết định) |
| `src/tools/build-noichu-words.ts` | Tạo lại `dict/words.ts` từ Viet74K |
| `src/noichu/game.ts` | Máy trạng thái thuần `NCState`: `newNCGame`, `playWord`, `needOf`, `forfeitPlayer`, `tickGame`, `nextGameTickAt` |
| `src/noichu/room.ts` | Vòng đời phòng `NCRoom`: `joinNC`, `leaveNC`, `ncHeartbeat`, `ncCommand`, cài đặt, kick, ghi kết quả, `tickNC`, `nextNCTickAt`, `ncView`, `ncSummary`, `isNCActive`, `ncDeltas` |
| `src/noichu/protocol.ts` | Kiểu dây: `NCSettings`, `NCRoomView`/`NCGameView`/`NCPlayerView`/`NCWordView`, `NCCommand`, `CHAIN_VIEW_LIMIT`, `NOICHU_WS_PATH` |
| `src/server/adapters.ts` | `noichuAdapter` |
| `test/noichu.test.ts`, `test/fuzz-noichu.test.ts` | Test luật + phòng; fuzz |

## Luật chơi (như code đang chạy)

- **Chuẩn bị** (`newNCGame`): 2–8 người (ngoài khoảng thì ném lỗi). Thứ tự ngồi được xáo Fisher–Yates bằng `random`, đó là thứ tự lượt; `players[0]` đi trước. Server chọn **từ mở đầu** từ từ điển (`randomOpeningWord`): chỉ chọn từ mà tiếng cuối mở đầu ít nhất 8 từ khác, để không bế tắc ngay. Từ này ở `chain[0]` với `by: null`.
- **Một lượt** (`playWord(id, text)`): người đang tới lượt gõ một từ. Từ phải qua các bước sau, **bước nào sai thì từ chối và không đổi gì** (đồng hồ vẫn chạy, được gõ lại):
  1. Đang chơi và đúng lượt (`Ván đã kết thúc` / `Bạn đã bị loại` / `Chưa đến lượt bạn`).
  2. `normalizeWord`: NFC, chữ thường, gộp khoảng trắng; đúng **2 tiếng**, mỗi tiếng chỉ có chữ cái và dài tối đa 10 ký tự (`MAX_SYLLABLE_LENGTH`; tiếng Việt thật ≤ 7, nới ra cho từ mượn như `instagram`) (`Từ phải gồm đúng 2 tiếng, chỉ có chữ cái`). Người chơi gõ hoa/thường hay thừa khoảng trắng đều được.
  3. **Tiếng đầu phải bằng tiếng cuối của từ trước, kể cả dấu thanh** (`mèo` không nối được `meo`): `Từ phải bắt đầu bằng "…"`.
  4. Chưa dùng trong ván này (`Từ này đã được dùng`).
  5. Kiểm tra từ theo `dictionary` của phòng:
     - `strict` (mặc định): phải có trong từ điển (`Từ này không có trong từ điển`).
     - `loose`: có trong từ điển, **hoặc** cả hai tiếng đều là tiếng Việt thật hoặc **tiếng mượn** quen thuộc (tiếng nào có mặt trong từ điển hoặc trong `LOAN_SYLLABLES`, tức `isSyllable`), ví dụ `đôi mắt` dù không phải mục từ. Từ rác bị từ chối: `"qqqq" không phải tiếng Việt`.
     - Không có mức "không kiểm tra": từ rác (`qqqq`, `hello world`) luôn bị từ chối.
- Từ hợp lệ được thêm vào `chain`, `counts[id] += 1`, lượt và đồng hồ chuyển sang người **chưa bị loại** kế tiếp (`beginTurn`: `deadline = now + turnMs`).
- **Bị loại** (`eliminate`): hết giờ (`tickGame`, khi `now >= deadline`; người mất kết nối thì không trả lời nên cũng hết giờ) hoặc bị chủ phòng kick lúc đã offline (`forfeitPlayer`). Người bị loại vào `out` theo thứ tự. Còn một người thì người đó thắng (`endReason`: `last` nếu cuối cùng là do hết giờ, `forfeit` nếu do rời ván).
- **Giới hạn**: chuỗi dài tới `MAX_WORDS = 300` từ (tính cả từ mở đầu) thì ván kết thúc với `endReason = "limit"`; để mọi ván đều kết thúc.
- **Xếp hạng** (`finish`): người còn lại trước, rồi những người bị loại, người bị loại muộn hơn đứng trên. Riêng `limit`: những người còn lại xếp theo số từ đã nối (nhiều hơn đứng trên, bằng nhau thì **chung hạng**). `winner` = hạng nhất duy nhất, `null` nếu chung hạng.
- **Điểm**: `scoreByRank` (dùng điểm Nhất/Nhì của phòng, tổng mỗi ván bằng 0) qua `ncDeltas`; chung hạng thì lấy trung bình các hạng rồi làm tròn **xuống** (cùng quy tắc với Ô Ăn Quan, xem `GUIDE.md`). `wins` chỉ tăng khi có một hạng nhất duy nhất.

## Cài đặt phòng (`NCSettings`)

| Khoá | Giá trị | Mặc định |
|---|---|---|
| `turnSeconds` | `10`, `15`, `20`, `30` | `20` |
| `dictionary` | `"strict"` (phải có trong từ điển) hoặc `"loose"` (từ điển, hoặc hai tiếng Việt thật). Phiên bản đầu dùng boolean và bản nháp sau đó có thêm `"off"`: server vẫn nhận `true` = `strict`, `false` = `loose` (không còn mức "không kiểm tra"), đọc `"off"` trong dữ liệu cũ là `loose`, và từ chối `"off"` trong lệnh mới (`dictionaryModeOf` trong `board.ts`) | `"strict"` |
| `first`, `second` | điểm Nhất / Nhì (như các game khác) | `2`, `1` |

Chỉ chủ phòng đổi, và không đổi được khi ván đang chạy. Cài đặt được chép vào state khi bắt đầu (`turnMs`, `dictionary`). Phòng cũ trong Redis đọc qua `ncSettingsOf` nên thiếu khoá thì dùng mặc định.

## Lệnh WebSocket (`NCCommand`)

`{ type: "start" }` · `{ type: "settings", turnSeconds?, dictionary?: "strict" | "loose", first?, second? }` · `{ type: "kick", playerId }` · `{ type: "word", text }`

## View (`NCRoomView`)

`current` gồm `turn`, `deadline`, `need` (tiếng đầu mà từ tiếp theo phải bắt đầu; `null` khi đã hết ván), `dictionary` (chế độ kiểm tra), `players[]` (`seat`, `words`, `out`, `rank`), `chain` (chỉ `CHAIN_VIEW_LIMIT = 40` từ cuối, cũ nhất trước) cùng `chainLength` (tổng số từ), `finished`, `winner`, `endReason`, `log`. Không có dữ liệu riêng tư nên khán giả và người chơi thấy như nhau; token không bao giờ có trong view.

## Từ điển và giấy phép

Danh sách chính (48.425 từ ghép 2 tiếng) lấy từ **Viet74K** của Hồ Ngọc Đức, giấy phép **GPL-2.0**, trong khi phần còn lại của be_game theo **Apache-2.0**. Chủ repo đã chấp nhận giữ nó như một file dữ liệu riêng trong `src/noichu/dict/` (xem `dict/README.md`); đây là quyết định về rủi ro pháp lý, không phải ý kiến pháp lý. Muốn bỏ GPL thì thay `dict/words.ts` bằng nguồn khác cùng định dạng.

**Từ bổ sung** (`extra.ts`, 1.179 cụm, trong đó 497 đã có sẵn nên thêm ròng 682 từ, cộng 223 tiếng mượn cho mức lỏng): Viet74K là danh sách *mục từ*, nên thiếu nhiều cụm hằng ngày. `extra.ts` vá các nhóm đã biết: loại từ + danh từ hợp nghĩa (`con mèo`, `cái ghế`, `quả cam`, `trái tim`, `cây cầu`, `hoa hồng`), tên tỉnh thành và quốc gia (`đà nẵng`, `việt nam`), món ăn và đồ uống (`trà sữa`, `phở bò`), cụm động từ thường dùng (`ăn cơm`, `chạy bộ`), họ hàng (`chú bác`), một số từ mượn (`ti vi`, `sa lông`). Loại từ chỉ ghép với danh từ hợp (không có `con bàn`), và không đưa vào vế thành ngữ hay mảnh câu. Mục nào không đúng 2 tiếng bị bỏ khi nạp; `test/noichu.test.ts` kiểm tra mọi mục.

**Từ mượn.** Hai loại, xử lý khác nhau. (1) Từ mượn *phiên âm tiếng Việt* (`ti vi`, `cà phê`, `xà phòng`) phần lớn đã có trong Viet74K; `extra.ts` thêm vài từ còn thiếu (`bi a`, `xi nê`, `ắc quy`…). (2) Từ mượn *viết nguyên chữ Latin* (`web`, `zalo`, `email`, `grab`, `pizza`, thường có f/j/w/z) không có trong Viet74K. `extra.ts` thêm: một danh sách **cụm phổ biến** cho mức `strict` (`trang web`, `chơi game`, `đi grab`, `gửi email`, `ăn pizza`, `đi gym`…) và `LOAN_SYLLABLES`, danh sách **tiếng mượn** (223: mạng xã hội, mua sắm, đồ ăn, thể thao, thương hiệu, ứng dụng…) để mức `loose` nhận mọi cụm có một tiếng mượn quen thuộc ghép với tiếng Việt thật (`gửi zalo`, `bật stream`). Đây không phải tiếng Việt, nên chúng nằm riêng trong `extra.ts` và được gộp vào tập tiếng ở `words.ts`.

Giới hạn: danh sách là hữu hạn. Một tiếng mượn **chưa liệt kê** vẫn bị từ chối ở mức lỏng (thử 59 tên ứng dụng/thương hiệu chưa liệt kê thì chỉ nhận 3 trước khi tôi thêm nhóm đó). Không thể nhận "mọi chữ Latin" vì như vậy cũng nhận cả rác (`asdf`, `zzzz`).

**Hạn chế còn lại.** Phần thiếu còn lại chủ yếu là cụm ghép tự do (danh từ + danh từ/tính từ) mà danh sách hữu hạn không phủ hết, ví dụ `đôi mắt`, `giờ học`, `kỳ thi`, `tin nhắn`, `giường ngủ`, `dòng sông`. Trên một bộ 150 từ thử độc lập (không dùng khi soạn `extra.ts`) độ phủ gần như không đổi, khoảng 81%, và một phần số "thiếu" đó là chính các mục thử không phải từ thật. Nên ở `strict` từ đúng vẫn có thể bị báo "không có trong từ điển". Chế độ `loose` sinh ra để giải quyết đúng chỗ này: tập tiếng suy ra từ từ điển và `LOAN_SYLLABLES` có 7.344 tiếng, và trong lần thử trước, nó chấp nhận cả 19 cụm đúng bị `strict` từ chối (`đôi mắt`, `giờ học`, `tin nhắn`…), vẫn từ chối rác (`qqqqq`, `hello world`). Đổi lại `loose` **nhận cả cụm vô nghĩa làm từ hai tiếng có thật** (`bàn bàn`, `mèo bàn`), tập tiếng có thể lẫn vài âm tiết không phải tiếng Việt lấy từ tên riêng trong từ điển, và tiếng mượn chưa có trong `LOAN_SYLLABLES` vẫn bị từ chối (xem phần Từ mượn). Không có mức tắt hẳn: nếu từ điển lỏng vẫn chặn nhầm từ của bạn thì đó là tiếng không có trong từ điển (ví dụ từ mượn có f/j/w/z).

## Test

- `test/noichu.test.ts`: chuẩn hoá, dấu thanh, từ lặp, hai chế độ từ điển (kể cả boolean cũ), hết giờ, kick, giới hạn từ, phòng (cài đặt, bắt đầu, điểm, 8 người, phòng cũ).
- `test/fuzz-noichu.test.ts`: lệnh rác và tick ngẫu nhiên có seed; kiểm tra chuỗi liền mạch, không trùng từ, đếm từ khớp, bất biến xếp hạng, lệnh bị từ chối không đổi state, JSON round-trip, view không lộ token, tổng điểm bằng 0. `FUZZ_SEEDS` tăng số seed.
- Cũng được kiểm trong `rejoin`, `tick-spin`, `shared-store`, `migrate-store`.
