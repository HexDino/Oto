# EcoTek Study Agent (Chrome Extension – Manifest V3)

Agent hỗ trợ học trên `https://hoclythuyetlaixe.eco-tek.com.vn/`:

1. **Tự động chuyển bài** khi đồng hồ đếm ngược của bài kết thúc.
2. **Gợi ý đáp án trắc nghiệm**: đọc câu hỏi + đáp án, tô sáng lựa chọn kèm độ tin cậy và giải thích, ghi log để ôn tập.

Chỉ chạy trên domain đã chỉ định. Mặc định xử lý cục bộ, không gửi dữ liệu ra ngoài.

## Cài đặt nhanh trên máy khác

```bash
git clone https://github.com/HexDino/Oto.git
cd Oto
cp config.example.js config.local.js     # rồi dán API key Claude vào
```

Mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục vừa clone.

> `config.local.js` **không** nằm trong repo (đã gitignore). Thiếu file này extension vẫn chạy bình thường, chỉ tắt provider Claude và quay về suy luận cục bộ.

---

## 0. Trang này thực sự hoạt động thế nào (đã kiểm chứng bằng tài khoản thật)

Đây là **Odoo eLearning** (`o_wslides_*`) + một module riêng của EcoTek (`ect_employees`) chèn widget đếm ngược vào nội dung bài.

```
POST /slide/countdown-start/  {slide_id}
   → {result: {end_time: <epoch giây>, no_make_attend: bool}}
   → hoặc {result: 0}   (bài đã đủ giờ hôm nay, không cần chờ)

... đồng hồ chạy tới end_time, vẽ bằng <canvas> ...

POST /slide/countdown-end/    {slide_id, active_slide_id}   ← ghi nhận giờ học
POST /api/get_auto_next_slide → {result: {auto_next_slide: bool}}
   nếu true: sau 5 giây trang TỰ BẤM  a#next-slide-button
```

Ba điều quan trọng rút ra:

- **Đồng hồ không nằm trong DOM.** Nó là 3 `<canvas>` trong `section.ect_countdown`, chữ được vẽ bằng `fillText`. `data-end-time` trên thẻ section là **cấu hình cũ đã hết hạn** (2024), không phải giờ thật. Mọi extension đọc text trên trang sẽ **không bao giờ** thấy đồng hồ này.
- **Giờ thật chỉ có trong JS của trang** (`end_time` từ API). Content script chạy ở isolated world không đọc được biến đó → phải có hook ở MAIN world.
- **Trang đã có sẵn cơ chế tự chuyển bài**, bật/tắt bằng cờ server `auto_next_slide`. Nếu cờ bật, sau khi hết giờ trang tự bấm nút sau 5 giây; extension chỉ cần đứng ngoài. Nếu cờ tắt, extension bấm thay.

Thêm hai cơ chế giám sát của trang:

- **Camera**: không bật camera thì sau ~60 giây trang tự thoát bài về trang khóa học. Extension **không** lách cơ chế này, chỉ cảnh báo trên bảng nổi.
- **Inactivity**: không tương tác một lúc sẽ hiện `#inactivity-popup` và **tạm dừng ghi nhận giờ học**. Extension cảnh báo, không tự bấm "tiếp tục".

## 1. Cấu trúc file

```
ecotek-study-agent/
├── manifest.json              # MV3: quyền, content script, action popup
├── background.js              # service worker: defaults, badge, inject hook, proxy API LLM
├── inject/
│   └── hook.js                # MAIN world: bắt /slide/countdown-start/ + đọc canvas
├── content/
│   ├── 01-inject.js           # document_start: xin quyền inject hook, đệm message
│   ├── 00-core.js             # settings/storage, normalize tiếng Việt, history, KB
│   ├── 10-dom.js              # tìm phần tử chịu lỗi, click, modal, navSignature
│   ├── 20-timer.js            # đếm ngược (API → canvas → DOM) + logic chuyển bài
│   ├── 30-quiz.js             # trích câu hỏi/đáp án, tô sáng, auto-select, log
│   ├── 40-hud.js              # bảng nổi trong trang (shadow DOM)
│   ├── 99-main.js             # bootstrap, observers, message với popup
│   └── agent.css              # style tô sáng đáp án
├── lib/
│   └── answer-engine.js       # chấm điểm đáp án cục bộ + tra kho đã học
├── popup/
│   ├── popup.html / popup.css / popup.js
└── icons/
```

Thứ tự nạp content script quan trọng: `01-inject (document_start) → core → dom → engine → timer → quiz → hud → main`.

## 2. Quyền và lý do

| Quyền | Dùng để |
|---|---|
| `storage` | lưu cài đặt (sync), lịch sử câu hỏi + kho đáp án (local) |
| `activeTab`, `scripting` | gửi lệnh từ popup; **inject `inject/hook.js` vào MAIN world** |
| `host_permissions: https://hoclythuyetlaixe.eco-tek.com.vn/*` | chỉ chạy trên domain này |
| `host_permissions: https://api.anthropic.com/*` | gọi Claude khi chọn provider `claude` |
| `optional_host_permissions: https://*/*` | **chỉ khi** bật chế độ API LLM khác; quyền xin lúc bấm "Lưu & cấp quyền" |

Không đọc cookie, không gửi dữ liệu đi đâu nếu bạn không cấu hình API.

## 3. Cài đặt

1. `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `ecotek-study-agent`.
3. Ghim extension lên thanh công cụ. Badge hiện `ON`.
4. Tải lại tab học (Ctrl+R).

## 4. Sử dụng

- **Popup**: trạng thái realtime (còn bao nhiêu giây, nguồn đọc được là `api`/`canvas`/`dom`, đã chuyển mấy lần), bật/tắt từng tính năng, thời gian đệm, ngưỡng tự chọn đáp án, lịch sử + xuất JSON/CSV.
- **Bảng nổi** góc phải dưới: giờ còn lại, gợi ý đáp án, dòng "Lưu ý" (camera / tạm dừng ghi nhận), nút chuyển bài tay và nút hủy đếm ngược.
- **Quét trang**: dump những gì agent nhìn thấy (nút, đồng hồ, khối câu hỏi) — dùng khi trang đổi giao diện.

## 5. Cơ chế đọc giờ (3 lớp, tự hạ cấp)

1. **API (chính xác nhất)** — hook bắt response `POST /slide/countdown-start/`, lấy `end_time`. Đây là giờ thật của server.
2. **Canvas (dự phòng)** — hook bắt `fillText` trên các canvas `ect_countdown_canvas_flex`, ghép lại thành giờ:phút:giây. Dùng khi response đến trước lúc hook kịp cài, hoặc server đổi định dạng. Nếu canvas lệch API > 10 giây thì tin canvas (trường hợp server gia hạn phiên).
3. **DOM text (dự phòng chung)** — quét text dạng `mm:ss` và chỉ "khoá" khi thấy giá trị giảm ≥ 2 lần liên tiếp. Không dùng cho trang này nhưng giữ để extension không chết nếu widget đổi.

Khi hết giờ: chờ `max(thời gian đệm, 7 giây)` — 7 giây để trang kịp tự chuyển nếu `auto_next_slide` bật — rồi nếu vẫn ở bài cũ mới bấm `#next-slide-button`.

**Đã kiểm chứng trên trang thật** (tài khoản của bạn, 31/10/2026):

- Hook bắt được `end_time` thật; HUD đếm đúng từ `9:59` xuống.
- Ép `end_time` về `now + 10s` để test: HUD `0:09 → 0:00`, dừng 7 giây, bấm `#next-slide-button`, nhảy sang bài kế tiếp ở giây thứ 18.
- Bấm tay nút "Chuyển bài" trên bảng nổi: nhảy đúng sang bài sau.
- Mỗi slide yêu cầu **10 phút** (không phải 2 phút như tôi đoán ban đầu).

## 6. Gợi ý đáp án

- Ưu tiên kho cá nhân: câu nào trang đã báo đáp án đúng thì lần sau gợi ý với độ tin cậy 96%.
- Chưa có thì heuristic: đáp án tổng hợp, khớp số liệu, hướng xử lý an toàn, trùng từ khoá, độ dài. Độ tin cậy **chặn ở 62%** — vì nó đoán.
- Chỉ tô sáng (viền + vạch xanh, không đổi layout). Chỉ tự bấm khi bật "Tự động chọn đáp án" **và** vượt ngưỡng.

### 6.1 Bảng chọn đáp án trong popup

Khi trang có câu hỏi, tab **Điều khiển** hiện thêm khối "Câu hỏi đang mở":

- Câu hỏi + 4 đáp án, đáp án gợi ý được viền xanh kèm badge tin cậy.
- Bấm **A/B/C/D** để chọn ngay từ popup (không cần chạm vào trang).
- **Copy câu hỏi** → dán sang WorkBuddy/chat khác, nhận lại "B", dán vào ô *"Dán câu trả lời của WorkBuddy"* → extension tự tick đúng đáp án đó.
- **Chọn gợi ý** → chọn theo đáp án engine đề xuất (kể cả khi chưa bật tự động chọn).

Luồng copy/paste này không gửi dữ liệu đi đâu cả — nó chỉ dùng clipboard của bạn.

### 6.2 Vì sao chưa "gọi WorkBuddy" trực tiếp

WorkBuddy không có API công khai để một extension Chrome gọi vào. Ba đường thay thế:

| Cách | Tự động | Dữ liệu ra ngoài | Ghi chú |
|---|---|---|---|
| Copy/paste thủ công (đã có) | Không | Không | Chạy ngay, không cần key |
| API OpenAI-compatible trong Cài đặt | Có | Có (tới endpoint bạn chọn) | Dùng được Ollama/LM Studio local → vẫn offline |
| WorkBuddy cloud-service | Có | Có | Phải deploy một service nhỏ, quá tay cho việc này |

### 6.3 Claude Haiku 5.5 + Agent điều khiển tab

**Cấu hình** — file `config.local.js` ở gốc extension (copy từ `config.example.js`):

```js
self.ECO_CONFIG = {
  claude: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-5-5',
    apiVersion: '2023-06-01',
    maxTokens: 400,
    keys: ['sk-ant-...', 'sk-ant-...']   // xoay vòng khi key trước lỗi 401/429/5xx
  }
};
```

Background nạp file này bằng `importScripts`, giữ key trong service worker — key **không** lọt vào content script hay trang web. Nếu key #1 lỗi 401/403/429/5xx thì tự thử key #2, key thành công được ghi nhớ cho lần sau.

Hai chi tiết bắt buộc khi gọi từ extension (đã xử lý trong code):

- Header `anthropic-dangerous-direct-browser-access: true` — thiếu là 401 `CORS requests must set ...`.
- **Không gửi `temperature`** — Haiku 5.5 đã bỏ tham số này, gửi vào là 400.

**Kiểm tra**: popup → tab Cài đặt → **Test Claude**. Kết quả mẫu: `OK · claude-haiku-5-5 · 1240ms · đáp án A (98%)`.

**Agent mode** (popup → Điều khiển → "Agent tự trả lời"):

| Chế độ | Hành vi |
|---|---|
| `off` | Tắt |
| `assist` | Hỏi Claude, tô sáng đáp án, **không** bấm |
| `auto` | Hỏi Claude rồi **tự bấm** đáp án |

Vòng lặp chạy mỗi `agentIntervalMs` (mặc định 1500ms), mỗi câu hỏi chỉ xử lý một lần (khoá theo `signature`), dừng khi tắt agent hoặc đạt `agentMaxSteps`.

Agent **không tự nộp bài** và **không lách** camera/inactivity. Nộp bài là việc của bạn.

**Đã test**: trang quiz giả lập gắn vào đúng domain → Claude trả `B (97%)` → extension tick đúng ô B, HUD hiện `Tự chọn B · Agent đang chạy · auto`.

> **Chưa kiểm chứng được phần quiz**: tài khoản hiện tại chỉ có 1 khóa (Đạo đức người lái xe) với slide PDF/YouTube, không có slide trắc nghiệm. Phần đọc câu hỏi dùng heuristic chung (radio group + fallback theo class), sẽ cần chỉnh khi gặp slide quiz thật.

### 6.4 Watchdog hiện diện (không phải auto-scroll)

Trang có popup `#inactivity-popup`: không tương tác một lúc thì đồng hồ ghi nhận giờ **tạm dừng** cho tới khi bấm "tiếp tục". Extension **không** tự cuộn trang hay tự bấm hộ — làm vậy là đánh lừa bộ đếm hiện diện.

Thay vào đó `content/45-presence.js` chỉ **báo động**:

- Đọc ngưỡng inactivity thật của trang (`alert_time_no_interaction`, trang cache trong `localStorage`, lấy từ `POST /employee/check_alert_time_no_interaction`) → hiện đếm ngược "Còn ~Xs trước khi đồng hồ tạm dừng".
- Không đọc được ngưỡng thì dùng mốc 60 giây không tương tác.
- Popup xuất hiện → bảng nổi báo đỏ "Đồng hồ ĐANG TẠM DỪNG", tiêu đề tab nhấp nháy, badge extension chuyển `!` đỏ, **bắn notification desktop** (nổi lên cả khi bạn đang ở app khác) **và tiếng bíp**.
- Còn tạm dừng thì **30 giây nhắc lại một lần** (notification mới đè notification cũ) cho tới khi bạn quay lại — để không bị quên khi đang làm việc ở tab khác.
- Bấm "tiếp tục" xong → badge về `ON`, toàn bộ notification tự xoá, báo "Đã tiếp tục ghi nhận giờ học".

Mục đích: bạn đi vệ sinh hay chuyển tab làm việc thì biết mà quay lại, không mất thêm thời gian vì tưởng đồng hồ vẫn chạy.

> Cần quyền `notifications`. Sau khi cập nhật, Chrome sẽ hỏi lại quyền khi bạn bấm ↻.

## 7. Chế độ API (tùy chọn)

Cài đặt → Nguồn gợi ý → **API LLM**, endpoint dạng OpenAI-compatible (`https://api.openai.com/v1`), model, key. Bấm **Lưu & cấp quyền** để Chrome cấp quyền đúng origin đó. Request do background gửi (key không lộ vào trang), yêu cầu trả JSON `{answer, confidence, explanation}`; lỗi thì tự fallback về cục bộ.

## 8. Giới hạn

- Không lách camera hay popup chống inactivity — đó là cơ chế giám sát của trung tâm.
- Câu hỏi chỉ có ảnh biển báo, không có chữ → không giải được (cần vision model).
- Heuristic cục bộ đúng khoảng 50–65%.
- Nếu trang đổi widget đếm ngược, dùng **Quét trang** để gửi lại cấu trúc.

## 9. Troubleshooting

| Hiện tượng | Xử lý |
|---|---|
| "Chưa thấy đồng hồ" | Kiểm tra tab đã đăng nhập; xem `window.__ECO_CAPTURED` trong console để biết hook có bắt được API |
| Bảng nổi báo "Slide đã đủ giờ hôm nay" | Server trả `result: 0` — bài này không cần chờ, bấm chuyển được ngay |
| Bấm chuyển bài không ăn | Kiểm tra `#next-slide-button` có class `disabled` không |
| Bị đá về trang khóa học sau ~1 phút | Chưa bật camera — trang tự thoát, không phải lỗi extension |
