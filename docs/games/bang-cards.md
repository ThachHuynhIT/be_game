# Đấu Súng — danh mục lá, nhân vật, sự kiện, trang bị

Phụ lục của [`bang.md`](bang.md). Dữ liệu ở `src/bang/cards.ts`; cột "Code làm gì" mô tả hành vi **thực tế** trong `game.ts` / `actions.ts` (có thể khác lời `text` hiển thị). Ký hiệu: ♠ S, ♥ H, ♦ D, ♣ C; số 11–14 = J Q K A. "Bắn" = tạo `react` `missed` qua `shot()` (cờ `shot`, áp Sờ Lép, Súng Hai Nòng, Treo Thưởng, Súng Hoa Cải…). "BANG!" = lá `isBang`, tính vào giới hạn `bangsLeft`.

## Lá chơi (`CARD_TYPES`, 167 lá vật lý trong `CARDS`)

Màu: `brown` đánh rồi bỏ · `blue` đặt trước mặt · `green` đặt trước mặt, từ lượt sau mới `use` (bỏ đi để dùng). Mỗi pack chơi còn có bản sao lá base, liệt kê ở dòng "+ base".

### base — 80 lá

| key | Tên | Số lá | Màu / nhắm | Code làm gì |
|---|---|---|---|---|
| `bang` | BANG! | 25 | brown, `range` | BANG!: bắn 1 người trong tầm. Khi `ricochet`: `pick: {zone:"play"}` nhắm 1 lá trước mặt họ (không Trượt! thì lá đó bị bỏ, không mất máu) |
| `missed` | Trượt! | 12 | brown | Chỉ dùng để trả lời |
| `beer` | Bia | 6 | brown | +1 máu (Tê Nghiện Rượu +2); không khi đầy máu, khi ≤ 2 người sống, khi `hangover`/`reverend`. Tự uống khi sắp chết. Kích hoạt Bà Chủ Quán / Chanh Muối |
| `panic` | Hoảng Loạn | 4 | brown, `dist1` | Lấy 1 lá (`pick`) của người đó; có cửa sổ né (Chuồn/Mích) |
| `catbalou` | Quậy Phá | 4 | brown, `any` | Bắt bỏ 1 lá (`pick`); có cửa sổ né |
| `stagecoach` | Xe Ngựa | 2 | brown | Rút 2 |
| `wellsfargo` | Ngân Hàng | 1 | brown | Rút 3 |
| `generalstore` | Tạp Hoá | 2 | brown | Lật số lá = số người sống; prompt `store` lần lượt từ người đánh |
| `indians` | Da Đỏ! | 2 | brown | Mỗi người khác sống (không miễn nhiễm): react `bang`, `evadable`, thua mất 1 |
| `duel` | Đấu Tay Đôi | 3 | brown, `any` | React `bang` luân phiên, mục tiêu trả trước; ai không đánh mất 1; `evadable` |
| `gatling` | Súng Máy | 1 | brown | Mỗi người khác sống (không miễn nhiễm): react `missed` (không phải `shot`, không tính BANG!) |
| `saloon` | Quán Rượu | 1 | brown | Mọi người sống +1 |
| `barrel` | Thùng Gỗ | 2 | blue | Khi bị bắn: rút! ♥ = 1 Trượt! (trước khi hiện prompt) |
| `scope` | Ống Ngắm | 1 | blue | Mình nhìn người khác −1 |
| `mustang` | Ngựa Hoang | 2 | blue | Người khác nhìn mình +1 |
| `jail` | Nhà Giam | 3 | blue, đặt lên người khác | Không lên Cảnh sát trưởng (trừ 3 người). Đầu lượt họ: gỡ, rút! ♥ thoát, không thì mất lượt |
| `dynamite` | Thuốc Nổ | 1 | blue | Đầu lượt chủ: rút! ♠ 2–9 → mất 3 máu; không thì chuyền sang người sống kế tiếp chưa có |
| `volcanic` | Súng Liên Thanh | 2 | blue, tầm 1 | BANG! không giới hạn |
| `schofield` / `remington` / `carabine` / `winchester` | Súng tầm 2/3/4/5 | 3/1/1/1 | blue | Súng mới thay súng cũ |

### dodge — Thị trấn Né Đạn, 40 lá

| key | Tên | Số | Màu / nhắm | Code làm gì |
|---|---|---|---|---|
| `punch` | Đấm | 1 | brown, `dist1` | BANG! khoảng cách 1; không đi kèm Nhắm Kỹ / BANG! thứ hai |
| `dodge` | Né | 2 | brown | Như Trượt! + rút 1 |
| `springfield` | Súng Trường Xa | 1 | brown, `any`, `cost` | Bắn ở mọi khoảng cách, không tính BANG! |
| `whisky` | Whisky | 1 | brown, `cost` | +2 máu (không khi đầy) |
| `tequila` | Tequila | 1 | brown, `anyone`, `cost` | `target` (mặc định mình) +1 máu |
| `ragtime` | Nhạc Ragtime | 1 | brown, `any`, `cost` | Như Hoảng Loạn, mọi khoảng cách |
| `brawl` | Ẩu Đả | 1 | brown, `cost` | Mỗi người khác sống có bài: prompt `pick` (mode discard) cho **người đánh** chọn lá bỏ. Không né được |
| `binocular` / `hideout` | Ống Nhòm / Hang Ẩn Nấp | 1/1 | blue | Như Ống Ngắm / Ngựa Hoang (cộng dồn) |
| `bible` | Kinh Thánh | 1 | green | Trả lời như Trượt! + rút 1 |
| `ironplate` / `sombrero` / `tengallon` | Giáp Sắt / Mũ Rộng Vành / Mũ Cao Bồi | 1/1/1 | green | Trả lời như Trượt! (xử lý chung qua `isMissed`) |
| `canteen` | Bi Đông | 1 | green | `use`: +1 máu (không khi đầy) |
| `cancan` | Múa Cancan | 1 | green, `any` | `use`: như Quậy Phá |
| `conestoga` | Xe Thồ | 1 | green, `any` | `use`: như Hoảng Loạn, mọi khoảng cách |
| `derringer` | Súng Bỏ Túi | 1 | green, `dist1` | `use`: bắn + rút 1 |
| `knife` | Dao Găm | 1 | green, `dist1` | `use`: bắn |
| `pepperbox` | Súng Ổ Xoay | 1 | green, `range` | `use`: bắn |
| `buffalo` | Súng Săn Bò | 1 | green, `any` | `use`: bắn |
| `howitzer` | Đại Bác | 1 | green | `use`: như Súng Máy |
| `ponyexpress` | Ngựa Trạm | 1 | green | `use`: rút 3 |

\+ base: `bang` ×5, `beer`, `catbalou`, `duel`, `generalstore`, `indians`, `missed`, `panic`, `barrel`, `dynamite`, `mustang`, `remington`, `carabine`.
`cost` = phải gửi thêm `extra: [idLáKhác]` để bỏ kèm.

### valley — Thung Lũng Bóng Ma, 24 lá

| key | Tên | Số | Màu / nhắm | Code làm gì |
|---|---|---|---|---|
| `aim` | Nhắm Kỹ | 1 | brown | Chỉ đi kèm (`extra`) lá BANG! (trừ Đấm): phát đầu gây 2 máu |
| `backfire` | Phản Đòn | 1 | brown | Trả lời như Trượt!, rồi kẻ bắn nhận 1 react `missed` ngược lại |
| `bandidas` | Nữ Cướp | 1 | brown | Mỗi người khác sống: prompt `discard` (2 lá hoặc mất 1 máu) |
| `escape` | Chuồn | 2 | brown | Không đánh trong lượt; trả lời prompt `evade` / `evadable` để hủy lá nhắm vào mình |
| `fanning` | Bắn Quạt | 1 | brown, `range` | BANG!: `target` trong tầm + `target2` tuỳ chọn ở khoảng cách ≤ 1 **từ target** |
| `lastcall` | Ly Cuối | 1 | brown | +1 máu kể cả khi 2 người; tự dùng khi sắp chết (sau Bia) |
| `poker` | Xì Phé | 1 | brown | Mỗi người khác úp 1 lá vào pot; không có A → người đánh nhận prompt `keep` (`cause: "poker"`, `keep: 2`) để **chọn 2 lá** trong pot (pot ≤ 2 lá thì lấy hết); hết giờ → `autoAnswer` lấy 2 lá đầu; lá còn lại bỏ đi |
| `saved` | Cứu Nguy | 2 | brown | Ngoài lượt: khi người khác sắp mất máu, prompt `save`; chặn 1 máu, nếu họ lẽ ra chết (`life ≤ amount`) thì rút 2 |
| `tomahawk` | Rìu Ném | 1 | brown, `dist2` | Bắn (không `shot`, không tính BANG!) |
| `tornado` | Lốc Xoáy | 1 | brown | Mọi người sống (từ mình) bỏ **ngẫu nhiên** 1 lá trên tay rồi rút 2 |
| `bounty` | Treo Thưởng | 1 | blue, đặt lên người khác | Ai gây sát thương bằng `shot` cho họ rút 1 |
| `ghost` | Hồn Ma | 2 | blue, đặt lên người **đã chết** | Người đó thành hồn ma: có lượt, không mất máu, không tính khi xét thắng; mất lá này thì về lại cõi chết |
| `lemat` | Súng Hai Cỡ | 1 | blue, tầm 1 | Trong lượt mình, mọi lá trên tay đánh được như BANG! (`as: "bang"`) |
| `rattlesnake` | Rắn Chuông | 1 | blue, đặt lên người khác | Đầu lượt họ: rút! ♠ → mất 1 |
| `shotgun` | Súng Hoa Cải | 1 | blue, tầm 1 | `shot` của mình trúng → nạn nhân bỏ ngẫu nhiên 1 lá trên tay |

\+ base: `bang` ×2, `missed`, `beer`, `panic`, `catbalou`.

### armed — Trang Bị Tận Răng, 23 lá

| key | Tên | Số | Màu / nhắm | Code làm gì |
|---|---|---|---|---|
| `reload` | Nạp Đạn | 2 | brown | +3 đạn: vào lá có `load` còn < 4 trước, rồi thẻ nhân vật (< 4), thừa thì mất |
| `quickshot` | Bắn Nhanh | 2 | brown, `range` | BANG! (tính 1): bắn 2 người khác nhau trong tầm (`target`, `target2`) |
| `flintlock` | Súng Kíp | 2 | brown, `range` | BANG!; bị né thì lá về tay |
| `lockpick` | Bẻ Khoá | 1 | brown, `any` | Lấy ngẫu nhiên 1 lá trên tay; có cửa sổ né |
| `duck` | Cúi Đầu! | 2 | brown | Như Trượt!; thẻ nhân vật còn đạn thì tốn 1 viên, lá về tay |
| `nip` | Hớp Rượu | 1 | brown | +1 máu và +1 đạn thẻ nhân vật (dùng được cả khi đầy máu) |
| `squaw` | Giật Đồ | 1 | brown, `any` | `pick` 1 lá trước mặt: bỏ; `mode: "take"` + đủ 2 đạn → lấy về tay (thiếu đạn thì lặng lẽ thành bỏ) |
| `bandolier` | Đai Đạn | 1 | blue, `load 2` | `use` tốn 1 đạn: +1 BANG! trong lượt |
| `belltower` | Tháp Chuông | 1 | blue, `load 2` | `use` tốn 1 đạn: lá kế tiếp bỏ qua khoảng cách |
| `bigfifty` | Súng Săn Lớn | 1 | blue, tầm 3, `load 2` | `use` tốn 1 đạn: BANG! kế tiếp `noGear` (bỏ qua Thùng Gỗ & Trượt! xanh lá của mục tiêu) và, khi chọn mục tiêu, bỏ qua Ngựa Hoang / Hang Ẩn Nấp (`distance(…, ignoreCards)`; Paul vẫn tính) |
| `doublebarrel` | Súng Hai Nòng | 1 | blue, tầm 1 | Chỉ lá BANG! (`bang`, Đấm, Bắn Quạt, Bắn Nhanh, Súng Kíp, lá dùng như BANG!) chất ♦ là `unmissable`; Dao Găm, Súng Ổ Xoay… không bị ảnh hưởng |
| `buntline` | Súng Nòng Dài | 1 | blue, tầm 2, `load 2` | `shot` bị né → tự tốn 1 đạn, người kia bỏ ngẫu nhiên 1 lá |

\+ base: `bang` ×3, `missed` ×2, `beer`, `stagecoach`.

## Nhân vật (`CHARACTERS`, 63)

Cột "Kích hoạt": *thụ động* = code tự áp; `ability <name>` = lệnh `ability` (tham số trong ngoặc); `draw <mode>` = chế độ rút. Máu là máu gốc (Cảnh sát trưởng +1).

### base (16)

| key | Tên | Máu | Kích hoạt | Code làm gì |
|---|---|---|---|---|
| `bart` | Ba Lì Đòn | 4 | thụ động | Mỗi máu mất rút 1 |
| `blackjack` | Cờ Đen | 4 | thụ động (rút thường) | Lá thứ 2 lộ ra; chất thật ♥/♦ thì rút thêm 1 |
| `calamity` | Cô Tai Ương | 4 | thụ động / `as: "bang"` | BANG! làm Trượt!, Trượt! làm BANG! (cả khi trả lời lẫn khi đánh) |
| `elgringo` | Gã Ngoại Quốc | 3 | thụ động | Mỗi máu mất do người khác: lấy ngẫu nhiên 1 lá trên tay kẻ đó |
| `jesse` | Giét Móc Túi | 4 | `draw jesse` (`target`) | Lá đầu lấy ngẫu nhiên từ tay `target` |
| `jourdonnais` | Giò Đỏ May | 4 | thụ động | Thêm 1 lần rút! như Thùng Gỗ (cộng với Thùng Gỗ thật) |
| `kit` | Kít Soi Bài | 4 | thụ động (rút thường) | Prompt `keep`: xem `n+1`, giữ `n`, còn lại trả lên đầu chồng |
| `lucky` | Lão Hên | 4 | thụ động | Mỗi rút! lật thêm 1 lá, lấy lá tốt |
| `paul` | Phôn Né Tránh | 3 | thụ động | Như Ngựa Hoang |
| `pedro` | Pê Nhặt Rác | 4 | `draw pedro` | Lá đầu lấy từ đỉnh đống bỏ |
| `rose` | Rô Mắt Ưng | 4 | thụ động | Như Ống Ngắm |
| `sid` | Sít Liều Mạng | 4 | `ability sid` (`cards` 2 lá), bất cứ lúc nào | Bỏ 2 → +1 máu (không khi đầy); khi sắp chết tự bỏ 2 lá đầu tay |
| `slab` | Sờ Lép Sát Thủ | 4 | thụ động | Chỉ phát bắn của lá BANG! (`shot(…, {bang: true})`: cả Chai Rượu chế độ `bang`) cần ≥ 2 Trượt!; Rìu Ném, Dao Găm, Súng Máy, Đại Bác… không |
| `suzy` | Su Xinh | 4 | thụ động | Hết bài trên tay → rút 1 (kiểm tra sau hầu hết thao tác) |
| `vulture` | Kền Kền | 4 | thụ động | Người chết → hắn lấy hết bài tay + trước mặt |
| `willy` | Uy Nhóc | 4 | thụ động | BANG! không giới hạn |

### dodge (15)

| key | Tên | Máu | Kích hoạt | Code làm gì |
|---|---|---|---|---|
| `apache` | Thổ Dân Trẻ | 3 | thụ động | Miễn lá ♦ của người khác (không bị chọn làm mục tiêu, bỏ qua trong Súng Máy / Da Đỏ!) |
| `belle` | Cô Ngôi Sao | 4 | thụ động | Trong lượt cô, lá trước mặt người khác mất tác dụng |
| `bill` | Bin Mặt Trơ | 4 | thụ động | Rút `1 + máu đã mất` |
| `chuck` | Chắc Liều | 4 | `ability chuck` | −1 máu (phải còn > 1) → rút 2; không giới hạn số lần |
| `doc` | Bác Sĩ Súng | 4 | `ability doc` (`cards` 2, `target`) | Bỏ 2 → bắn 1 người trong tầm; 1 lần/lượt; không tính BANG! |
| `elena` | Ê-lê-na | 3 | thụ động | Mọi lá trên tay làm Trượt! |
| `greg` | Thợ Đào Mộ | 4 | thụ động | Ai chết → +2 máu |
| `herb` | Thợ Săn Cỏ | 4 | thụ động | Ai chết → rút 2 |
| `jose` | Hô-xê | 4 | `ability jose` (`card` xanh dương trên tay) | Bỏ → rút 2; 2 lần/lượt |
| `molly` | Mô-li Nhanh Tay | 4 | thụ động | Mỗi lá đánh ngoài lượt (trả lời, Chuồn, Cứu Nguy) rút 1 |
| `pat` | Pát Trộm Đồ | 4 | `draw pat` (`target`, `card`) | Lấy 1 lá trước mặt người khác thay cho cả lượt rút |
| `pixie` | Tí Hon | 3 | thụ động | Rút 3 |
| `sean` | Sơn Ôm Bài | 3 | thụ động | Giới hạn tay ≥ 10 |
| `tequilajoe` | Tê Nghiện Rượu | 4 | thụ động | Bia +2 |
| `vera` | Vê Bắt Chước | 3 | prompt `copy` đầu lượt (`choice`) | Mượn nhân vật của 1 người khác còn trong ván tới lượt sau |

### wws (8)

| key | Tên | Máu | Kích hoạt | Code làm gì |
|---|---|---|---|---|
| `bigspencer` | Ông Bự | 9 | thụ động | Khởi đầu 5 lá; `missedCards` luôn rỗng (cả lá xanh lá) |
| `flint` | Phờ-lin Đổi Chác | 4 | `ability flint` (`card`, `target`) | Đưa 1 lá, lấy ngẫu nhiên tối đa 2 lá trên tay họ; 1 lần/lượt |
| `gary` | Ga Nhặt Nhạnh | 5 | thụ động | Lá người khác bỏ ở `endTurn` (kể cả bỏ thêm lấy vàng) về tay hắn |
| `greygory` | Xám Nhiều Mặt | 4 | thụ động đầu lượt | Mượn 2 nhân vật ngẫu nhiên (pack đã bật, không có trong `usedChars`) và thêm chúng vào `usedChars` |
| `johnpain` | Giôn Đau Đớn | 4 | thụ động | Tay < 6: lá được chọn của mọi lần rút! về tay hắn |
| `leevan` | Li Bắn Lại | 4 | `ability leevan` (`card` BANG!-type) | Bỏ 1 BANG! → lặp lá nâu không-BANG! vừa đánh (`lastBrown`, cùng mục tiêu, kiểm tra lại) |
| `teren` | Tê Rèn Lì | 3 | thụ động | Khi bị hạ: rút! không ♠ → còn 1 máu + rút 1 |
| `youl` | Du Cười Toe | 4 | thụ động đầu lượt | Ai nhiều bài hơn đưa hắn ngẫu nhiên 1 lá |

### goldrush (8)

| key | Tên | Máu | Kích hoạt | Code làm gì |
|---|---|---|---|---|
| `donbell` | Đông Chuông | 4 | thụ động cuối lượt | Rút! ♥/♦ → thêm 1 lượt (không nếu đã là lượt thêm hoặc Báo Thù đã cho) |
| `dutch` | Đát Tham Vàng | 4 | thụ động (rút thường) | Prompt `keep`: xem `n`, giữ `n−1`, +1 vàng |
| `jacky` | Giắc-ki Hào Phóng | 4 | `ability jacky` | 2 vàng → +1 BANG!; không giới hạn |
| `josh` | Giốt Mua Chịu | 4 | `ability josh` | 2 vàng → lá trên cùng `shopDeck`; từ chối (không mất vàng) nếu là trang bị `keep` đã có. Chai Rượu = Bia, Bạn Đồng Hành = Tạp Hoá, Truy Nã **tự** gắn lên người sống đầu tiên khác mình (lá trên cùng không lộ nên không chọn trước được) |
| `madam` | Bà Chủ Quán | 4 | thụ động | Mỗi lần ai uống Bia (kể cả mình) rút 1 |
| `luzena` | Lu Buôn Bán | 4 | thụ động | Món đầu mỗi lượt rẻ hơn 1 |
| `raddie` | Rết Đổi Vàng | 4 | `ability raddie` | 1 vàng → rút 1; 2 lần/lượt |
| `simeon` | Si Mê Vàng | 4 | thụ động | Mỗi máu mất +1 vàng |

### valley (8)

| key | Tên | Máu | Kích hoạt | Code làm gì |
|---|---|---|---|---|
| `blackflower` | Hoa Đen | 4 | `ability blackflower` (`card` ♣, `target`) | Bắn người trong tầm, không tính BANG!; 1 lần/lượt |
| `colorado` | Cô-lô-ra-đô | 4 | thụ động khi đánh BANG! | Mỗi lá BANG! (`bang`, Đấm, Bắn Quạt, Bắn Nhanh, Súng Kíp) hắn đánh: rút! (`flip`), ra ♠ → mọi phát bắn của lá đó `unmissable` |
| `derspot` | Đốm Chuông | 4 | `ability derspot` (`card` = lá `bang`) | Lá đó như Súng Máy; tính 1 BANG!; 1 lần/lượt |
| `evelyn` | Ê-vơ-lin Nóng Súng | 4 | `draw evelyn` (`targets` 1–2) | Mỗi lá bỏ rút = 1 phát bắn vào 1 người trong tầm |
| `henry` | Hen-ri Gai Góc | 4 | thụ động | Ai lấy/bắt hắn bỏ lá (Hoảng Loạn, Quậy Phá, Bẻ Khoá, Giật Đồ, Ẩu Đả, Giét, Pát, Phờ-lin…) bị hắn bắn 1 phát |
| `lemonade` | Chanh Muối | 4 | thụ động | Người khác uống Bia → +1 máu |
| `mick` | Mích Phòng Thủ | 4 | trả lời | Dùng 1 Trượt! để hủy prompt `evade`/`evadable` |
| `tuco` | Tu Cô Tu Sĩ | 4 | thụ động | Không có lá xanh dương trước mặt → rút +2 |

### armed (8)

| key | Tên | Máu | Kích hoạt | Code làm gì |
|---|---|---|---|---|
| `alpreacher` | Mục Sư Al | 4 | thụ động | Người khác đặt lá xanh dương/xanh lá (lên bất kỳ ai) → rút 1 |
| `bass` | Bát Thợ Rèn | 4 | `ability bass` (`card`) | Bỏ 1 lá → +2 đạn; 1 lần/lượt |
| `bloody` | Mê-ri Máu | 4 | thụ động | `shot` của cô bị né → rút 1 |
| `frankie` | Phờ-ran-ki | 4 | `ability frankie` (`target`, `card?`) | Lấy 1 đạn từ lá `card` trước mặt `target` (ai cũng được), hoặc bỏ `card` = thẻ nhân vật của người khác, về thẻ mình (< 4); 1 lần/lượt |
| `julie` | Giu-li Dao Cạo | 4 | thụ động | Mất máu vì người khác (còn sống): rút! ♥/♦ → bắn trả |
| `mexicali` | Mếch-xi-ca-li | 4 | `ability mexicali` | 2 đạn → +1 BANG!; 1 lần/lượt |
| `abigail` | Bà Á-bi | 4 | thụ động | Miễn lá tấn công J–A (`ATTACKS`) của người khác |
| `redringo` | Rinh-gô Đỏ | 4 | `ability redringo` (`card` của mình) | Khởi đầu 4 đạn; chuyển 1 đạn sang lá trước mặt (< 4); 2 lần/lượt |

## Sự kiện (`EVENTS`, 38)

Lật ở đầu lượt "leader" (bước 0). ✦ = final (đặt cuối, ở lại tới hết ván).

| Pack | key | Tên | Code làm gì |
|---|---|---|---|
| highnoon | `blessing` / `curse` | Phúc Lành / Lời Nguyền | `effSuit`: mọi lá rút! (và Rượu Rum, Nấm Ảo Giác) tính là ♥ / ♠ |
| | `daltons` | Anh Em Nhà Cướp | Khi lật: mỗi người sống có lá xanh dương bỏ lá xanh dương **đầu tiên** |
| | `doctor` | Bác Sĩ | Khi lật: người ít máu nhất +1 |
| | `ghosttown` | Thị Trấn Ma | Người chết có 1 lượt `townGhost` (rút 3, không chết, cuối lượt bỏ hết) |
| | `reverse` | Đổ Xô Tìm Vàng | Lượt đi ngược chiều |
| | `hangover` | Say Xỉn | Bia vô tác dụng (không đánh, không tự cứu) |
| | `newidentity` | Danh Tính Mới | Prompt `draw` có `swap`: đổi sang `alt`, máu = min(2, max mới) |
| | `sermon` | Bài Giảng | Không đánh lá BANG! (`bangsLeft = 0`) |
| | `shootout` | Đọ Súng | +1 BANG! mỗi lượt |
| | `reverend` | Mục Sư | Không uống Bia |
| | `thirst` / `train` | Khát Nước / Tàu Đến Ga | Rút −1 / +1 |
| | `highnoon` ✦ | Giữa Trưa | Đầu lượt mất 1 máu |
| fistful | `mine` | Mỏ Bỏ Hoang | Rút thường lấy từ đống bỏ nếu đủ lá |
| | `ambush` | Phục Kích | Mọi khoảng cách = 1 |
| | `bloodbrothers` | Anh Em Kết Nghĩa | Prompt `draw` có `blood`: mất 1 máu (cần > 1), `blood` +1 |
| | `deadman` | Người Chết Sống Lại | Khi lật: người chết **sớm nhất** sống lại 2 máu, 2 lá |
| | `hardliquor` | Rượu Mạnh | `draw liquor`: không rút, +1 máu |
| | `lasso` | Dây Thòng Lọng | Mọi lá trước mặt mất tác dụng (`gearActive = false`) |
| | `lawwest` | Luật Miền Tây | Rút thường thêm 1 lá (ghi log tên lá) |
| | `peyote` | Nấm Ảo Giác | `draw peyote` (`color`): lật tới khi sai màu (tối đa 20), giữ các lá đúng |
| | `ranch` | Nông Trại | `ability ranch` (`cards`): bỏ bao nhiêu tuỳ ý, rút lại bấy nhiêu; 1 lần/lượt |
| | `ricochet` | Đạn Nảy | BANG! được nhắm lá trước mặt người khác |
| | `roulette` | Cò Quay Nga | Khi lật: từ Cảnh sát trưởng (hoặc người sống đầu), lần lượt react `missed`; người đầu không đỡ mất 2 |
| | `sniper` | Bắn Tỉa | Đánh 2 BANG! cùng lúc (`extra`) → cần 2 Trượt! |
| | `judge` | Quan Toà | Không ai đặt lá ra trước mặt |
| | `vendetta` | Báo Thù | Cuối lượt rút! ♥ → thêm 1 lượt |
| | `fistful` ✦ | Nắm Bài | Đầu lượt: 1 react `missed` cho mỗi lá trên tay |
| wws | `boneyard` | Nghĩa Địa | Khi lật: mọi người chết sống lại 1 máu, 1 lá |
| | `valentine` | Tình Nhân | Đầu lượt: bỏ hết bài trên tay, rút lại bấy nhiêu |
| | `dorothy` | Cơn Giận Đô-rô-ti | `ability dorothy` (`target` bất kỳ): react `bang`; 1 lần/lượt |
| | `helena` | Bà Đồng Hê-lê-na | Khi lật: xáo lại vai của người sống trừ Cảnh sát trưởng |
| | `ladyrose` | Quý Bà Hoa Hồng | `ability ladyrose` (`target` ngồi cạnh): đổi chỗ trong `order`; 1 lần/lượt |
| | `susanna` | Cô Su-da-na | Cuối lượt: `turn.played < 3` → mất 1 |
| | `sacagaway` | Lật Bài Ngửa | View lộ tay mọi người |
| | `showdown` | Quyết Đấu | Mọi lá đánh như BANG!; BANG! làm Trượt!; mọi lá trả lời được react `bang` |
| | `wildwestshow` ✦ | Gánh Xiếc Miền Tây | Thắng = người sống cuối cùng |

## Trang bị Cơn Sốt Vàng (`GEAR`, mỗi món 2 bản trong `GEAR_DECK`)

`instant` = dùng ngay khi mua; `keep` = nằm trong `player.gear` (không bị lấy, không bị Dây Thòng Lọng / Cô Ngôi Sao vô hiệu). Lệnh `buy { slot, mode?, target?, pick? }`.

| key | Tên | Giá | Loại | Code làm gì |
|---|---|---|---|---|
| `bottle` | Chai Rượu | 2 | instant | `mode`: `panic` (dist1, `pick`, có cửa sổ né) · `beer` (+1; không khi đầy máu, cũng bị Say Xỉn / Mục Sư / chỉ còn 2 người chặn như Bia) · `bang` (bắn trong tầm, không tính BANG! nhưng Sờ Lép áp dụng) |
| `pardner` | Bạn Đồng Hành | 2 | instant | `mode`: `store` (Tạp Hoá) · `duel` · `cat` (Quậy Phá, `pick`) |
| `rum` | Rượu Rum | 3 | instant | Lật 4 lá, +1 máu mỗi chất khác nhau |
| `unionpacific` | Đường Sắt | 4 | instant | Rút 4 |
| `goldfever` | Sốt Vàng | 5 | instant | Hồi đầy máu, kết thúc lượt ngay (tự bỏ bài dư) |
| `pickaxe` | Cuốc Chim | 4 | keep | Rút +1 |
| `goldpan` | Chảo Đãi Vàng | 3 | keep | `ability goldpan`: 1 vàng → rút 1; 2 lần/lượt |
| `horseshoe` | Móng Ngựa | 2 | keep | Mỗi rút! lật thêm 1 |
| `luckycharm` | Bùa May | 3 | keep | Mỗi máu mất +1 vàng |
| `calumet` | Tẩu Hoà Bình | 3 | keep | Miễn lá ♦ của người khác |
| `ace` | Át Chủ Bài | 2 | keep | Giới hạn tay +2 |
| `wanted` | Truy Nã | 2 | keep (đặt lên `target` khác, sống, chưa bị) | Ai giết người đó rút 2 + 1 vàng |

Không mua được món `keep` đã có (trừ Truy Nã).
