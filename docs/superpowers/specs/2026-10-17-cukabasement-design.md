# CukaBasement — Thiết kế hệ thống

- **Ngày:** 2026-10-17
- **Trạng thái:** Đã duyệt thiết kế, chờ duyệt spec
- **Phạm vi:** Bản đầu tiên (v1)

## 1. Mục tiêu

Web cộng đồng (lấy cảm hứng từ pixiv) để trưng bày tranh vẽ và tác phẩm liên quan tới VTuber **Hibiki Du Ca** (NIJIGEN, kênh https://www.youtube.com/@hibikiduca) cho cộng đồng fan **Cuka**.

**Tiêu chí thành công v1**
- Người dùng đăng ký bằng email, xác thực email, đăng bài gồm ảnh/video/audio/file gốc (≤ 50MB/file), sửa profile.
- Bài mới hiện ngay trên profile và qua link trực tiếp, nhưng chỉ vào trang chủ/tìm kiếm/tag khi đã được Moderator/Admin duyệt.
- Người dùng report được bài (1 lần/bài/người); bài tự ẩn khi đủ ngưỡng report.
- Không chấp nhận tranh AI: tick xác nhận bắt buộc khi đăng + report lý do "AI art" có ngưỡng ẩn thấp hơn + kiểm duyệt thủ công.
- Giao diện tiếng Việt và tiếng Anh.

**Ràng buộc từ người dùng**
- Lưu file bằng **MinIO** (đã cài sẵn trên máy, chạy local), giới hạn **50MB/file**.
- Cơ sở dữ liệu **MongoDB** cài sẵn trên máy (standalone, không Docker), database **`CukaDB`**.
- Frontend dùng khung **Vue 3 + Vite + TypeScript** đã có trong repo.

## 2. Kiến trúc tổng thể

```
Trình duyệt (Vue SPA) ──REST──► NestJS API ──► MongoDB (CukaDB)
        │                          │  └──────► MinIO (presign, stat, delete)
        └──presigned POST/GET────► MinIO
                                   Worker (Agenda, job lưu trong MongoDB)
                                     ├─ sharp (thumbnail, blur)
                                     └─ ffmpeg (poster video, thời lượng)
```

**Monorepo (npm workspaces)**
```
apps/web        – Vue 3 SPA (chuyển khung hiện có vào đây)
apps/api        – NestJS REST API
apps/worker     – process Agenda, import module dùng chung từ api
packages/shared – kiểu dữ liệu, enum, schema zod dùng chung FE/BE
```

**Công nghệ:** NestJS, Mongoose (`@nestjs/mongoose`), Agenda, MinIO JS SDK, sharp, ffmpeg (cài trên máy), argon2, zod, nodemailer, `@nestjs/throttler`, `file-type`; Vue Router, Pinia, vue-i18n, Tailwind CSS; Vitest, Supertest, Vue Test Utils, Playwright.

**Không dùng:** Redis, Docker, transaction MongoDB (xem §3.4).

## 3. Dữ liệu (MongoDB `CukaDB`)

### 3.1 Collections

**`users`** (profile nhúng)
```
{ _id, email (unique), passwordHash, role: "user"|"moderator"|"admin",
  status: "active"|"suspended"|"banned", emailVerifiedAt, birthDate, showR18: bool,
  locale: "vi"|"en",
  profile: { username (unique), displayName, bio, avatarFileId, bannerFileId,
             socialLinks: { x, facebook, youtube, pixiv } },
  stats: { followerCount, followingCount, postCount },
  createdAt, lastLoginAt }
```

**`authTokens`**: `{ userId, type: "verify_email"|"reset_password"|"refresh", tokenHash, expiresAt, usedAt }` — TTL index trên `expiresAt`.

**`posts`**
```
{ _id, authorId, type: "illustration"|"manga"|"video"|"audio"|"other",
  title, description, rating: "all"|"r18",
  visibility: "public"|"hidden_by_reports"|"removed",
  review: { status: "pending"|"approved"|"rejected", reason, by, at },
  aiDeclaration: true, sourceCredit,
  files: [ { fileId, position, isCover } ],
  tags: [string],                       // ≤ 10, chuẩn hóa chữ thường
  counts: { likes, bookmarks, comments, views },
  reportCounts: { total, ai_art },      // chỉ đếm report status "open"
  createdAt, updatedAt, deletedAt }
```

**`files`**
```
{ _id, ownerId, bucket, objectKey, originalName, mimeType, sizeBytes (≤ 52428800),
  kind: "image"|"video"|"audio"|"source"|"archive",
  width, height, durationSec,
  status: "uploading"|"processing"|"ready"|"failed",
  variants: [ { name: "thumb_sm"|"thumb_md"|"preview"|"blurred", bucket, objectKey, width, height } ],
  createdAt }
```

**`tags`**: `{ _id: "ducaart", display: "DuCaArt", postCount }`

**Tương tác**
- `likes`: `{ userId, postId, createdAt }` — unique `(userId, postId)`
- `bookmarks`: `{ userId, postId, isPrivate, createdAt }` — unique `(userId, postId)`
- `comments`: `{ postId, authorId, parentId|null, body, status: "visible"|"hidden", createdAt, deletedAt }` — trả lời tối đa 1 cấp (parent phải là comment gốc)
- `follows`: `{ followerId, followeeId, createdAt }` — unique `(followerId, followeeId)`, không cho tự follow
- `notifications`: `{ userId, type: "post_approved"|"post_rejected"|"post_hidden"|"like"|"comment"|"reply"|"follow", actorId, postId, commentId, readAt, createdAt }` — TTL 90 ngày

**Kiểm duyệt**
- `reports`: `{ postId, reporterId, reason: "ai_art"|"stolen_art"|"unmarked_r18"|"spam"|"other", detail, status: "open"|"dismissed"|"actioned", resolvedBy, resolvedAt, createdAt }` — **unique `(postId, reporterId)`**; không report bài của chính mình.
- `moderationLogs`: `{ actorId | "system", action: "approve"|"reject"|"hide"|"restore"|"remove"|"suspend"|"ban"|"unban"|"change_role"|"hide_comment"|"update_setting"|"auto_hide", targetType, targetId, note, createdAt }`
- `settings`: một document `{ _id: "global", reportHideThreshold: 5, reportAiHideThreshold: 3, maxFileBytes: 52428800, maxFilesPerPost: 50, dailyUploadQuotaBytes: 2147483648 }`
- `jobs`: do Agenda quản lý.

### 3.2 Index

- `posts`: `{ "review.status":1, visibility:1, rating:1, createdAt:-1 }` (trang chủ); `{ tags:1, createdAt:-1 }`; `{ authorId:1, createdAt:-1 }`; text index `title`, `description`, `tags`.
- `comments`: `{ postId:1, createdAt:1 }`
- `notifications`: `{ userId:1, readAt:1, createdAt:-1 }`
- `reports`: `{ status:1, reason:1, createdAt:-1 }`
- `follows`: thêm `{ followeeId:1 }`
- `files`: `{ status:1, createdAt:1 }` (job dọn dẹp)

### 3.3 Xóa

- Xóa bài là xóa mềm (`deletedAt`). Job xóa object MinIO sau 30 ngày.
- File `uploading` quá 24 giờ, hoặc `failed`, hoặc không thuộc bài nào sau 24 giờ: job dọn dẹp xóa.

### 3.4 Nhất quán dữ liệu không dùng transaction

MongoDB local là standalone nên không có transaction. Quy tắc:
1. Thao tác chính luôn atomic trên một document (unique index, `$inc`, `findOneAndUpdate` có điều kiện).
2. Thao tác hai collection: ghi bản ghi gốc trước, cập nhật bộ đếm sau. Ví dụ like: `insert likes` → nếu lỗi duplicate key thì trả về trạng thái hiện tại, không `$inc`; nếu thành công thì `$inc posts.counts.likes`.
3. Tự ẩn bài theo report: sau khi `insert reports` và `$inc reportCounts`, gọi
   `findOneAndUpdate({ _id, visibility: "public", $or: [{ "reportCounts.total": { $gte: T } }, { "reportCounts.ai_art": { $gte: A } }] }, { visibility: "hidden_by_reports" })`; nếu khớp thì ghi `moderationLogs` (actor `system`, action `auto_hide`) và gửi thông báo `post_hidden` cho tác giả.
4. Job **đối soát hằng đêm** đếm lại `counts`, `reportCounts`, `users.stats`, `tags.postCount` từ collection gốc và sửa chỗ lệch.
5. Code không giả định có transaction, nên vẫn đúng nếu sau này chuyển lên Atlas.

## 4. Lưu trữ và xử lý file (MinIO)

**Bucket**
- `cuka-originals` — private: file gốc, mọi biến thể của bài R18.
- `cuka-public` — policy đọc công khai: thumbnail/preview của bài `rating: "all"`.
- Object key: `{userId}/{fileId}/{original|thumb_sm|thumb_md|preview|blurred}.{ext}`.

**Whitelist định dạng (kiểm tra bằng magic bytes)**
| kind | định dạng |
|---|---|
| image | png, jpg, webp, gif |
| video | mp4, webm |
| audio | mp3, wav, ogg |
| source | psd, clip |
| archive | zip |

**Luồng upload**
1. `POST /api/uploads { name, size, mime }` → kiểm tra size ≤ `maxFileBytes`, mime trong whitelist, quota ngày chưa vượt; tạo `files` (`uploading`); trả presigned POST với `content-length-range: 1..maxFileBytes`, hết hạn 15 phút.
2. Trình duyệt upload thẳng lên MinIO (thanh tiến trình, tối đa 3 file song song).
3. `POST /api/uploads/:id/complete` → `statObject` xác nhận kích thước; đọc 4KB đầu bằng `file-type` xác định loại thật; sai → xóa object, `failed`; đúng → `processing`, đẩy job `process-file`.
4. Worker:
   - ảnh: `thumb_sm` 360px, `thumb_md` 1200px (webp), xóa EXIF/GPS; GIF động lấy frame đầu cho thumbnail.
   - video: ffmpeg lấy frame ở giây 1 làm `preview`, đọc `durationSec`, kích thước.
   - audio: đọc `durationSec`.
   - source/archive: không tạo preview.
   - khi bài là R18: tạo thêm `blurred` (từ thumbnail/preview), toàn bộ biến thể ghi vào `cuka-originals`.
   - xong → `ready`. Lỗi → Agenda thử lại tối đa 3 lần, sau đó `failed`.
5. `POST /api/posts` → kiểm tra mọi `fileId` thuộc người đăng, ≤ `maxFilesPerPost`, có ít nhất một file image/video/audio, `aiDeclaration === true`; tạo bài `review.status: "pending"`.

Khi đổi rating của bài (all ↔ r18), đẩy job `relocate-variants` để chuyển biến thể giữa hai bucket và tạo/xóa `blurred`.

**Phục vụ file**
- Bài `all`: URL công khai từ `cuka-public` cho thumbnail/preview; file gốc qua presigned GET (10 phút).
- Bài `r18`: người xem không đủ điều kiện nhận URL presigned của `blurred`; người đủ điều kiện nhận presigned GET của thumbnail/preview/gốc.
- File source/archive: presigned GET có `response-content-disposition: attachment`.

## 5. Backend API (NestJS)

**Module:** `auth`, `users`, `uploads`, `storage`, `posts`, `tags`, `interactions`, `comments`, `notifications`, `reports`, `moderation`, `admin`, `settings`, `jobs`.

### 5.1 Xác thực
- Mật khẩu argon2id, tối thiểu 8 ký tự.
- Đăng ký → gửi email xác thực (token 24 giờ). Chưa xác thực: đăng nhập được, xem được, **không** đăng bài/comment/report.
- Access token JWT 15 phút (header `Authorization: Bearer`). Refresh token 30 ngày trong cookie httpOnly, `SameSite=Lax`, `Secure` khi production, path `/api/auth`; DB chỉ lưu hash; xoay vòng mỗi lần dùng; dùng lại token đã xoay → thu hồi toàn bộ phiên của user.
- Quên mật khẩu: token 1 giờ, dùng 1 lần; đổi mật khẩu → thu hồi mọi refresh token. Phản hồi luôn giống nhau dù email có tồn tại hay không.
- Email: nodemailer qua `SMTP_URL`; để trống thì in nội dung email ra console.
- Rate limit: login 5/phút theo IP+email; register và forgot-password 3/giờ theo IP; tạo comment 10/phút; report 20/giờ.

### 5.2 Phân quyền

| Hành động | User | Moderator | Admin |
|---|---|---|---|
| Đăng/sửa/xóa bài của mình; like, bookmark, comment, follow, report | ✔ | ✔ | ✔ |
| Duyệt/từ chối bài, xử lý report, ẩn comment, ẩn/khôi phục bài | | ✔ | ✔ |
| Khóa/cấm/mở tài khoản, đổi role, sửa settings, xem toàn bộ nhật ký | | | ✔ |

- `suspended`: chỉ đọc. `banned`: không đăng nhập được, refresh token bị thu hồi.
- Moderator không tác động lên tài khoản/bài của moderator hoặc admin khác (trừ khi là admin).
- Không ai tự đổi role của chính mình; luôn còn ít nhất một admin.

### 5.3 Quy tắc hiển thị bài — `visiblePostsFilter(viewer, context)`

| Ngữ cảnh | Điều kiện |
|---|---|
| `feed` (trang chủ, tìm kiếm, tag, "Đang theo dõi") | `review.status = approved`, `visibility = public`, `deletedAt = null` |
| `direct` (trang bài, profile) | `review.status ∈ {pending, approved}`, `visibility = public`, `deletedAt = null` |
| chủ bài, moderator, admin | thấy mọi trạng thái trừ đã xóa (mod/admin thấy cả đã xóa trong `/mod`) |

R18: chỉ trả về đầy đủ khi viewer đã đăng nhập, `birthDate` cho thấy ≥ 18 tuổi và `showR18 = true`. Ở `feed`, bài R18 bị loại khỏi kết quả với người không đủ điều kiện; ở `direct`, trả về metadata kèm ảnh `blurred`.

### 5.4 Duyệt bài
- Bài mới `pending`. Moderator `approve` → `approved` + thông báo `post_approved`; `reject` (bắt buộc lý do) → `rejected` + thông báo `post_rejected` kèm lý do.
- Bài `rejected` chỉ chủ bài và mod/admin thấy; chủ bài sửa lại thì bài quay về `pending`.
- Sửa bài đã duyệt: thêm/xóa/thay file → về `pending` (vẫn hiện ở profile/link, rời khỏi feed tới khi duyệt lại). Sửa tiêu đề, mô tả, tag, credit → không cần duyệt lại. Đổi rating `all → r18` không cần duyệt lại; `r18 → all` → về `pending`.

### 5.5 Report
- Mỗi người 1 report/bài (unique index; lỗi trùng trả `REPORT_ALREADY_EXISTS`).
- Ngưỡng tự ẩn: `reportCounts.total ≥ reportHideThreshold` (mặc định 5) **hoặc** `reportCounts.ai_art ≥ reportAiHideThreshold` (mặc định 3).
- Hàng đợi `/mod/reports` gom theo bài, bài có report `ai_art` xếp trước, sau đó theo số report.
- Xử lý theo bài: **Giữ** (mọi report open → `dismissed`, `reportCounts` về 0, nếu đang `hidden_by_reports` thì về `public`) hoặc **Gỡ** (report → `actioned`, bài `removed`, thông báo tác giả); kèm tùy chọn khóa/cấm tác giả (chỉ admin).
- Report đã `dismissed` không được tính lại; người đó vẫn không report lại được bài đó.

### 5.6 Endpoint (tiền tố `/api`)
- `auth/register`, `auth/login`, `auth/refresh`, `auth/logout`, `auth/verify-email`, `auth/resend-verification`, `auth/forgot-password`, `auth/reset-password`
- `me` (GET/PATCH profile), `me/settings` (locale, birthDate, showR18), `me/password`
- `users/:username`, `users/:username/posts`, `users/:username/bookmarks` (chỉ bookmark công khai, trừ chính chủ), `users/:username/follow` (POST/DELETE), `users/:username/followers`, `users/:username/following`
- `uploads` (POST), `uploads/:id/complete` (POST)
- `posts` (POST), `posts/:id` (GET/PATCH/DELETE), `posts/:id/like` (POST/DELETE), `posts/:id/bookmark` (POST/DELETE), `posts/:id/comments` (GET/POST), `comments/:id` (DELETE), `posts/:id/report` (POST), `posts/:id/files/:fileId/url` (GET presigned)
- `feed/home`, `feed/following`, `search?q=&tag=&type=&cursor=`, `tags/suggest?q=`
- `notifications` (GET), `notifications/read` (POST `{ ids | all }`), `notifications/unread-count`
- `mod/queue?status=pending`, `mod/posts/:id/approve`, `mod/posts/:id/reject`, `mod/posts/:id/hide`, `mod/posts/:id/restore`, `mod/reports`, `mod/reports/posts/:postId/resolve`, `mod/comments/:id/hide`
- `admin/users?q=&role=&status=`, `admin/users/:id/status`, `admin/users/:id/role`, `admin/settings` (GET/PATCH), `admin/logs`
- Ngoài `/api`: `GET /og/posts/:id` — HTML có thẻ Open Graph (ảnh `thumb_md` công khai; bài R18/không public dùng ảnh mặc định của site) rồi chuyển hướng tới SPA.

Phân trang bằng cursor (`createdAt` + `_id`), mặc định 30 item.

### 5.7 Validate và lỗi
- Mọi body/query validate bằng schema zod trong `packages/shared`.
- Lỗi trả `{ error: { code, message, details? } }`; `code` dạng `POST_NOT_FOUND`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `REPORT_ALREADY_EXISTS`, `EMAIL_NOT_VERIFIED`... dùng làm key i18n.
- Giới hạn độ dài: title 100, description 3000, comment 1000, bio 500, tag 30 ký tự.

## 6. Frontend (Vue 3 SPA)

**Thư viện:** Vue Router, Pinia, vue-i18n (`vi`, `en`; mặc định theo trình duyệt, lưu trong `users.locale`), Tailwind CSS, wrapper `fetch` tự refresh token khi gặp 401.

**Route**
| Route | Nội dung |
|---|---|
| `/` | Lưới bài mới đã duyệt (cuộn vô hạn), dải tag nổi bật (#DuCaArt, #HibikiDuCa, #WeAreCuka), tab "Đang theo dõi" khi đăng nhập |
| `/tags/:tag`, `/search` | Lưới kết quả, lọc theo loại bài |
| `/posts/:id` | Xem bài: ảnh/manga dọc/video/audio/tải file; tiêu đề, mô tả, tag, credit; like, bookmark, chia sẻ, report; khung tác giả + follow; "Bài khác của tác giả"; comment |
| `/u/:username` | Banner, avatar, bio, link MXH, số follower/following; tab Bài đăng / Bookmark |
| `/upload`, `/posts/:id/edit` | Kéo-thả nhiều file, tiến trình từng file, sắp xếp trang, chọn ảnh bìa, tag có gợi ý, rating, ô tick bắt buộc "Đây là tác phẩm của tôi / đã được phép, không dùng AI", ô credit |
| `/settings` | Profile, mật khẩu, ngôn ngữ, ngày sinh + bật R18 |
| `/notifications` | Danh sách; chuông header có badge, polling 60 giây |
| `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` | Xác thực |
| `/mod` | Hàng đợi chờ duyệt, hàng đợi report (AI trước), comment bị ẩn |
| `/admin` | Tài khoản, settings, nhật ký kiểm duyệt |
| `/403`, `/404` | Trang lỗi |

**Hành vi**
- Access token chỉ giữ trong bộ nhớ (Pinia); khởi động app gọi `/auth/refresh`.
- Route guard theo role; không đủ quyền → `/403`.
- Bài pending: chủ bài và mod thấy nhãn "Đang chờ duyệt".
- R18 không đủ điều kiện: ảnh mờ + lời nhắc đăng nhập/bật R18.
- Toast lỗi dịch theo `error.code`; skeleton khi tải; trạng thái rỗng cho mọi danh sách.
- Responsive: 2 cột (điện thoại), 3–4 (tablet), 5–6 (desktop).
- Giao diện: tông chocolate/dâu (🍫🍓), sáng/tối. Không dùng logo/ảnh chính thức của Du Ca khi chưa được phép; tên site "CukaBasement" dạng chữ.

## 7. Cấu hình và vận hành

**Phụ thuộc trên máy:** Node.js (theo `engines` trong `package.json`), MongoDB (standalone, đã có `CukaDB`), MinIO (đã chạy local), ffmpeg.

**`.env.example`**
```
MONGODB_URI=mongodb://localhost:27017/CukaDB
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_PUBLIC_URL=http://localhost:9000
MINIO_BUCKET_ORIGINALS=cuka-originals
MINIO_BUCKET_PUBLIC=cuka-public
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
SMTP_URL=
MAIL_FROM="CukaBasement <no-reply@localhost>"
APP_URL=http://localhost:5173
API_PORT=3000
FFMPEG_PATH=ffmpeg
```
`.env` không được commit. Thông tin `minioadmin/minioadmin` chỉ dùng local; phải đổi khi triển khai thật. MinIO cần cấu hình CORS cho `APP_URL` để trình duyệt upload trực tiếp.

**Script**
- `npm run setup` — tạo index MongoDB, tạo 2 bucket + policy đọc công khai cho `cuka-public`, tạo document `settings`. Chạy lại an toàn (idempotent).
- `npm run create-admin -- --email <email> --password <pw> --username <name>`
- `npm run dev` — chạy song song web, api, worker.
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run type-check`.

Mọi script viết bằng Node để chạy được trên Windows/macOS/Linux.

**Job định kỳ (Agenda):** `cleanup-uploads` (mỗi giờ), `purge-deleted-posts` (hằng ngày), `reconcile-counters` (hằng đêm).

## 8. Kiểm thử

**Backend (Vitest + Supertest)** — chạy trên MongoDB thật với database `CukaDB_test` (xóa sau mỗi lần chạy; test từ chối chạy nếu tên DB không kết thúc bằng `_test`) và bucket MinIO tiền tố `test-`.

Bắt buộc có test:
- đăng ký → xác thực email → đăng nhập → refresh (xoay vòng, phát hiện dùng lại) → đăng xuất; quên/đặt lại mật khẩu
- upload: chặn > 50MB (ở bước xin quyền và bước complete), chặn file sai magic bytes, quota ngày
- `visiblePostsFilter`: đủ tổ hợp review status × visibility × rating × vai trò người xem
- report: trùng bị chặn; tự ẩn ở 5 report thường và ở 3 report `ai_art`; Giữ/Gỡ
- like/bookmark/follow lặp lại không tăng bộ đếm hai lần
- ma trận phân quyền theo role, moderator không tác động được lên admin
- sửa bài: đổi file → về `pending`; sửa tiêu đề → giữ `approved`
- job đối soát sửa bộ đếm lệch

**Worker** — thumbnail từ ảnh mẫu (kiểm tra kích thước, mất EXIF); poster từ video mẫu 1 giây; blurred cho R18.

**Frontend (Vitest + Vue Test Utils)** — store `auth` (refresh), component upload (từ chối file > 50MB phía client, tiến trình), nút like (cập nhật lạc quan và hoàn tác khi lỗi), form report (hiện lỗi đã report).

**E2E (Playwright)** — đăng ký → xác thực (lấy link từ log email) → đăng bài → mod duyệt → bài hiện ở trang chủ; report 3 lần lý do AI → bài biến mất khỏi trang chủ.

## 9. Nội dung mẫu và bản quyền

- Không tự động tải hay đăng lại tranh từ X, Facebook, pixiv.
- `docs/fanart-sources.md` lưu danh sách nguồn fanart tìm được, kèm trạng thái xin phép và kiểm tra AI do chủ dự án tự đánh giá.
- Tranh được phép sẽ do chủ dự án hoặc chính họa sĩ đăng qua giao diện, ô credit ghi link bài gốc.
- Tag `#ameoDuCa` là tag R18: nếu đăng phải gắn `rating: "r18"`.

## 10. Ngoài phạm vi v1

Ranking, Series, đăng nhập Google/Discord, thông báo realtime (v1 dùng polling), tiếng Nhật, phát hiện ảnh AI tự động, triển khai production, CDN.
