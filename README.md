# YT AdShield – Tool chặn quảng cáo YouTube

Extension trình duyệt (Chrome / Edge / Brave, Manifest V3) chặn quảng cáo trên
YouTube theo hướng **cắt quảng cáo ở lớp dữ liệu + ra lệnh cho server không trả
quảng cáo**, nên khó bị cơ chế phát hiện ad-block của YouTube để ý — kể cả cơ
chế "fake buffering" làm chậm video (SABR backoff) mà YouTube thử nghiệm từ 2025.

Kèm theo: **tự bỏ qua phân đoạn tài trợ bằng dữ liệu cộng đồng (SponsorBlock)**,
badge đếm số quảng cáo đã chặn, và trang cài đặt cho phép chỉnh mọi thứ lúc chạy.

> Chỉ dùng cho mục đích cá nhân. Việc chặn quảng cáo có thể đi ngược điều khoản
> dịch vụ của YouTube — tự chịu rủi ro khi sử dụng.

## Cài đặt (2 phút)

1. Mở Chrome/Edge/Brave, vào `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode** ở góc trên.
3. Bấm **Load unpacked** → chọn thư mục `youtube-adshield` này.
4. Mở [youtube.com](https://www.youtube.com) và xem thử — nhớ **tải lại trang** sau khi cài/cập nhật.

Mở cài đặt: bấm icon extension trên thanh công cụ (badge đỏ hiển thị tổng số
quảng cáo/dữ liệu quảng cáo đã bị cắt).

## Tính năng

| Tính năng | Cơ chế |
|---|---|
| Cắt quảng cáo khỏi dữ liệu | Xoá `adPlacements`/`adSlots`/`playerAds` khỏi mọi JSON (`JSON.parse`, `fetch().json()`, XHR), đặt bẫy `ytInitialPlayerResponse`/`ytInitialData`, re-prune sau mỗi điều hướng SPA |
| Chống "fake buffering" | Chèn `isInlinePlaybackNoAd: true` vào request `/youtubei/v1/player` → server trả response sạch quảng cáo, không áp SABR backoff |
| Gỡ quảng cáo Shorts | Loại entry feed Shorts có `reelWatchEndpoint.adClientParams.isAd` |
| Bỏ qua phân đoạn tài trợ | SponsorBlock (dữ liệu cộng đồng từ `sponsor.ajay.app`, chỉ gửi videoId, có cache 30 phút) — tự seek qua đoạn sponsor/tự quảng bá/kêu gọi tương tác, có toast thông báo |
| Chặn mạng | declarativeNetRequest: `doubleclick`, `googlesyndication`, video quảng cáo (`adformat=`, `ctier=L`)… + domain tùy chỉnh từ trang cài đặt |
| Ngụy trang native | Mọi hàm bị đè trả `toString()` `[native code]`, đồng bộ `name`/`length` |
| Tự đóng cảnh báo | Gỡ hộp thoại "phát hiện ad-block" / "Experiencing interruptions" / upsell Premium, nhả khoá cuộn, tự phát lại video |
| Sở hữu cá nhân | Mọi tính năng bật/tắt ở trang options; thêm khóa dữ liệu/domain chặn không cần sửa code |

## Vì sao khó bị phát hiện

YouTube phát hiện adblock bằng: (1) thấy request quảng cáo bị chặn, (2) thấy
phần tử quảng cáo missing, (3) hộp thoại cảnh báo, và từ 2025 (4) **chậm tải
video có chủ đích** (SABR backoff dài đúng bằng thời lượng quảng cáo khi server
"biết" client chặn quảng cáo). Tool xử lý từng lớp:

| Lớp | Cách làm | Chống lại |
|---|---|---|
| Lớp dữ liệu (`content/main-world.js`) | Xoá các trường quảng cáo khỏi mọi JSON trước khi player nhìn thấy | Không có request quảng cáo nào được phát ra — không có gì "bị chặn" để lộ |
| Lớp yêu cầu (`isInlinePlaybackNoAd`) | Server chủ động trả response sạch quảng cáo | (4) — hướng uBlock Origin đang dùng |
| Lớp mạng (`rules.json` + dynamic rules) | Chặn domain quảng cáo thuần; cố tình không chặn beacon chung chung để giữ "hồ sơ client" nhất quán | Tracking còn sót |
| Lớp giao diện (`content/isolate.js`) | ẩn khối quảng cáo còn kịp render; tự đóng hộp thoại; giữ video phát | (2) và (3) |
| Lớp ngụy trang | `toString`/`name`/`length` giống hệt native | Integrity check |
| Lớp cộng đồng (SponsorBlock) | Bỏ qua phân đoạn bằng thời lượng cố định từ API cộng đồng | Hoạt động kể cả khi YouTube đổi mọi thứ, kể cả quảng cáo ghép server-side nếu cộng đồng đánh dấu |

**Vì sao đứng trước "locker script" của YouTube:** YouTube chèn một script
anti-tamper đầu `<head>` khóa các hàm native chống can thiệp. Content script
chạy ở `document_start` — tức là tool patch **trước** khi script đó chạy, nên
"bản gốc" mà nó khóa lại chính là bản đã qua xử lý của tool.

## Cấu trúc

```
youtube-adshield/
├── manifest.json             # MV3: DNR + storage + host sponsor.ajay.app
├── rules.json                # Rule chặn mạng tĩnh (DNR)
├── content/main-world.js     # Cắt dữ liệu quảng cáo + isInlinePlaybackNoAd + ngụy trang native
├── content/isolate.js        # CSS, tự đóng cảnh báo, SponsorBlock skip, bridge cấu hình
├── background.js             # Badge bộ đếm, cache SponsorBlock, dynamic rules
├── options.html / options.js # Trang cài đặt
└── README.md
```

## Bảo trì khi YouTube thay đổi

- **YouTube đổi tên trường dữ liệu** (nguy cơ hỏng số 1): mở trang cài đặt,
  thêm tên khóa mới vào ô "Khóa dữ liệu quảng cáo bổ sung" — hiệu lực ngay.
  Cập nhật key theo
  [uAssets Quick Fixes](https://github.com/uBlockOrigin/uAssets/blob/master/filters/quick-fixes.txt)
  (tìm `json-prune ... youtube.com`).
- Thêm domain chặn tại ô "Chặn thêm domain" — tạo dynamic rules ngay khi lưu.
- Mỗi tính năng đều bật/tắt được ở trang cài đặt — nếu một cơ chế mới của
  YouTube phản tác dụng, tắt đúng nút để khoanh vùng.

## Hạn chế cần biết

- **Quảng cáo ghép server-side (SSAI/SAI)** — quảng cáo nhúng thẳng vào luồng
  video — không chặn được bằng extension; với dạng này, lớp SponsorBlock là
  phương án giảm nhẹ duy nhất (nếu cộng đồng đánh dấu được phân đoạn).
- SponsorBlock là dữ liệu cộng đồng: có thể thiếu phân đoạn ở video ít người xem.
- Đây là cuộc đua vĩnh viễn: YouTube đổi cấu trúc dữ liệu/DOM thường xuyên.

## Muốn mạnh hơn?

**Firefox + uBlock Origin** vẫn là combo mạnh nhất (đội ngũ cập nhật filter +
scriptlet `trusted-*` mỗi ngày, có HTML filtering mà Chromium không cho phép).
Tool này dành cho ai muốn **tự sở hữu, tự chỉnh** một tool riêng trên Chrome.
