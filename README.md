# CukaBasement

## Cài đặt

**Yêu cầu:** Node.js (theo `engines` trong `package.json`), MongoDB đang chạy với database `CukaDB`, MinIO đang chạy local, và ffmpeg có trong `PATH`.

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

## Frontend (apps/web)

**Chạy web:** `npm run dev` (chạy cả shared, api, worker và web) rồi mở http://localhost:5173. Vite proxy `/api` và `/og` sang api ở cổng 3000 (`API_PORT`). Chỉ chạy riêng web: `npm -w @cuka/web run dev` (api vẫn phải đang chạy).

**Nhắc lại về CORS của MinIO:** trình duyệt upload thẳng lên MinIO bằng POST (presigned), nên MinIO phải cho phép origin `http://localhost:5173` (giá trị `APP_URL`). MinIO mặc định cho phép mọi origin; nếu đã giới hạn mà upload báo lỗi CORS, đặt biến `MINIO_API_CORS_ALLOW_ORIGIN` khi khởi động MinIO (hoặc `mc admin config set <alias> api cors_allow_origin=http://localhost:5173`) rồi khởi động lại MinIO với cùng thư mục dữ liệu, ví dụ:

```sh
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:5173 \
  minio server /var/lib/cuka/minio --address 127.0.0.1:9000 --console-address 127.0.0.1:9001
```

Test của web (`npm -w @cuka/web test`, vitest + jsdom) dùng fetch giả, không cần api.

### Test end-to-end (Playwright)

Smoke test `apps/web/e2e/smoke.spec.ts` đi hết luồng: đăng ký → xác thực (đánh dấu trực tiếp trong MongoDB vì mail chỉ in ra console của api) → đăng nhập → upload một ảnh đăng lại có credit → moderator duyệt ở `/mod` → bài hiện ở trang chủ khi chưa đăng nhập và ảnh (đã đóng watermark credit bởi worker) tải được. E2E **không** nằm trong `npm test` và không tự khởi động gì — hãy tự chạy stack với một database riêng có tên kết thúc bằng `_test` (helper từ chối mọi tên khác, không bao giờ dùng `CukaDB`) và bucket riêng:

```sh
export MONGODB_URI=mongodb://127.0.0.1:27017/CukaE2E_test
export MINIO_BUCKET_ORIGINALS=e2e-cuka-originals MINIO_BUCKET_PUBLIC=e2e-cuka-public
export THROTTLE_DISABLED=true   # chạy lại nhiều lần không bị giới hạn đăng ký
npm run setup
npm run dev                     # để chạy ở một terminal khác (cùng các biến trên)
npm -w @cuka/web run e2e        # cùng MONGODB_URI với api
```

Playwright dùng Chromium ở `/opt/pw-browsers/chromium` nếu có (container dev), nếu không thì dùng bản cài bởi `npx playwright install chromium`. Xong việc có thể xoá database `CukaE2E_test` và các bucket `e2e-*`.
