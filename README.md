# CukaBasement

Trang chia sẻ fanart kiểu pixiv cho cộng đồng Cuka, fan của VTuber [Hibiki Du Ca](https://www.youtube.com/@hibikiduca). **Không nhận tranh AI.**

## Tính năng

- **Đăng bài:** tranh, video, âm thanh, file nguồn (PSD/CLIP/ZIP), tối đa 50 MB/tệp. Bài đăng lại phải ghi nguồn tác giả; tên và nền tảng của tác giả được đóng lên ảnh.
- **Kiểm duyệt:** bài mới chỉ lên trang chủ, tìm kiếm và tag sau khi được duyệt. Người dùng báo cáo được (mỗi người một lần mỗi bài). Bài tự ẩn khi có 5 báo cáo, hoặc 3 báo cáo "tranh AI".
- **R18:** ẩn mặc định, người dùng tự bật trong Cài đặt.
- **Cộng đồng:** thích, lưu, bình luận, theo dõi, thông báo, tìm kiếm.
- **Hồ sơ:** ảnh đại diện và ảnh bìa (có khung cắt, giữ ảnh động GIF/WebP), danh sách liên kết mạng xã hội.
- **Trang chủ:** thư viện fanart kiểu pixiv (banner nhỏ, tag nổi bật, lọc loại, xếp hạng ngày/tuần/tháng — đầy đủ ở `/ranking` —, Mới nhất / Đang theo dõi); trang `/gioi-thieu` cuộn thường (video nền, MV/video YouTube của Du Ca — tự lấy từ kênh, `YOUTUBE_API_KEY` tùy chọn —, mới phát hành, diện mạo, hồ sơ…). Quản trị → «Trang chủ» sửa trang Giới thiệu và banner trang chủ (mục, ảnh, video, xem trước, lưu nháp, xuất bản); sau khi cập nhật chạy `npm run setup` để chuyển trang chủ cũ vào trang Giới thiệu.
- **Vai trò:** user, moderator, admin. Giao diện tiếng Việt và tiếng Anh.

## Công nghệ

Monorepo npm workspaces:

| Thư mục | Vai trò |
|---|---|
| `apps/web` | Vue 3 + Vite + Tailwind |
| `apps/api` | NestJS + MongoDB (Mongoose) |
| `apps/worker` | Agenda + sharp + ffmpeg, xử lý ảnh/video |
| `packages/shared` | schema zod và hằng số dùng chung |

Lưu trữ tệp: MinIO. Cache (tuỳ chọn): Redis.

## Chạy

Cần Node.js, MongoDB, MinIO và ffmpeg. Redis không bắt buộc.

```sh
cp .env.example .env    # chỉnh giá trị cho phù hợp
npm install
npm run setup           # tạo index, bucket (chạy lại an toàn)
npm run create-admin -- --email <email> --password <mật khẩu> --username <tên>
npm run dev             # build shared rồi chạy shared, api, worker, web; mở http://localhost:5173
```

- **Code worker mới không tự nạp:** sau khi `git pull` hoặc sửa code job, dừng `npm run dev` rồi chạy lại.
- **Kiểm tra:** `npm test`, `npm run type-check`.

## Sao lưu

- `npm run backup` ghi một tệp `.tar.gz` (toàn bộ MongoDB + mọi tệp MinIO) vào `BACKUP_DIR` (mặc định `backups/`).
- `npm run restore -- <tệp> [--yes]` kiểm tra toàn bộ tệp trước, rồi **thay thế** dữ liệu và tệp hiện có; sau đó mọi người phải đăng nhập lại.
- Trang Quản trị → tab «Sao lưu»: tạo, tải xuống, tải lên, xóa, khôi phục và đặt lịch sao lưu tự động (worker chạy theo `BACKUP_TZ`).
