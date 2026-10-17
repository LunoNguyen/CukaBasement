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
