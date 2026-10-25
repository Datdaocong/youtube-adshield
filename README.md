# YT AdShield – Tool chặn quảng cáo YouTube

Extension trình duyệt (Chrome / Edge / Brave, Manifest V3) chặn quảng cáo trên
YouTube theo hướng **cắt quảng cáo ở lớp dữ liệu**, nên khó bị cơ chế phát hiện
ad-block của YouTube để ý.

> Chỉ dùng cho mục đích cá nhân. Việc chặn quảng cáo có thể đi ngược điều khoản
> dịch vụ của YouTube — tự chịu rủi ro khi sử dụng.

## Cài đặt (2 phút)

1. Mở Chrome/Edge/Brave, vào `chrome://extensions` (Edge: `edge://extensions`).
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục `youtube-adshield` này.
4. Mở [youtube.com](https://www.youtube.com) và xem thử — nhớ **tải lại trang** sau khi cài.

Không cần API key, không cần cài thêm gì.

## Vì sao khó bị phát hiện

YouTube phát hiện adblock chủ yếu bằng cách: (1) thấy request quảng cáo bị
chặn/lỗi, (2) thấy phần tử quảng cáo bị ẩn/missing, (3) hiện hộp thoại
"Ad blockers are not allowed". Tool xử lý cả ba:

| Lớp | Cách làm | Tại sao không lộ |
|---|---|---|
| Lớp dữ liệu (`content/main-world.js`) | Chạy trước mọi script của YouTube, xoá các trường `adPlacements` / `adSlots` / `playerAds` khỏi mọi phản hồi JSON (bắt `JSON.parse`, `fetch().json()`, XHR, và đặt bẫy cho `ytInitialPlayerResponse` / `ytInitialData`) | Player **không bao giờ nhận lệnh chèn quảng cáo**, nên không có request quảng cáo nào được phát ra — không có gì "bị chặn" để lộ |
| Lớp mạng (`rules.json`, declarativeNetRequest) | Chặn luôn các domain/endpoint quảng cáo (`doubleclick.net`, `googleads.g…`, `/api/stats/ads`, `pagead`, video quảng cáo có tham số `adformat=`…) | Loại bỏ tracking/thử nghiệm quảng cáo còn sót |
| Lớp giao diện (`styles.css` + `content/isolate.js`) | ẩn khối quảng cáo còn kịp render; tự đóng hộp thoại cảnh báo, nhả khoá cuộn, giữ video phát tiếp | Cảnh báo bị gỡ trong vài trăm ms trước khi người dùng nhìn thấy |

## Hạn chế cần biết (đọc kỹ)

- **Quảng cáo ghép server-side (SAI)** — quảng cáo nhúng thẳng vào luồng video
  (thường gặp trên livestream và đang mở rộng dần) — không chặn được bằng
  extension, vì nó đi trong chính luồng video. Không tool dạng extension nào
  chặn nổi dạng này một cách sạch sẽ.
- Đây là **cuộc đua vĩnh viễn**: YouTube đổi cấu trúc dữ liệu/DOM thường xuyên.
  Khi tool hao hao hết tác dụng, việc cần làm là cập nhật danh sách key trong
  `AD_KEYS` (`content/main-world.js`), thêm rule trong `rules.json` hoặc thêm
  selector trong `styles.css`.
- Nếu YouTube đổi sang kiểu phát hiện mới, lớp `isolate.js` (tự đóng hộp thoại,
  tự phát lại video) là lớp đối phó — nhưng không có gì đảm bảo 100%.

## Cấu trúc

```
youtube-adshield/
├── manifest.json            # MV3, chỉ xin quyền declarativeNetRequest
├── rules.json               # Rule chặn mạng (DNR)
├── content/main-world.js    # Cắt dữ liệu quảng cáo TRƯỚC khi player thấy (lớp chính)
├── content/isolate.js       # Tự đóng cảnh báo, giữ video phát
├── styles.css               # ẩn quảng cáo còn kịp render
└── README.md
```

## Muốn mạnh hơn?

- **Firefox + uBlock Origin** vẫn là combo mạnh nhất hiện nay (uBlock Origin có
  đội ngũ cập nhật filter + scriptlet chống anti-adblock liên tục). Tool này
  dành cho ai muốn **tự sở hữu và tự chỉnh** một tool riêng trên Chrome.
- Có thể mở rộng `AD_KEYS`/rules từ các filter list mở (EasyList, uAssets
  Quick Fixes) — xem thử cách họ prune JSON để học thêm.
