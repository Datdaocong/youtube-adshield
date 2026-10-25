# YT AdShield – Tool chặn quảng cáo YouTube

Extension trình duyệt (Chrome / Edge / Brave, Manifest V3) chặn quảng cáo trên
YouTube theo hướng **cắt quảng cáo ở lớp dữ liệu + ra lệnh cho server không trả
quảng cáo**, nên khó bị cơ chế phát hiện ad-block của YouTube để ý — kể cả cơ
chế "fake buffering" làm chậm video (SABR backoff) mà YouTube thử nghiệm từ 2025.

> Chỉ dùng cho mục đích cá nhân. Việc chặn quảng cáo có thể đi ngược điều khoản
> dịch vụ của YouTube — tự chịu rủi ro khi sử dụng.

## Cài đặt (2 phút)

1. Mở Chrome/Edge/Brave, vào `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode** ở góc trên.
3. Bấm **Load unpacked** → chọn thư mục `youtube-adshield` này.
4. Mở [youtube.com](https://www.youtube.com) và xem thử — nhớ **tải lại trang** sau khi cài/cập nhật.

Mở cài đặt: bấm icon extension trên thanh công cụ (hoặc chuột phải icon →
Tùy chọn / Options).

## Vì sao khó bị phát hiện

YouTube phát hiện adblock bằng: (1) thấy request quảng cáo bị chặn, (2) thấy
phần tử quảng cáo missing, (3) hộp thoại cảnh báo, và từ 2025 (4) **chậm tải
video có chủ đích** (SABR backoff dài đúng bằng thời lượng quảng cáo khi server
"biết" client chặn quảng cáo). Tool xử lý từng lớp:

| Lớp | Cách làm | Chống lại |
|---|---|---|
| Lớp dữ liệu (`content/main-world.js`) | Xoá `adPlacements`/`adSlots`/`playerAds` khỏi mọi JSON (bắt `JSON.parse`, `fetch().json()`, XHR, đặt bẫy `ytInitialPlayerResponse`/`ytInitialData`, re-prune sau mỗi lần điều hướng SPA) | Không có request quảng cáo nào được phát ra — không có gì "bị chặn" để lộ |
| Lớp yêu cầu (`isInlinePlaybackNoAd`) | Chèn cờ `isInlinePlaybackNoAd: true` vào body request `/youtubei/v1/player` → **server chủ động trả response sạch quảng cáo** và không áp backoff | Lớp chống "fake buffering" (4); đây cũng là hướng uBlock Origin đang dùng |
| Lớp mạng (`rules.json`) | Chặn domain quảng cáo thuần (`doubleclick`, `googlesyndication`…), video quảng cáo (`adformat=`, `ctier=L`)… | Tracking còn sót |
| Lớp giao diện (`content/isolate.js`) | ẩn khối quảng cáo còn kịp render; tự đóng hộp thoại cảnh báo, nhả khoá cuộn, giữ video phát | (2) và (3) |
| Lớp ngụy trang | Mọi hàm bị đè (`JSON.parse`, `JSON.stringify`, `Response.json`, XHR) đều được giả `toString()` trả `[native code]` + đồng bộ `name`/`length` | Integrity check dạng "hàm còn native không?" |
| Lớp Shorts | Gỡ entry trong feed Shorts có dấu `reelWatchEndpoint.adClientParams.isAd` | Quảng cáo Shorts |

**Vì sao đứng trước "locker script" của YouTube:** YouTube chèn một script
anti-tamper đầu `<head>` khóa các hàm native chống can thiệp. Content script
chạy ở `document_start` — tức là tool patch **trước** khi script đó chạy, nên
"bản gốc" mà nó khóa lại chính là bản đã qua xử lý của tool. Đây là lợi thế
về thứ tự chạy, không cần đấu tay đôi.

## Cấu trúc

```
youtube-adshield/
├── manifest.json            # MV3: DNR + storage + options page
├── rules.json               # Rule chặn mạng (DNR)
├── content/main-world.js    # Cắt dữ liệu quảng cáo + isInlinePlaybackNoAd + ngụy trang native
├── content/isolate.js       # Bơm CSS, tự đóng cảnh báo, bridge cấu hình
├── background.js            # Bấm icon -> mở trang cài đặt
├── options.html / options.js # Trang cài đặt (bật/tắt tính năng, thêm khóa dữ liệu)
└── README.md
```

## Bảo trì khi YouTube thay đổi

- **YouTube đổi tên trường dữ liệu** (nguy cơ hỏng số 1): mở trang cài đặt,
  thêm tên khóa mới vào ô "Khóa dữ liệu quảng cáo bổ sung" — không cần sửa code,
  có hiệu lực ngay, không cần tải lại extension. Cập nhật key theo
  [uAssets Quick Fixes](https://github.com/uBlockOrigin/uAssets/blob/master/filters/quick-fixes.txt)
  (tìm `json-prune ... youtube.com`).
- Mỗi tính năng đều bật/tắt được ở trang cài đặt — nếu một cơ chế mới của
  YouTube phản tác dụng, tắt đúng nút để khoanh vùng.

## Hạn chế cần biết

- **Quảng cáo ghép server-side (SSAI/SAI)** — quảng cáo nhúng thẳng vào luồng
  video — không chặn được bằng extension. Đến giữa 2026 YouTube vẫn thử nghiệm
  giới hạn, chưa triển khai đại trà; khi triển khai full thì không extension
  nào chặn nổi dạng này.
- Đây là cuộc đua vĩnh viễn: YouTube đổi cấu trúc dữ liệu/DOM thường xuyên.
- Nếu YouTube đổi sang kiểu phát hiện mới, các lớp ngụy trang + tự đóng cảnh
  báo là lớp đối phó — không có gì đảm bảo 100%.

## Muốn mạnh hơn?

**Firefox + uBlock Origin** vẫn là combo mạnh nhất (đội ngũ cập nhật filter +
scriptlet `trusted-*` mỗi ngày, có HTML filtering mà Chromium không cho phép).
Tool này dành cho ai muốn **tự sở hữu, tự chỉnh** một tool riêng trên Chrome,
và là nền tốt để mở rộng thêm (ví dụ dùng `chrome.declarativeNetRequest.updateDynamicRules`
để tự thêm rule mạng từ trang cài đặt).
