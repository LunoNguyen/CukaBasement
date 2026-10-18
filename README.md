# CukaBasement

## Cài đặt

**Yêu cầu:** Node.js (theo `engines` trong `package.json`), MongoDB đang chạy với database `CukaDB`, MinIO đang chạy local, và ffmpeg có trong `PATH`. Redis là tuỳ chọn (xem [Redis](#redis-cache-không-bắt-buộc)).

**CORS cho MinIO:** cho phép origin của `APP_URL` (mặc định `http://localhost:5173`) thực hiện POST, để trình duyệt upload trực tiếp lên MinIO.

```sh
cp .env.example .env        # rồi chỉnh các giá trị cho phù hợp
npm install                 # tự build packages/shared (script prepare)
npm run setup               # tạo index MongoDB, bucket MinIO và settings (chạy lại an toàn)
npm run create-admin -- --email <email> --password <mật khẩu> --username <tên>
npm run dev                 # chạy song song shared, api, worker, web
```

API, worker và các script `setup` / `create-admin` đều đọc file `.env` ở thư mục gốc.

**Lưu ý khi dev worker:** worker chạy code job từ bản build của `apps/api` (`apps/api/dist`). `npm run dev` của api build lại `dist` khi bạn sửa `apps/api/src`, nhưng worker không tự khởi động lại — sau khi sửa job handler (`apps/api/src/jobs/...`) hay code mà worker dùng, hãy khởi động lại worker (dừng `npm run dev` rồi chạy lại, hoặc chạy riêng `npm -w @cuka/worker run dev`).

Các lệnh khác: `npm run build`, `npm test`, `npm run type-check`.

**Liên kết hồ sơ:** hồ sơ giờ lưu danh sách liên kết có thứ tự (tối đa 10). Hồ sơ cũ (các ô X/Facebook/YouTube/pixiv cố định) vẫn hiển thị bình thường; `npm run setup` chuyển chúng sang danh sách mới (chạy lại an toàn), hoặc chúng được chuyển khi người dùng lưu liên kết lần đầu.

## Redis (cache, không bắt buộc)

API cache trang chủ, kết quả tìm kiếm và trang tag (chỉ phần công khai, khoảng 45 giây) trong Redis. Redis tắt hoặc không kết nối được thì API vẫn chạy và đọc thẳng MongoDB (log cảnh báo tối đa mỗi phút một lần). Duyệt/ẩn/xoá bài, đổi rating, báo cáo tự ẩn, khoá tài khoản... làm mới cache ngay.

Trong `.env`:

```sh
REDIS_URL=redis://localhost:6379          # mặc định; có mật khẩu: redis://:<mật khẩu>@<host>:6379/0
# REDIS_DISABLED=true                     # tắt hẳn cache
```

**Windows:** không cần cài Memurai, Redis trên WSL hay Docker — nếu bạn đã có Redis chạy và mở cổng (vd. `192.168.1.10:6379`), chỉ cần đặt `REDIS_URL=redis://192.168.1.10:6379` (thêm mật khẩu nếu Redis có đặt). Worker dùng cùng `REDIS_URL` để làm mới cache khi xử lý ảnh xong.

Test (`npm test`) không cần Redis. Riêng `apps/api/test/feed-cache.e2e.test.ts` chạy thêm các test với Redis thật nếu có Redis ở `REDIS_URL_TEST` (mặc định `redis://127.0.0.1:6379/15` — **database 15 bị xoá sạch** khi test), không có thì bỏ qua.

## Frontend (apps/web)

**Chạy web:** `npm run dev` (chạy cả shared, api, worker và web) rồi mở http://localhost:5173. Vite proxy `/api` và `/og` sang api ở cổng 3000 (`API_PORT`). Chỉ chạy riêng web: `npm -w @cuka/web run dev` (api vẫn phải đang chạy).

**Nhắc lại về CORS của MinIO:** trình duyệt upload thẳng lên MinIO bằng POST (presigned), nên MinIO phải cho phép origin `http://localhost:5173` (giá trị `APP_URL`). MinIO mặc định cho phép mọi origin; nếu đã giới hạn mà upload báo lỗi CORS, đặt biến `MINIO_API_CORS_ALLOW_ORIGIN` khi khởi động MinIO (hoặc `mc admin config set <alias> api cors_allow_origin=http://localhost:5173`) rồi khởi động lại MinIO với cùng thư mục dữ liệu.

Ví dụ trên Linux:

```sh
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:5173 \
  minio server /var/lib/cuka/minio --address 127.0.0.1:9000 --console-address 127.0.0.1:9001
```

Trên Windows (PowerShell), đặt biến trước rồi chạy `minio server` với thư mục dữ liệu của bạn:

```powershell
$env:MINIO_ROOT_USER='minioadmin'; $env:MINIO_ROOT_PASSWORD='minioadmin'
$env:MINIO_API_CORS_ALLOW_ORIGIN='http://localhost:5173'
minio server D:\minio-data --console-address :9001
```

Test của web (`npm -w @cuka/web test`, vitest + jsdom) dùng fetch giả, không cần api.

### Test end-to-end (Playwright)

Smoke test `apps/web/e2e/smoke.spec.ts` đi hết luồng: đăng ký → xác thực (đánh dấu trực tiếp trong MongoDB vì mail chỉ in ra console của api) → đăng nhập → upload một ảnh đăng lại có credit → moderator duyệt ở `/mod` → bài hiện ở trang chủ khi chưa đăng nhập và ảnh (đã đóng watermark credit bởi worker) tải được.

E2E **không** nằm trong `npm test` và không tự khởi động gì. Bạn tự chạy stack với một database riêng có tên kết thúc bằng `_test` (không bao giờ dùng `CukaDB`) và bucket riêng. `MONGODB_URI` là **bắt buộc** khi chạy e2e và phải trùng với database api đang dùng: trước khi ghi gì, test chèn một user thăm dò vào database đó và đăng nhập qua api; nếu api dùng database khác, test dừng ngay với lỗi `API is not using <db>`.

Các biến dưới đây chỉ ghi đè một phần; api và worker vẫn cần phần còn lại của `.env` (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, các biến `MINIO_*`, `APP_URL`, `MINIO_PUBLIC_URL`...), hoặc bạn đặt chúng cùng cách.

Linux/macOS (bash):

```sh
export MONGODB_URI=mongodb://127.0.0.1:27017/CukaE2E_test
export MINIO_BUCKET_ORIGINALS=e2e-cuka-originals MINIO_BUCKET_PUBLIC=e2e-cuka-public
export THROTTLE_DISABLED=true   # chạy lại nhiều lần không bị giới hạn đăng ký
npm run setup
npm run dev                     # để chạy ở một terminal khác (cùng các biến trên)
npm -w @cuka/web run e2e        # cùng MONGODB_URI với api
```

Windows (PowerShell) — đặt biến trong **mỗi** cửa sổ PowerShell dùng để chạy `npm run dev` và `npm -w @cuka/web run e2e`:

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/CukaE2E_test'
$env:MINIO_BUCKET_ORIGINALS='e2e-cuka-originals'; $env:MINIO_BUCKET_PUBLIC='e2e-cuka-public'
$env:THROTTLE_DISABLED='true'
npm run setup
npm run dev                     # cửa sổ 1
npm -w @cuka/web run e2e        # cửa sổ 2 (cùng $env:MONGODB_URI)
```

Playwright dùng Chromium ở `/opt/pw-browsers/chromium` nếu có (container dev). Ở máy khác, cài trình duyệt một lần: `npm -w @cuka/web exec playwright install chromium`. Xong việc có thể xoá database `CukaE2E_test` và các bucket `e2e-*`.
