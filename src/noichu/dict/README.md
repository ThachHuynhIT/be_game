# Từ điển Nối Chữ

`words.ts` là danh sách từ ghép 2 tiếng dùng để kiểm tra từ trong Nối Chữ và chọn từ mở đầu ván.

- **Nguồn:** [Viet74K](https://github.com/duyet/vietnamese-wordlist) (Hồ Ngọc Đức, <https://www.informatik.uni-leipzig.de/~duc/software/misc/wordlist.html>), lọc còn các từ đúng 2 tiếng bằng `src/tools/build-noichu-words.ts`.
- **Giấy phép của danh sách này: GNU GPL v2** (xem [`LICENSE-GPL-2.0.txt`](LICENSE-GPL-2.0.txt)). Phần còn lại của be_game theo Apache-2.0 (`/LICENSE`). Danh sách được giữ riêng trong thư mục này, chỉ được nạp qua `../words.ts` như dữ liệu, không trộn vào mã khác.
- **Đã quyết định (2026-10-29):** chủ repo chấp nhận dùng danh sách GPL-2.0 làm file dữ liệu bên cạnh mã Apache-2.0. Đây là quyết định về rủi ro pháp lý của chủ repo, không phải ý kiến pháp lý. Nếu muốn bỏ GPL, thay `words.ts` bằng nguồn khác cùng định dạng (`WORDS_TEXT`, mỗi dòng một từ) và xóa thư mục này.
- **Tạo lại:** xem phần đầu của `src/tools/build-noichu-words.ts`. Không sửa `words.ts` bằng tay. Từ bổ sung do dự án tự soạn nằm ngoài thư mục này, ở `../extra.ts` (Apache-2.0), và được gộp khi nạp trong `../words.ts`.
