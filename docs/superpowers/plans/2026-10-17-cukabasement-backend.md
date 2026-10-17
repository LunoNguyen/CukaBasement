# CukaBasement Backend (API + Worker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo, shared package, NestJS REST API and Agenda worker that implement every server-side behavior of the CukaBasement spec (auth, uploads to MinIO, posts, review, interactions, comments, notifications, reports with auto-hide, moderation, admin, OG route).

**Architecture:** npm-workspaces monorepo. `packages/shared` holds enums, limits, zod schemas and error codes used by both API and (later) the Vue app. `apps/api` is a NestJS app on Mongoose talking to a standalone MongoDB (`CukaDB`) and a local MinIO; it never uses transactions. Background work runs in `apps/worker`, an Agenda process whose job handlers live in `apps/api/src/jobs/handlers` so they share models and are tested from the API test suite.

**Tech Stack:** Node ≥ 22.18, TypeScript ~6.0, NestJS 12 (`@nestjs/core`, `@nestjs/platform-express`, `@nestjs/mongoose`, `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/cli` with the swc builder), Mongoose 9, Agenda 6, `minio` 8, `sharp` 0.35, `argon2`, `zod` 4, `nodemailer` 10, `file-type` 22, `cookie-parser`; Vitest 5 + `unplugin-swc` + Supertest; ffmpeg/ffprobe from the host (spawned via `node:child_process`, no wrapper library).

**Spec:** `docs/superpowers/specs/2026-10-17-cukabasement-design.md`

**Follow-up plan:** the Vue SPA (spec §6) is a separate plan, `docs/superpowers/plans/2026-10-17-cukabasement-frontend.md`, written after this one is reviewed. This plan only moves the existing Vue scaffold into `apps/web` and keeps it building.

## Global Constraints

- Database: MongoDB standalone, `MONGODB_URI=mongodb://localhost:27017/CukaDB`. No multi-document transactions anywhere (spec §3.4).
- Tests use `MONGODB_URI_TEST` (default `mongodb://localhost:27017/CukaDB_test`); the harness refuses to start unless the database name ends with `_test`. MinIO test buckets are `test-cuka-originals` and `test-cuka-public`.
- Max file size `52428800` bytes (50MB); `maxFilesPerPost` 50; `dailyUploadQuotaBytes` 2147483648; presigned POST expires in 15 min; presigned GET in 10 min.
- Report thresholds: `reportHideThreshold` 5, `reportAiHideThreshold` 3 (stored in `settings` doc `_id: "global"`, editable by admin).
- Text limits: title 100, description 3000, comment 1000, bio 500, tag 30 chars, ≤ 10 tags per post.
- Roles `user | moderator | admin`; statuses `active | suspended | banned`.
- Access JWT 15 min; refresh token 30 days in httpOnly cookie `cuka_rt`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, path `/api/auth`.
- Error body is always `{ error: { code, message, details? } }`; `code` is an `ErrorCode` from `packages/shared`.
- Pagination: cursor over `(createdAt desc, _id desc)`, default page size 30, max 100.
- All global API routes are under `/api` except `GET /og/posts/:id`.
- Scripts run cross-platform via Node (no shell scripts). `.env` is never committed; `.env.example` is.
- Never write AI-art detection, social-media scraping, or auto-import of third-party art (spec §9, §10).

## Review Focus

1. **Expired/revoked access tokens on public endpoints** — a request with a bad `Authorization` header to a public GET (feed, post) must be treated as anonymous, not 401, so a stale tab still renders. Test in Task 6.
2. **Viewer without `birthDate` who enables `showR18`** — must be rejected (`AGE_REQUIRED`) and never counted as adult. Test in Task 7.
3. **Client lies about size/mime in `POST /uploads`** — `complete` must re-check the real object size and magic bytes and reject a PNG-named ZIP, and a file over 50MB that slipped past a crafted policy. Test in Task 8.
4. **Concurrent duplicate like/report (double-click)** — two parallel requests must leave counters incremented exactly once and return success to both or `REPORT_ALREADY_EXISTS`. Test in Tasks 12 and 15.
5. **Post whose files are still `processing` or `failed`** — creating a post with a `failed` file is rejected (`FILE_NOT_READY`); `processing` is allowed and renders without thumbnails. Test in Task 10.

---

## File Structure

```
package.json                     root: workspaces, overrides (moved from old root), scripts
.env.example                     spec §7 values
apps/web/                        existing Vue scaffold moved here (index.html, src/, public/, vite.config.ts, tsconfig*.json, env.d.ts)
packages/shared/
  package.json, tsconfig.json
  src/index.ts                   re-exports
  src/enums.ts                   string-literal tuples + types
  src/limits.ts                  LIMITS, DEFAULT_SETTINGS
  src/mime.ts                    ALLOWED_FILE_TYPES, kindForMime
  src/tags.ts                    normalizeTag
  src/errors.ts                  ERROR_CODES, ErrorCode
  src/schemas/{auth,profile,upload,post,comment,report,admin,query}.ts
  test/*.test.ts
apps/api/
  package.json, tsconfig.json, nest-cli.json, vitest.config.ts
  src/main.ts                    bootstrap (cookie-parser, global prefix 'api' excluding og)
  src/app.module.ts
  src/config/config.ts           loadConfig(env)
  src/common/{app-error.ts, error.filter.ts, zod.pipe.ts, cursor.ts, ids.ts}
  src/database/{database.module.ts, indexes.ts}
  src/settings/{settings.schema.ts, settings.service.ts, settings.module.ts}
  src/storage/{storage.service.ts, storage.module.ts}
  src/mail/{mail.port.ts, mail.service.ts, mail.module.ts}
  src/jobs/{jobs.port.ts, agenda-jobs.ts, jobs.module.ts}
  src/jobs/handlers/{process-file.ts, relocate-variants.ts, cleanup-uploads.ts, purge-deleted-posts.ts, reconcile-counters.ts, media.ts}
  src/auth/{auth.controller.ts, auth.service.ts, tokens.ts, auth.guard.ts, viewer.ts, decorators.ts, auth-token.schema.ts, auth.module.ts}
  src/users/{user.schema.ts, users.service.ts, me.controller.ts, users.controller.ts, users.module.ts}
  src/uploads/{file.schema.ts, uploads.service.ts, uploads.controller.ts, uploads.module.ts}
  src/posts/{post.schema.ts, visibility.ts, posts.service.ts, posts.controller.ts, file-urls.ts, posts.module.ts}
  src/tags/{tag.schema.ts, tags.service.ts, tags.controller.ts, tags.module.ts}
  src/feed/{feed.service.ts, feed.controller.ts, feed.module.ts}
  src/interactions/{like.schema.ts, bookmark.schema.ts, follow.schema.ts, interactions.service.ts, interactions.controller.ts, interactions.module.ts}
  src/comments/{comment.schema.ts, comments.service.ts, comments.controller.ts, comments.module.ts}
  src/notifications/{notification.schema.ts, notifications.service.ts, notifications.controller.ts, notifications.module.ts}
  src/reports/{report.schema.ts, reports.service.ts, reports.controller.ts, reports.module.ts}
  src/moderation/{moderation-log.schema.ts, moderation-log.service.ts, moderation.service.ts, moderation.controller.ts, moderation.module.ts}
  src/admin/{admin.service.ts, admin.controller.ts, admin.module.ts}
  src/og/{og.controller.ts, og.module.ts}
  scripts/{setup.ts, create-admin.ts}
  test/harness.ts                createTestHarness, helpers
  test/fixtures/{tiny.png, tiny.jpg (with EXIF GPS), one-second.mp4, tone.mp3, fake.zip}
  test/*.e2e.test.ts             one file per module
apps/worker/
  package.json, tsconfig.json
  src/main.ts                    Agenda process; registers handlers + recurring schedules
```

---

### Task 1: Monorepo layout

**Files:**
- Create: `package.json` (replace root), `apps/web/package.json`, `.env.example`
- Move (git mv): `index.html`, `src/`, `public/`, `env.d.ts`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` → `apps/web/`
- Modify: `README.md` (setup section)

**Interfaces:**
- Produces: root scripts `dev`, `build`, `test`, `type-check`, `setup`, `create-admin` (later tasks fill them); workspace names `@cuka/web`, `@cuka/shared`, `@cuka/api`, `@cuka/worker`.

- [ ] **Step 1:** `git mv` the listed files into `apps/web/`. `apps/web/package.json` (`"name": "@cuka/web"`) takes the old `dependencies`, `devDependencies` and `scripts`. The root `package.json` keeps `"private": true`, `"type": "module"` is **not** set at root, `engines` copied verbatim, the old `overrides` block verbatim (overrides only work at root), `"workspaces": ["packages/*", "apps/*"]`, and `devDependencies: { "concurrently": "^10.0.6" }`.
- [ ] **Step 2:** Root scripts: `"dev": "concurrently -n shared,api,worker,web \"npm -w @cuka/shared run dev\" \"npm -w @cuka/api run dev\" \"npm -w @cuka/worker run dev\" \"npm -w @cuka/web run dev\""`, `"build": "npm run build --workspaces --if-present"`, `"test": "npm test --workspaces --if-present"`, `"type-check": "npm run type-check --workspaces --if-present"`, `"setup": "npm -w @cuka/api run setup"`, `"create-admin": "npm -w @cuka/api run create-admin --"`.
- [ ] **Step 3:** Write `.env.example` with exactly the block from spec §7 plus `MONGODB_URI_TEST=mongodb://localhost:27017/CukaDB_test`, `NODE_ENV=development`.
- [ ] **Step 4:** Run `npm install && npm -w @cuka/web run build`. Expected: Vite build succeeds and writes `apps/web/dist`.
- [ ] **Step 5:** README "Cài đặt" section: prerequisites (Node, MongoDB with `CukaDB`, MinIO, ffmpeg), MinIO CORS note (allow `APP_URL` origin for browser POST uploads), `cp .env.example .env`, `npm install`, `npm run setup`, `npm run create-admin -- --email … --password … --username …`, `npm run dev`. Write it in Vietnamese.
- [ ] **Step 6: Commit** — `git commit -m "chore: convert repo to npm workspaces monorepo"`

---

### Task 2: Shared package — enums, limits, tags, mime, errors, schemas

**Files:**
- Create: everything under `packages/shared/` listed in File Structure
- Test: `packages/shared/test/tags.test.ts`, `mime.test.ts`, `schemas.test.ts`

**Interfaces:**
- Produces (all exported from `@cuka/shared`):
  - `ROLES = ['user','moderator','admin'] as const; type Role`; likewise `USER_STATUSES`, `POST_TYPES = ['illustration','manga','video','audio','other']`, `RATINGS = ['all','r18']`, `VISIBILITIES = ['public','hidden_by_reports','removed']`, `REVIEW_STATUSES = ['pending','approved','rejected']`, `FILE_KINDS = ['image','video','audio','source','archive']`, `FILE_STATUSES = ['uploading','processing','ready','failed']`, `VARIANT_NAMES = ['thumb_sm','thumb_md','preview','blurred']`, `REPORT_REASONS = ['ai_art','stolen_art','unmarked_r18','spam','other']`, `REPORT_STATUSES = ['open','dismissed','actioned']`, `NOTIFICATION_TYPES = ['post_approved','post_rejected','post_hidden','like','comment','reply','follow']`, `MOD_ACTIONS = ['approve','reject','hide','restore','remove','suspend','ban','unban','change_role','hide_comment','update_setting','auto_hide']`, `LOCALES = ['vi','en']`.
  - `LIMITS = { titleMax: 100, descriptionMax: 3000, commentMax: 1000, bioMax: 500, tagMax: 30, tagsPerPost: 10, passwordMin: 8, pageSizeDefault: 30, pageSizeMax: 100 }`
  - `DEFAULT_SETTINGS = { reportHideThreshold: 5, reportAiHideThreshold: 3, maxFileBytes: 52428800, maxFilesPerPost: 50, dailyUploadQuotaBytes: 2147483648 }`; `type GlobalSettings = typeof DEFAULT_SETTINGS`
  - `ALLOWED_FILE_TYPES: ReadonlyArray<{ ext: string; mime: string; kind: FileKind }>` covering spec §4 table (psd mime `image/vnd.adobe.photoshop`, clip mime `application/octet-stream` with ext `clip`, zip `application/zip`, mp3 `audio/mpeg`, wav `audio/wav`, ogg `audio/ogg`).
  - `kindForMime(mime: string, ext: string): FileKind | null` — matches on mime, falls back to ext for `clip`.
  - `normalizeTag(raw: string): string | null` — strip leading `#`, trim, NFC-normalize, lowercase, collapse internal whitespace to `_`; return `null` if empty or longer than `LIMITS.tagMax`.
  - `ERROR_CODES` tuple and `type ErrorCode` including at least: `INTERNAL, VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, EMAIL_TAKEN, USERNAME_TAKEN, INVALID_CREDENTIALS, ACCOUNT_BANNED, ACCOUNT_SUSPENDED, EMAIL_NOT_VERIFIED, TOKEN_INVALID, AGE_REQUIRED, FILE_TOO_LARGE, FILE_TYPE_NOT_ALLOWED, UPLOAD_QUOTA_EXCEEDED, UPLOAD_NOT_FOUND, FILE_NOT_READY, POST_NOT_FOUND, POST_NEEDS_MEDIA, TOO_MANY_FILES, AI_DECLARATION_REQUIRED, CANNOT_FOLLOW_SELF, CANNOT_REPORT_OWN_POST, REPORT_ALREADY_EXISTS, COMMENT_NOT_FOUND, REPLY_DEPTH_EXCEEDED, CANNOT_MODERATE_PEER, LAST_ADMIN, CANNOT_CHANGE_OWN_ROLE`.
  - zod schemas: `registerSchema {email, password(min 8, max 128), username(/^[a-z0-9_]{3,24}$/), displayName(1..50)}`, `loginSchema`, `emailOnlySchema`, `resetPasswordSchema {token, password}`, `tokenSchema {token}`, `updateProfileSchema` (all optional: displayName, bio≤500, avatarFileId, bannerFileId, socialLinks {x,facebook,youtube,pixiv: url|''}), `updateSettingsSchema {locale?, birthDate? (ISO date, not in future), showR18?}`, `changePasswordSchema {currentPassword, newPassword}`, `createUploadSchema {name(1..255), size(int ≥1), mime}`, `createPostSchema {type, title(1..100), description(≤3000, default ''), rating, tags(string[] ≤10), sourceCredit(≤500, default ''), aiDeclaration: z.literal(true), files: [{fileId, position, isCover}] min 1}`, `updatePostSchema` (createPostSchema partial, aiDeclaration still literal true when present), `createCommentSchema {body(1..1000), parentId?}`, `createReportSchema {reason, detail(≤1000, default '')}`, `rejectSchema {reason(1..500)}`, `resolveReportsSchema {decision: 'keep'|'remove', note?}`, `adminStatusSchema {status, note?}`, `adminRoleSchema {role}`, `adminSettingsSchema` (DEFAULT_SETTINGS keys, all optional positive ints; `maxFileBytes ≤ 52428800`), `cursorQuerySchema {cursor?, limit? (1..100, default 30)}`, `searchQuerySchema` (cursorQuerySchema + `q?`, `tag?`, `type?`).

- [ ] **Step 1: Write failing tests**

```ts
// tags.test.ts
expect(normalizeTag('#DuCaArt')).toBe('ducaart')
expect(normalizeTag('  Hibiki  Du Ca ')).toBe('hibiki_du_ca')
expect(normalizeTag('#')).toBeNull()
expect(normalizeTag('a'.repeat(31))).toBeNull()
// mime.test.ts
expect(kindForMime('image/png','png')).toBe('image')
expect(kindForMime('application/octet-stream','clip')).toBe('source')
expect(kindForMime('application/x-msdownload','exe')).toBeNull()
// schemas.test.ts
expect(createPostSchema.safeParse({...validPost, aiDeclaration: false}).success).toBe(false)
expect(createPostSchema.safeParse({...validPost, tags: Array(11).fill('a')}).success).toBe(false)
expect(registerSchema.safeParse({...validReg, username: 'Du Ca'}).success).toBe(false)
expect(adminSettingsSchema.safeParse({ maxFileBytes: 52428801 }).success).toBe(false)
expect(updateSettingsSchema.safeParse({ birthDate: '2999-01-01' }).success).toBe(false)
```

- [ ] **Step 2:** Run `npm -w @cuka/shared test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. Package: `"name": "@cuka/shared"`, CommonJS output, `tsc -b` to `dist/`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, scripts `build`, `dev` (`tsc -b --watch`), `test` (`vitest run`), `type-check`. Dependency `zod`.
- [ ] **Step 4:** Run `npm -w @cuka/shared test && npm -w @cuka/shared run build`. Expected: PASS, `dist/` emitted.
- [ ] **Step 5: Commit** — `feat(shared): enums, limits, schemas and error codes`

---

### Task 3: API skeleton, config, error envelope, test harness

**Files:**
- Create: `apps/api/{package.json,tsconfig.json,nest-cli.json,vitest.config.ts}`, `src/main.ts`, `src/app.module.ts`, `src/config/config.ts`, `src/common/{app-error.ts,error.filter.ts,zod.pipe.ts,cursor.ts,ids.ts}`, `src/database/database.module.ts`, `src/mail/*`, `src/jobs/{jobs.port.ts,jobs.module.ts}`, `test/harness.ts`
- Test: `apps/api/test/skeleton.e2e.test.ts`, `apps/api/test/cursor.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): Config` — zod-validated; fields `nodeEnv, mongoUri, minio {endPoint, port, useSSL, accessKey, secretKey, publicUrl, bucketOriginals, bucketPublic}, jwt {accessSecret, refreshSecret}, smtpUrl?, mailFrom, appUrl, apiPort, ffmpegPath, ffprobePath` (ffprobe defaults to `ffmpegPath` with `ffmpeg`→`ffprobe` substitution). Provided via Nest token `CONFIG`.
  - `class AppError extends Error { constructor(public code: ErrorCode, public status: number, message?: string, public details?: unknown) }`
  - `GlobalErrorFilter` — maps `AppError`; `ZodError` → 400 `VALIDATION_FAILED` with `details = issues`; Mongo duplicate key (`code === 11000`) → 409 with code chosen by the throwing service (services catch and rethrow; the filter's fallback is `VALIDATION_FAILED`); `ThrottlerException` → 429 `RATE_LIMITED`; Nest `NotFoundException` → 404 `NOT_FOUND`; everything else → 500 `INTERNAL` without leaking the message in production.
  - `ZodPipe(schema)` — Nest `PipeTransform` that `schema.parse`s.
  - `encodeCursor({createdAt: Date, id: string}): string` (base64url JSON), `decodeCursor(s?: string): {createdAt: Date, id: ObjectId} | null` (invalid → `null`, never throws), `cursorFilter(c)` → `{ $or: [{createdAt: {$lt}}, {createdAt: c.createdAt, _id: {$lt}}] }`, `pageOf<T>(docs: T[], limit): { items: T[], nextCursor: string | null }` (query fetches `limit+1`).
  - `toObjectId(s: string): ObjectId` — invalid → `AppError('NOT_FOUND', 404)`.
  - `interface MailPort { send(msg: { to: string; subject: string; text: string }): Promise<void> }`, token `MAIL`; `MailService` uses nodemailer when `smtpUrl` set, else `console.log`.
  - `type JobName = 'process-file' | 'relocate-variants' | 'cleanup-uploads' | 'purge-deleted-posts' | 'reconcile-counters'`; `interface JobsPort { enqueue(name: JobName, data: Record<string, unknown>): Promise<void> }`, token `JOBS`. The API process uses `AgendaJobs` (Task 9) — until then `JobsModule` binds a no-op.
  - `createTestHarness(): Promise<Harness>` where `Harness = { app: INestApplication; http: () => supertest.Agent; db: mongoose.Connection; mail: { sent: Array<{to,subject,text}>; lastLinkFor(email): string }; jobs: { enqueued: Array<{name,data}>; clear(): void }; reset(): Promise<void>; close(): Promise<void> }`. It overrides `CONFIG` with `mongoUri = MONGODB_URI_TEST` and test bucket names, `MAIL` with a capture, `JOBS` with a recorder; throws `Error('Refusing to run tests against non-_test database')` unless the db name ends in `_test`. `reset()` drops all collections and re-runs index creation.
- `main.ts`: `app.setGlobalPrefix('api', { exclude: ['og/(.*)'] })`, `cookie-parser`, CORS `{ origin: config.appUrl, credentials: true }`, `GET /api/health → { ok: true }`.
- Build/test config: `nest-cli.json` `{ "compilerOptions": { "builder": "swc", "typeCheck": true } }`; `vitest.config.ts` uses `unplugin-swc` so decorator metadata is emitted, `pool: 'forks'`, `fileParallelism: false` (one shared test DB).

- [ ] **Step 1: Write failing tests**

```ts
// skeleton.e2e.test.ts
it('health', async () => { await h.http().get('/api/health').expect(200, { ok: true }) })
it('unknown route uses error envelope', async () => {
  const r = await h.http().get('/api/nope').expect(404)
  expect(r.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } })
})
it('harness refuses non-test db', async () => {
  process.env.MONGODB_URI_TEST = 'mongodb://localhost:27017/CukaDB'
  await expect(createTestHarness()).rejects.toThrow(/non-_test/)
})
// cursor.test.ts
expect(decodeCursor('garbage')).toBeNull()
expect(decodeCursor(encodeCursor({ createdAt: d, id }))!.id.toHexString()).toBe(id)
```

- [ ] **Step 2:** Run `npm -w @cuka/api test`. Expected: FAIL.
- [ ] **Step 3:** Implement the files above. API package scripts: `dev` (`nest start --watch`), `build` (`nest build`), `test` (`vitest run`), `type-check` (`tsc --noEmit`), `setup` and `create-admin` (Task 4 / Task 7, run compiled `dist/scripts/*.js` after `nest build`).
- [ ] **Step 4:** Run `npm -w @cuka/api test`. Expected: PASS (requires local MongoDB running).
- [ ] **Step 5: Commit** — `feat(api): nest skeleton, config, error envelope, test harness`

---

### Task 4: Settings, storage (MinIO), indexes, setup script

**Files:**
- Create: `src/settings/*`, `src/storage/*`, `src/database/indexes.ts`, `scripts/setup.ts`
- Test: `test/storage.e2e.test.ts`, `test/settings.e2e.test.ts`, `test/setup.e2e.test.ts`

**Interfaces:**
- Produces:
  - `SettingsService.get(): Promise<GlobalSettings>` (reads `settings` `_id: 'global'`, missing keys filled from `DEFAULT_SETTINGS`, 30 s in-memory cache), `update(patch: Partial<GlobalSettings>): Promise<GlobalSettings>` (clears cache).
  - `StorageService`:
    - `presignPost(bucket, key, maxBytes, contentType): Promise<{ url: string; fields: Record<string,string> }>` — policy `content-length-range 1..maxBytes`, `Content-Type` fixed, 15 min expiry.
    - `presignGet(bucket, key, opts?: { downloadName?: string }): Promise<string>` — 10 min; `downloadName` sets `response-content-disposition: attachment; filename*=UTF-8''…`.
    - `stat(bucket, key): Promise<{ size: number } | null>` (missing → null)
    - `readHead(bucket, key, bytes: number): Promise<Buffer>` (range read)
    - `getBuffer(bucket, key): Promise<Buffer>`, `getToFile(bucket, key, path)`, `put(bucket, key, body: Buffer, contentType): Promise<void>`, `remove(bucket, key): Promise<void>` (missing is not an error), `copy(srcBucket, srcKey, dstBucket, dstKey)`
    - `publicUrl(key): string` → `${minio.publicUrl}/${bucketPublic}/${key}`
    - `objectKey(userId, fileId, name: 'original' | VariantName, ext): string` → `${userId}/${fileId}/${name}.${ext}`
  - `ensureIndexes(conn: mongoose.Connection): Promise<void>` — every index in spec §3.2 plus the unique indexes of §3.1 and TTL indexes (`authTokens.expiresAt` expireAfterSeconds 0; `notifications.createdAt` 7776000). Models are registered by later tasks; this function calls `syncIndexes()` on every registered model, so each schema file declares its own indexes and this task's test only covers settings/storage.
  - `scripts/setup.ts`: connects with `loadConfig(process.env)`, runs `ensureIndexes`, upserts settings doc with `DEFAULT_SETTINGS` (`$setOnInsert`, never overwrites admin edits), creates both buckets if missing, sets `cuka-public` anonymous read-only policy (`s3:GetObject` on `arn:aws:s3:::<bucket>/*`), prints a summary. Idempotent.

- [ ] **Step 1: Write failing tests**

```ts
it('settings defaults', async () => expect(await settings.get()).toEqual(DEFAULT_SETTINGS))
it('settings update persists', async () => {
  await settings.update({ reportAiHideThreshold: 2 }); expect((await settings.get()).reportAiHideThreshold).toBe(2)
})
it('presigned POST rejects body over limit', async () => {
  const { url, fields } = await storage.presignPost(bucket, 'k', 10, 'image/png')
  const res = await postMultipart(url, fields, Buffer.alloc(11)) // helper in harness using fetch + FormData
  expect(res.status).toBe(400)
})
it('presigned POST accepts body within limit and stat sees it', async () => { /* 10 bytes → 204; stat size 10 */ })
it('stat of missing object is null', async () => expect(await storage.stat(bucket, 'nope')).toBeNull())
it('setup is idempotent and keeps edited settings', async () => {
  await runSetup(cfg); await settings.update({ reportHideThreshold: 9 }); await runSetup(cfg)
  expect((await settings.get()).reportHideThreshold).toBe(9)
})
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- storage settings setup`. Expected: FAIL.
- [ ] **Step 3:** Implement. Export `runSetup(cfg: Config): Promise<void>` from `scripts/setup.ts` (the CLI entry calls it) so the test can call it with test bucket names. The harness creates/empties the test buckets in `reset()`.
- [ ] **Step 4:** Run the same command. Expected: PASS (requires local MinIO).
- [ ] **Step 5: Commit** — `feat(api): settings service, MinIO storage, setup script`

---

### Task 5: Users model and registration/login/refresh/logout

**Files:**
- Create: `src/users/user.schema.ts`, `src/users/users.service.ts`, `src/auth/{auth-token.schema.ts,tokens.ts,auth.service.ts,auth.controller.ts,auth.module.ts}`
- Test: `test/auth.e2e.test.ts`

**Interfaces:**
- Produces:
  - `User` Mongoose schema exactly as spec §3.1 (`email` lowercased, unique; `profile.username` unique; `role` default `user`; `status` default `active`; `showR18` default false; `locale` default `vi`; `stats` defaults 0).
  - `AuthToken` schema (`type`, `tokenHash`, `expiresAt`, `usedAt`, plus `familyId` for refresh tokens).
  - `tokens.ts`: `randomToken(): string` (32 bytes base64url), `hashToken(t): string` (sha256 hex), `signAccess(user): string` (payload `{ sub, role }`, 15 min), `verifyAccess(token): { sub: string; role: Role } | null`.
  - `AuthService.register(input) → { userId }` — argon2id hash; sends verify email with link `${appUrl}/verify-email?token=…` (24 h); duplicate email → 409 `EMAIL_TAKEN`, duplicate username → 409 `USERNAME_TAKEN`.
  - `AuthService.login(email, password) → { accessToken, refreshToken, user }` — wrong email or password → 401 `INVALID_CREDENTIALS` (same message for both); `banned` → 403 `ACCOUNT_BANNED`; updates `lastLoginAt`.
  - `AuthService.refresh(rawRefresh) → { accessToken, refreshToken }` — rotates: marks old `usedAt`, issues new token in same `familyId`. Presenting an already-used token revokes every refresh token of that user (delete all `type:'refresh'`) and returns 401 `TOKEN_INVALID`.
  - `AuthService.logout(rawRefresh)` — deletes that token; idempotent.
  - Controller: `POST /api/auth/register` (201 `{ userId }`), `POST /api/auth/login` (200 `{ accessToken, user: MeDto }` + sets cookie `cuka_rt`), `POST /api/auth/refresh` (reads cookie; 200 `{ accessToken, user }` + new cookie), `POST /api/auth/logout` (204, clears cookie).
  - `MeDto = { id, email, role, status, emailVerified: boolean, locale, showR18, birthDate: string|null, profile }` — produced by `UsersService.toMe(user)`.
  - Throttling (`@nestjs/throttler`): login 5/min keyed by `ip + email`; register 3/hour per IP. The test harness sets a `THROTTLE_DISABLED` override except in the throttle test.

- [ ] **Step 1: Write failing tests**

```ts
it('register → login → refresh rotates → old refresh rejected and family revoked')
  // register 201; login 200 sets cuka_rt; refresh with cookie A → 200 cookie B;
  // refresh with A again → 401 TOKEN_INVALID; refresh with B → 401 (revoked)
it('duplicate email → 409 EMAIL_TAKEN; duplicate username → 409 USERNAME_TAKEN')
it('wrong password and unknown email give identical 401 INVALID_CREDENTIALS bodies')
it('banned user cannot log in → 403 ACCOUNT_BANNED')
it('logout clears cookie and refresh afterwards → 401')
it('6th login attempt in a minute → 429 RATE_LIMITED')
it('password is stored as argon2id hash', async () => expect(user.passwordHash).toMatch(/^\$argon2id\$/))
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- auth`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): registration, login, rotating refresh tokens`

---

### Task 6: Email verification, password reset, auth guard and viewer

**Files:**
- Create: `src/auth/{auth.guard.ts,viewer.ts,decorators.ts}`
- Modify: `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`
- Test: `test/auth-email.e2e.test.ts`, `test/guard.e2e.test.ts`

**Interfaces:**
- Produces:
  - `type Viewer = { id: string; role: Role; status: UserStatus; emailVerified: boolean; isAdult: boolean; showR18: boolean }`.
  - `isAdult(birthDate: Date | null, now = new Date()): boolean` — false when null; true when ≥ 18 full years.
  - `canSeeR18(v: Viewer | null): boolean` → `!!v && v.isAdult && v.showR18`.
  - Global `AuthGuard`: parses `Authorization: Bearer`; loads the user (status, verified, birthDate, showR18) and sets `req.viewer`; **an invalid/expired token on a route without `@Auth()` sets `viewer = null` and continues** (Review Focus 1). `banned` users are treated as anonymous.
  - Decorators: `@Auth(opts?: { verified?: boolean; roles?: Role[]; write?: boolean })` — no viewer → 401 `UNAUTHENTICATED`; `verified` and not verified → 403 `EMAIL_NOT_VERIFIED`; `write` and `suspended` → 403 `ACCOUNT_SUSPENDED`; `roles` not matched → 403 `FORBIDDEN`. `@CurrentViewer()` param decorator returns `Viewer | null`.
  - Endpoints: `POST /api/auth/verify-email {token}` (204; token type `verify_email`, single use, sets `emailVerifiedAt`), `POST /api/auth/resend-verification` (`@Auth()`, 204, 3/hour), `POST /api/auth/forgot-password {email}` (always 204; sends link `${appUrl}/reset-password?token=…`, 1 h; 3/hour per IP), `POST /api/auth/reset-password {token, password}` (204; single use; deletes all refresh tokens of the user).

- [ ] **Step 1: Write failing tests**

```ts
it('verify link from email marks user verified; reusing token → 400 TOKEN_INVALID')
it('forgot-password for unknown email still 204 and sends nothing')
it('reset-password changes password and revokes existing refresh cookies')
it('expired token (2 h old) for reset → 400 TOKEN_INVALID') // set expiresAt in the past directly
it('public route with garbage bearer token behaves as anonymous (200)') // GET /api/health with header
it('@Auth route with garbage token → 401 UNAUTHENTICATED')
it('@Auth({verified:true}) with unverified user → 403 EMAIL_NOT_VERIFIED')
it('@Auth({write:true}) with suspended user → 403 ACCOUNT_SUSPENDED')
it('isAdult boundary', () => {
  expect(isAdult(new Date('2008-10-17'), new Date('2026-10-17'))).toBe(true)
  expect(isAdult(new Date('2008-10-18'), new Date('2026-10-17'))).toBe(false)
  expect(isAdult(null)).toBe(false)
})
```

Guard tests use a test-only controller registered by the harness (`/api/__test/{public,auth,verified,write}`).

- [ ] **Step 2:** Run `npm -w @cuka/api test -- auth-email guard`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add harness helper `createUser(h, opts?: { role?: Role; verified?: boolean; status?: UserStatus; birthDate?: string; showR18?: boolean }): Promise<{ id: string; token: string; email: string; username: string }>` that inserts directly via the model and signs an access token.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): email verification, password reset, auth guard`

---

### Task 7: Me, profiles, follow-free user endpoints, create-admin

**Files:**
- Create: `src/users/{me.controller.ts,users.controller.ts,users.module.ts}`, `scripts/create-admin.ts`
- Modify: `src/users/users.service.ts`
- Test: `test/users.e2e.test.ts`, `test/create-admin.e2e.test.ts`

**Interfaces:**
- Consumes: `Viewer`, `@Auth`, `UsersService.toMe`.
- Produces:
  - `GET /api/me` → `MeDto`; `PATCH /api/me` (`updateProfileSchema`, `@Auth({write:true})`) — `avatarFileId`/`bannerFileId` must be the viewer's own `ready` image files (validated once Task 8 exists; this task stores the id after checking `files` collection, so the check lands here and its test is in Task 8).
  - `PATCH /api/me/settings` (`updateSettingsSchema`) — setting `showR18: true` while `birthDate` is null (after applying the patch) → 400 `AGE_REQUIRED`; setting it while not adult → 400 `AGE_REQUIRED` (Review Focus 2).
  - `POST /api/me/password` (`changePasswordSchema`) — wrong current → 400 `INVALID_CREDENTIALS`; success revokes other refresh tokens.
  - `GET /api/users/:username` → `PublicUserDto = { id, username, displayName, bio, avatarUrl: string|null, bannerUrl: string|null, socialLinks, stats, createdAt, isFollowing: boolean }`. `banned` users → 404. `isFollowing` false until Task 12 fills it.
  - `UsersService.publicAvatarUrl(fileId)` — uses `thumb_md` variant public URL when present, else null.
  - `scripts/create-admin.ts` with exported `createAdmin(cfg, { email, password, username }): Promise<string>` — creates a verified `admin`, or promotes an existing user with that email to `admin` (and verifies). CLI parses `--email --password --username`.

- [ ] **Step 1: Write failing tests**

```ts
it('PATCH /me updates displayName and bio; bio of 501 chars → 400 VALIDATION_FAILED')
it('showR18 without birthDate → 400 AGE_REQUIRED')
it('showR18 with birthDate making user 17 → 400 AGE_REQUIRED')
it('birthDate + showR18 in one request for adult → 200 and /me shows showR18 true')
it('GET /users/:username for banned user → 404')
it('change password with wrong current → 400 INVALID_CREDENTIALS')
it('createAdmin promotes existing user and is idempotent')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- users create-admin`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): me/profile endpoints and create-admin script`

---

### Task 8: Uploads (presign → complete)

**Files:**
- Create: `src/uploads/{file.schema.ts,uploads.service.ts,uploads.controller.ts,uploads.module.ts}`
- Create: `test/fixtures/tiny.png`, `test/fixtures/fake.zip` (a real zip renamed later in the test), `test/fixtures/tiny.jpg` (contains EXIF GPS)
- Test: `test/uploads.e2e.test.ts`

**Interfaces:**
- Consumes: `StorageService`, `SettingsService`, `JobsPort`, `@Auth`.
- Produces:
  - `FileDoc` schema per spec §3.1, index `{ status:1, createdAt:1 }`, `{ ownerId:1, createdAt:-1 }`.
  - `POST /api/uploads` (`@Auth({verified:true, write:true})`, `createUploadSchema`) → 201 `{ fileId, url, fields, maxBytes }`. Checks, in order: `size > settings.maxFileBytes` → 413 `FILE_TOO_LARGE`; `kindForMime(mime, ext) === null` → 415 `FILE_TYPE_NOT_ALLOWED`; sum of `sizeBytes` of the owner's files created in the last 24 h + `size` > `dailyUploadQuotaBytes` → 429 `UPLOAD_QUOTA_EXCEEDED`. Object goes to `bucketOriginals` key `objectKey(userId, fileId, 'original', ext)`.
  - `POST /api/uploads/:id/complete` → 200 `FileDto = { id, kind, mimeType, sizeBytes, status, originalName }`. Only owner; not `uploading` → return current state (idempotent). `stat` missing → 400 `UPLOAD_NOT_FOUND`; `stat.size > maxFileBytes` → remove object, mark `failed`, 413 `FILE_TOO_LARGE`; detect type from `readHead(…, 4100)` via `file-type` (`fileTypeFromBuffer`); for `clip` (no signature) accept only when the declared ext is `clip` and detection returns undefined; detected kind ≠ declared kind or detected mime not in `ALLOWED_FILE_TYPES` → remove, `failed`, 415 `FILE_TYPE_NOT_ALLOWED` (Review Focus 3). Success → set `mimeType` to the detected one, `sizeBytes` to stat size, `status: 'processing'`, `jobs.enqueue('process-file', { fileId })`.
  - `UploadsService.assertUsableFiles(ownerId, fileIds: string[]): Promise<FileDoc[]>` — all exist, owned, `status ∈ {processing, ready}`; otherwise 400 `FILE_NOT_READY`. Used by posts and by `PATCH /me` (avatar/banner: additionally `kind === 'image'`).

- [ ] **Step 1: Write failing tests**

```ts
it('presign: size 52428801 → 413 FILE_TOO_LARGE')
it('presign: application/x-msdownload → 415 FILE_TYPE_NOT_ALLOWED')
it('presign: quota exceeded → 429') // settings.update({dailyUploadQuotaBytes: 100})
it('presign + upload tiny.png + complete → processing and process-file enqueued', async () => {
  expect(h.jobs.enqueued).toContainEqual({ name: 'process-file', data: { fileId } })
})
it('zip declared as image/png → complete 415 and object removed', async () => {
  expect(await storage.stat(bucketOriginals, key)).toBeNull()
})
it('complete without uploading the object → 400 UPLOAD_NOT_FOUND')
it('complete by another user → 404 NOT_FOUND')
it('complete twice returns same state, enqueues once')
it('PATCH /me avatarFileId of someone else’s file → 400 FILE_NOT_READY')
```

Uploading in tests: harness helper `uploadFixture(h, user, fixtureName, declared?: {mime, name}): Promise<string /* fileId */>` that calls presign, POSTs multipart to MinIO with `fetch` + `FormData`, and calls complete.

- [ ] **Step 2:** Run `npm -w @cuka/api test -- uploads`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): presigned uploads with server-side size and magic-byte checks`

---

### Task 9: Media processing jobs and worker process

**Files:**
- Create: `src/jobs/agenda-jobs.ts`, `src/jobs/handlers/{media.ts,process-file.ts,relocate-variants.ts}`, `apps/worker/{package.json,tsconfig.json,src/main.ts}`
- Create: `test/fixtures/one-second.mp4`, `test/fixtures/tone.mp3` (generate with ffmpeg: `ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=10 one-second.mp4`, `ffmpeg -f lavfi -i sine=duration=1 tone.mp3`; commit the outputs)
- Test: `test/process-file.e2e.test.ts`

**Interfaces:**
- Consumes: `StorageService`, models `FileDoc`, `Post` (only `rating` lookup: a file belongs to at most one post via `posts.files.fileId`; no post yet → treat as `all`).
- Produces:
  - `media.ts`: `probe(path, ffprobePath): Promise<{ durationSec: number; width?: number; height?: number }>` (spawn `ffprobe -v error -print_format json -show_format -show_streams`), `extractFrame(path, outPath, atSec: number, ffmpegPath): Promise<void>` (`-ss atSec -frames:v 1`; for clips shorter than `atSec` use 0).
  - `type JobDeps = { conn: mongoose.Connection; storage: StorageService; config: Config }`.
  - `processFile(deps, { fileId }): Promise<void>`:
    - image: `sharp(buf, { animated: false }).rotate()` → `thumb_sm` width 360 and `thumb_md` width 1200 (`withoutEnlargement`, webp, quality 82; sharp drops EXIF by default — do not call `withMetadata`). Store width/height of the original.
    - video: download to a temp file, `probe`, `extractFrame` at 1 s → webp `preview` (max width 1200) and `thumb_sm`/`thumb_md` from that frame.
    - audio: `probe` → `durationSec`; no variants.
    - source/archive: no variants.
    - Variant destination: rating `all` → `bucketPublic`; `r18` → `bucketOriginals`, plus `blurred` (from `thumb_md`, `sharp().blur(40)`, width 600) in `bucketOriginals`.
    - Sets `status: 'ready'`; temp files removed in `finally`.
  - `relocateVariants(deps, { postId }): Promise<void>` — for each file of the post, move variants to the bucket matching the post's current rating (copy then remove), create `blurred` when becoming `r18`, remove it when becoming `all`.
  - `AgendaJobs implements JobsPort` — `new Agenda({ mongo: conn.db, db: { collection: 'jobs' } })`, `enqueue` = `agenda.now(name, data)`. The API binds `JOBS` to it (it only enqueues; it never calls `start()`).
  - `apps/worker/src/main.ts` — builds a Nest application context from `AppModule`, defines `process-file` and `relocate-variants` with `{ concurrency: 2 }`; failure handler retries with `job.schedule('in 1 minute')` while `job.attrs.failCount < 3`, otherwise sets the file `status: 'failed'` (for `process-file`). Recurring jobs are added in Task 18. The worker has its own `nest-cli.json` (swc builder, same as the API, so decorator metadata is emitted) and imports API source through a `tsconfig` path alias `@cuka/api/*` → `../api/src/*` (swc resolves it via `nest-cli.json` `compilerOptions.tsConfigPath`). Scripts: `dev` (`nest start --watch`), `build` (`nest build`), `start` (`node dist/main.js`).

- [ ] **Step 1: Write failing tests**

```ts
it('image: thumb_sm 360w and thumb_md ≤1200w in public bucket, status ready, no EXIF', async () => {
  const meta = await sharp(await storage.getBuffer(bucketPublic, thumbMdKey)).metadata()
  expect(meta.width).toBeLessThanOrEqual(1200); expect(meta.exif).toBeUndefined()
})
it('video: preview + thumbs exist and durationSec ≈ 1', async () => expect(file.durationSec).toBeCloseTo(1, 0))
it('audio: durationSec set, no variants')
it('r18 post file: variants in originals bucket and blurred exists')
it('relocate all→r18 moves variants to originals and adds blurred; r18→all reverses')
it('corrupt image (zip bytes saved as image kind) throws so the worker retries') // processFile rejects
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- process-file`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS. Then start the worker once (`npm -w @cuka/worker run dev`) against the dev DB and confirm it logs `worker ready`.
- [ ] **Step 5: Commit** — `feat(worker): media processing jobs with sharp and ffmpeg`

---

### Task 10: Posts — create, read, update, delete, visibility, file URLs

**Files:**
- Create: `src/posts/{post.schema.ts,visibility.ts,posts.service.ts,posts.controller.ts,file-urls.ts,posts.module.ts}`, `src/tags/{tag.schema.ts,tags.service.ts,tags.module.ts}`
- Test: `test/visibility.test.ts` (unit), `test/posts.e2e.test.ts`

**Interfaces:**
- Consumes: `Viewer`, `canSeeR18`, `UploadsService.assertUsableFiles`, `JobsPort`, `StorageService`, `normalizeTag`.
- Produces:
  - `Post` schema per spec §3.1 with indexes of §3.2 (text index weights: title 5, tags 3, description 1).
  - `visibility.ts`:
    - `type PostContext = 'feed' | 'direct'`
    - `visiblePostsFilter(viewer: Viewer | null, context: PostContext): FilterQuery<Post>` — exactly the table in spec §5.3; `feed` adds `rating: 'all'` unless `canSeeR18(viewer)`.
    - `canViewPost(viewer, post): boolean` — owner/moderator/admin see every non-deleted state; others per `direct` rules.
    - `isStaff(viewer): boolean` (moderator or admin).
  - `TagsService.applyDelta(added: string[], removed: string[])` — `$inc postCount` (upsert `display` on first use; `display` = raw text minus `#`).
  - `file-urls.ts`: `buildMedia(post, files, viewer): PostMediaDto[]` with `PostMediaDto = { fileId, kind, position, isCover, status, width?, height?, durationSec?, thumbSmUrl: string|null, thumbMdUrl: string|null, previewUrl: string|null, blurred: boolean }`. For `all`: public URLs. For `r18` and `!canSeeR18(viewer)`: only the presigned URL of `blurred` in `thumbMdUrl`/`thumbSmUrl`, `blurred: true`. For `r18` and eligible: presigned URLs. Files still `processing` → null URLs.
  - `PostDto = { id, type, title, description, rating, tags: string[], sourceCredit, review: { status, reason?: string }, visibility, counts, author: { id, username, displayName, avatarUrl }, media: PostMediaDto[], viewerState: { liked: boolean; bookmarked: boolean }, createdAt, updatedAt }`. `review.reason` only for owner/staff; `viewerState` false until Task 12.
  - `PostCardDto` = `{ id, type, title, rating, cover: PostMediaDto | null, pageCount, counts, author, createdAt }` for lists.
  - Endpoints:
    - `POST /api/posts` (`@Auth({verified:true, write:true})`, `createPostSchema`) → 201 `PostDto`. Rules: `files.length > settings.maxFilesPerPost` → 400 `TOO_MANY_FILES`; `assertUsableFiles` (failed → 400 `FILE_NOT_READY`, Review Focus 5); no file of kind image/video/audio → 400 `POST_NEEDS_MEDIA`; exactly one `isCover` (default the lowest position); tags normalized + deduped, invalid ones dropped; `review.status: 'pending'`; increments `users.stats.postCount`; `TagsService.applyDelta`; if `rating === 'r18'` enqueue `relocate-variants` (files processed before the post existed went to the public bucket).
    - `GET /api/posts/:id` → `PostDto`, or 404 `POST_NOT_FOUND` when `!canViewPost`. Increments `counts.views` (fire-and-forget `$inc`, not for the author).
    - `PATCH /api/posts/:id` (owner only, `updatePostSchema`) — review reset rules of spec §5.4: `files` set changed (compare fileId sets and order-insensitive) → `pending`; rating `r18 → all` → `pending`; `rejected` + any edit → `pending`; title/description/tags/credit only → keep. Rating change enqueues `relocate-variants`. Clears `review.reason` when moving to `pending`.
    - `DELETE /api/posts/:id` (owner or staff) → 204, sets `deletedAt`, decrements `users.stats.postCount`, `TagsService.applyDelta([], tags)`.
    - `GET /api/posts/:id/files/:fileId/url` → `{ url }` presigned GET of the original with `downloadName = originalName`; requires `canViewPost` and, for r18, `canSeeR18`.
    - `GET /api/users/:username/posts` (cursor) → `{ items: PostCardDto[], nextCursor }` using `direct` rules (owner/staff see their pending/rejected/hidden too).

- [ ] **Step 1: Write failing tests**

```ts
// visibility.test.ts — table-driven over review × visibility × rating × viewer ∈ {anon, other, owner, mod, adultR18}
expect(matches(visiblePostsFilter(null, 'feed'), post({ review: 'pending' }))).toBe(false)
expect(matches(visiblePostsFilter(null, 'direct'), post({ review: 'pending' }))).toBe(true)
expect(matches(visiblePostsFilter(null, 'direct'), post({ review: 'rejected' }))).toBe(false)
expect(matches(visiblePostsFilter(adultR18, 'feed'), post({ review: 'approved', rating: 'r18' }))).toBe(true)
expect(matches(visiblePostsFilter(other, 'feed'), post({ review: 'approved', rating: 'r18' }))).toBe(false)
expect(canViewPost(owner, post({ visibility: 'hidden_by_reports' }))).toBe(true)
expect(canViewPost(other, post({ visibility: 'hidden_by_reports' }))).toBe(false)
// `matches` = run the filter against an in-memory collection via the test DB (insert + countDocuments)

// posts.e2e.test.ts
it('create with aiDeclaration false → 400 VALIDATION_FAILED')
it('create with only a zip → 400 POST_NEEDS_MEDIA')
it('create with a failed file → 400 FILE_NOT_READY')
it('create with a processing file → 201 and media url null')
it('new post is pending and visible by direct link to anonymous')
it('tags "#DuCaArt", "ducaart" dedupe to ["ducaart"] and tags.postCount = 1')
it('edit title of approved post keeps approved; replacing a file → pending')
it('rejected post edited → pending and reason cleared')
it('r18 post: anonymous gets blurred=true and no original URL; adult with showR18 gets presigned URLs')
it('file url endpoint for r18 post by ineligible viewer → 404 POST_NOT_FOUND')
it('delete by non-owner user → 403 FORBIDDEN; by moderator → 204')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- visibility posts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add harness helper `createPost(h, user, overrides?): Promise<string>` that uploads `tiny.png`, runs `processFile` inline and creates the post; `approve(h, postId)` sets `review.status` directly.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): posts CRUD, visibility rules, media URLs, tags`

---

### Task 11: Feeds, search, tag suggestions

**Files:**
- Create: `src/feed/{feed.service.ts,feed.controller.ts,feed.module.ts}`, `src/tags/tags.controller.ts`
- Test: `test/feed.e2e.test.ts`

**Interfaces:**
- Consumes: `visiblePostsFilter`, cursor helpers, `PostCardDto` builder from `PostsService.toCards(posts, viewer)`.
- Produces:
  - `GET /api/feed/home?cursor&limit` → `{ items: PostCardDto[], nextCursor }`, `feed` filter, newest first.
  - `GET /api/feed/following` (`@Auth()`) — `feed` filter + `authorId ∈` viewer's followees (Task 12 creates `follows`; until then returns empty; its test lives in Task 12).
  - `GET /api/search?q&tag&type&cursor&limit` — `feed` filter; `tag` → `normalizeTag` then `tags: tag`; `q` → `$text: { $search: q }` (still sorted by `createdAt` desc so the cursor stays valid); `type` filter.
  - `GET /api/tags/suggest?q` → `[{ name, display, postCount }]`, prefix match on `_id` of `normalizeTag(q)`, top 10 by `postCount`.
  - `GET /api/tags/featured` → the tags `ducaart`, `hibikiduca`, `wearecuka` (constant `FEATURED_TAGS` in `tags.service.ts`) with their counts (0 if absent).

- [ ] **Step 1: Write failing tests**

```ts
it('home shows only approved+public, newest first, 30 per page with working nextCursor') // seed 35
it('home hides r18 from anonymous and from adult without showR18; shows to eligible')
it('home excludes hidden_by_reports and deleted posts')
it('search tag "#DuCaArt" finds posts tagged ducaart')
it('search q matches title words')
it('invalid cursor is treated as first page')
it('tags/suggest "du" returns ducaart before less-used tags')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- feed`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): home feed, search and tag suggestions`

---

### Task 12: Likes, bookmarks, follows (+ notifications service)

**Files:**
- Create: `src/interactions/*`, `src/notifications/{notification.schema.ts,notifications.service.ts,notifications.module.ts}`
- Modify: `src/posts/posts.service.ts` (fill `viewerState`), `src/users/users.service.ts` (`isFollowing`), `src/feed/feed.service.ts` (following feed)
- Test: `test/interactions.e2e.test.ts`

**Interfaces:**
- Produces:
  - Schemas `Like`, `Bookmark`, `Follow` with the unique compound indexes of spec §3.1 and `{ followeeId: 1 }`.
  - `NotificationsService.notify(n: { userId: string; type: NotificationType; actorId?: string; postId?: string; commentId?: string }): Promise<void>` — never notifies a user about their own action (`actorId === userId` → no-op). Notification schema per §3.1, TTL 90 days.
  - `InteractionsService`:
    - `like(viewer, postId)` / `unlike` — insert; duplicate key → no-op returning current state; on insert `$inc counts.likes: 1`; on delete (only if a doc was deleted) `$inc -1`. Returns `{ liked: boolean; likes: number }`. Notifies author (`like`).
    - `bookmark(viewer, postId, isPrivate: boolean)` / `unbookmark` — same pattern on `counts.bookmarks`; re-bookmarking updates `isPrivate` without incrementing. Returns `{ bookmarked, bookmarks }`.
    - `follow(viewer, username)` / `unfollow` — self → 400 `CANNOT_FOLLOW_SELF`; same pattern on `stats.followerCount` (followee) and `stats.followingCount` (follower). Notifies followee (`follow`). Returns `{ following, followerCount }`.
    - The target post must pass `canViewPost`; otherwise 404.
  - Endpoints: `POST|DELETE /api/posts/:id/like`, `POST|DELETE /api/posts/:id/bookmark` (body `{ isPrivate?: boolean }`), `POST|DELETE /api/users/:username/follow`, `GET /api/users/:username/followers`, `GET /api/users/:username/following` (cursor, `PublicUserDto` without stats), `GET /api/users/:username/bookmarks` (cursor; others see only `isPrivate: false` and posts passing `feed` rules; the owner sees all theirs that pass `direct` rules). All writes `@Auth({ write: true })`.

- [ ] **Step 1: Write failing tests**

```ts
it('two parallel likes → counts.likes === 1 and both 200', async () => {
  await Promise.all([like(), like()]); expect((await getPost()).counts.likes).toBe(1)
})
it('unlike when not liked does not go negative')
it('like notifies author once; liking own post creates no notification')
it('re-bookmark with isPrivate true does not increment and hides it from others’ bookmark list')
it('follow self → 400 CANNOT_FOLLOW_SELF; follow twice → followerCount 1')
it('following feed shows approved posts of followees only')
it('GET post shows viewerState.liked true for the liker')
it('suspended user like → 403 ACCOUNT_SUSPENDED')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- interactions`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): likes, bookmarks, follows with idempotent counters`

---

### Task 13: Comments

**Files:**
- Create: `src/comments/*`
- Test: `test/comments.e2e.test.ts`

**Interfaces:**
- Consumes: `canViewPost`, `NotificationsService.notify`, `isStaff`.
- Produces:
  - `Comment` schema per §3.1, index `{ postId: 1, createdAt: 1 }`.
  - `GET /api/posts/:id/comments?cursor` — oldest first, top-level only, each with up to all `replies` (`CommentDto = { id, body, author, parentId, status, createdAt, replies?: CommentDto[] }`); `hidden` comments shown to others as `{ status: 'hidden', body: '' }`, to staff and author in full; deleted ones omitted.
  - `POST /api/posts/:id/comments` (`@Auth({verified:true, write:true})`, `createCommentSchema`, throttle 10/min) — `parentId` must belong to the same post and have `parentId === null`, otherwise 400 `REPLY_DEPTH_EXCEEDED` (wrong post → 404 `COMMENT_NOT_FOUND`). `$inc counts.comments`. Notifies post author (`comment`) and, for replies, parent author (`reply`); one notification per user.
  - `DELETE /api/comments/:id` (author or staff) → 204, soft delete, `$inc counts.comments: -1`.

- [ ] **Step 1: Write failing tests**

```ts
it('reply to a reply → 400 REPLY_DEPTH_EXCEEDED')
it('reply notifies parent author (reply) and post author (comment); same person gets one')
it('hidden comment body is empty for others and full for staff')
it('delete decrements counts.comments')
it('unverified user comment → 403 EMAIL_NOT_VERIFIED')
it('1001-char body → 400 VALIDATION_FAILED')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- comments`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): comments with one-level replies`

---

### Task 14: Notifications endpoints

**Files:**
- Create: `src/notifications/notifications.controller.ts`
- Test: `test/notifications.e2e.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/notifications?cursor` (`@Auth()`) → `{ items: NotificationDto[], nextCursor }`, `NotificationDto = { id, type, actor: {username, displayName, avatarUrl} | null, post: {id, title} | null, commentId, reason?: string, readAt, createdAt }` (`reason` copied from `review.reason` for `post_rejected`).
  - `GET /api/notifications/unread-count` → `{ count }`.
  - `POST /api/notifications/read` body `{ ids?: string[]; all?: boolean }` → 204; only the viewer’s own.

- [ ] **Step 1: Write failing tests**

```ts
it('lists newest first and unread-count drops after read {ids}')
it('read {all:true} marks everything read')
it('cannot mark someone else’s notification read (count unchanged for them)')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- notifications`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): notification inbox endpoints`

---

### Task 15: Reports and auto-hide

**Files:**
- Create: `src/reports/{report.schema.ts,reports.service.ts,reports.controller.ts,reports.module.ts}`, `src/moderation/{moderation-log.schema.ts,moderation-log.service.ts}`
- Test: `test/reports.e2e.test.ts`

**Interfaces:**
- Produces:
  - `Report` schema per §3.1 with **unique `(postId, reporterId)`** and `{ status:1, reason:1, createdAt:-1 }`.
  - `ModerationLogService.log(actorId: string | 'system', action: ModAction, targetType: 'post'|'user'|'comment'|'settings', targetId: string, note?: string): Promise<void>`.
  - `POST /api/posts/:id/report` (`@Auth({verified:true, write:true})`, `createReportSchema`, throttle 20/hour) → 201 `{ reported: true }`. Own post → 400 `CANNOT_REPORT_OWN_POST`; post not viewable → 404; duplicate key → 409 `REPORT_ALREADY_EXISTS` (including when an earlier report was dismissed). After insert: `$inc reportCounts.total` (+ `reportCounts.ai_art` when reason `ai_art`), then the conditional `findOneAndUpdate` of spec §3.4 step 3 using current settings thresholds; on match → `ModerationLogService.log('system','auto_hide','post',id, 'total=X ai_art=Y')` and `notify({ userId: author, type: 'post_hidden', postId })`.
  - `ReportsService.recountOpen(postId): Promise<{ total: number; ai_art: number }>` — recompute from `status: 'open'` reports and `$set reportCounts` (used by moderation and reconcile).

- [ ] **Step 1: Write failing tests**

```ts
it('second report by same user → 409 REPORT_ALREADY_EXISTS')
it('parallel duplicate reports → exactly one stored, total 1') // Review Focus 4
it('5 reports of mixed reasons hide the post and log auto_hide')
it('3 ai_art reports hide the post; 2 ai_art + 2 spam do not')
it('threshold change via settings (ai=2) applies to the next report')
it('author receives post_hidden notification once')
it('reporting own post → 400 CANNOT_REPORT_OWN_POST')
it('hidden post disappears from home feed but owner still sees it')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- reports`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): post reports with threshold auto-hide`

---

### Task 16: Moderation endpoints

**Files:**
- Create: `src/moderation/{moderation.service.ts,moderation.controller.ts,moderation.module.ts}`
- Test: `test/moderation.e2e.test.ts`

**Interfaces:**
- Consumes: `ReportsService.recountOpen`, `ModerationLogService.log`, `NotificationsService.notify`, `isStaff`.
- Produces (all `@Auth({ roles: ['moderator','admin'] })`):
  - `assertCanModerate(actor: Viewer, targetUserRole: Role)` — moderator acting on content/accounts of a moderator or admin → 403 `CANNOT_MODERATE_PEER`; admin passes.
  - `GET /api/mod/queue?status=pending|rejected&cursor` → `PostCardDto[]` oldest pending first (FIFO), including r18 with full staff URLs.
  - `POST /api/mod/posts/:id/approve` → `review {status:'approved', by, at}`, log `approve`, notify `post_approved`.
  - `POST /api/mod/posts/:id/reject` (`rejectSchema`) → `rejected` + reason, log, notify `post_rejected`.
  - `POST /api/mod/posts/:id/hide` (`{ note? }`) → `visibility: 'removed'`, log `hide`, notify `post_hidden`. `POST /api/mod/posts/:id/restore` → `visibility: 'public'`, log `restore`.
  - `GET /api/mod/reports?cursor` → grouped by post: `[{ post: PostCardDto, total, aiArt, reasons: Record<ReportReason, number>, latest: [{ reason, detail, reporter: {username}, createdAt }] (max 5) }]`, only posts with open reports, sorted `aiArt > 0` first, then `total` desc, then oldest open report first.
  - `POST /api/mod/reports/posts/:postId/resolve` (`resolveReportsSchema`) — `keep`: open reports → `dismissed`, `recountOpen` (→ 0), `hidden_by_reports` → `public`, log `restore`; `remove`: open → `actioned`, `visibility: 'removed'`, log `remove`, notify `post_hidden`. Both set `resolvedBy/At`.
  - `POST /api/mod/comments/:id/hide` → `status: 'hidden'`, log `hide_comment`.

- [ ] **Step 1: Write failing tests**

```ts
it('user → 403 FORBIDDEN on /mod/queue')
it('approve moves post into home feed and notifies author')
it('reject requires reason; author sees reason in notification and on GET post')
it('report queue lists ai_art-reported posts before more-reported spam posts')
it('resolve keep restores auto-hidden post, zeroes counts, reporters still cannot re-report')
it('resolve remove keeps post out of every feed and profile for others')
it('moderator cannot hide an admin’s post → 403 CANNOT_MODERATE_PEER; admin can')
it('every action writes a moderationLogs entry with the actor id')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- moderation`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): moderation queue, review actions, report resolution`

---

### Task 17: Admin endpoints

**Files:**
- Create: `src/admin/{admin.service.ts,admin.controller.ts,admin.module.ts}`
- Test: `test/admin.e2e.test.ts`

**Interfaces:**
- Produces (all `@Auth({ roles: ['admin'] })`):
  - `GET /api/admin/users?q&role&status&cursor` → `[{ id, email, username, displayName, role, status, emailVerified, createdAt, lastLoginAt, stats }]`; `q` matches email or username prefix (case-insensitive, regex-escaped).
  - `POST /api/admin/users/:id/status` (`adminStatusSchema`) — `banned` deletes the user’s refresh tokens; log `suspend` / `ban` / `unban` (status back to `active`). Acting on self → 400 `CANNOT_CHANGE_OWN_ROLE`.
  - `POST /api/admin/users/:id/role` (`adminRoleSchema`) — self → 400 `CANNOT_CHANGE_OWN_ROLE`; demoting the last `admin` → 400 `LAST_ADMIN`; log `change_role` with note `old→new`.
  - `GET /api/admin/settings` → `GlobalSettings`; `PATCH /api/admin/settings` (`adminSettingsSchema`) → updated settings; log `update_setting` with the changed keys.
  - `GET /api/admin/logs?actorId&action&cursor` → `[{ id, actor: {username} | 'system', action, targetType, targetId, note, createdAt }]`.

- [ ] **Step 1: Write failing tests**

```ts
it('moderator → 403 on /admin/users')
it('ban revokes refresh and login → 403 ACCOUNT_BANNED')
it('suspended user can read but cannot post → 403 ACCOUNT_SUSPENDED')
it('demoting the only admin → 400 LAST_ADMIN; changing own role → 400')
it('PATCH settings maxFileBytes 52428801 → 400; reportHideThreshold 3 → applies to reports')
it('logs list filters by action')
it('q with regex characters "a.*" does not match everything')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- admin`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): admin user management, settings and logs`

---

### Task 18: Maintenance jobs (cleanup, purge, reconcile) and schedules

**Files:**
- Create: `src/jobs/handlers/{cleanup-uploads.ts,purge-deleted-posts.ts,reconcile-counters.ts}`
- Modify: `apps/worker/src/main.ts`
- Test: `test/maintenance.e2e.test.ts`

**Interfaces:**
- Consumes: `JobDeps`, `ReportsService.recountOpen` logic (call the shared function, do not duplicate).
- Produces:
  - `cleanupUploads(deps, now = new Date())` — remove objects + variants and delete `files` docs where (`status ∈ {uploading, failed}` and `createdAt < now-24h`) or (`status ∈ {processing, ready}`, `createdAt < now-24h`, not referenced by any post’s `files.fileId`, and not any user’s `avatarFileId`/`bannerFileId`).
  - `purgeDeletedPosts(deps, now)` — posts with `deletedAt < now-30d`: remove their files (objects + docs) and the post’s likes, bookmarks, comments, reports; delete the post.
  - `reconcileCounters(deps)` — recompute and `$set` where different: `posts.counts.{likes,bookmarks,comments}` (comments: not deleted), `posts.reportCounts` (open only), `users.stats.{followerCount,followingCount,postCount}` (postCount: not deleted), `tags.postCount` (not-deleted posts); returns `{ fixed: number }` and logs it.
  - Worker schedules: `agenda.every('1 hour', 'cleanup-uploads')`, `agenda.every('0 3 * * *', 'purge-deleted-posts')`, `agenda.every('30 3 * * *', 'reconcile-counters')` (server local time).

- [ ] **Step 1: Write failing tests**

```ts
it('cleanup removes 25h-old uploading file and its object; keeps 1h-old one; keeps avatar file')
it('purge removes 31-day-deleted post with its likes/comments/files; keeps 29-day one')
it('reconcile fixes a manually corrupted counts.likes and users.stats.followerCount', async () => {
  await Post.updateOne({ _id }, { 'counts.likes': 99 }); const r = await reconcileCounters(deps)
  expect(r.fixed).toBeGreaterThan(0); expect((await Post.findById(_id)).counts.likes).toBe(1)
})
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- maintenance`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(worker): cleanup, purge and counter reconciliation jobs`

---

### Task 19: Open Graph route and end-to-end smoke

**Files:**
- Create: `src/og/{og.controller.ts,og.module.ts}`
- Test: `test/og.e2e.test.ts`, `test/smoke.e2e.test.ts`

**Interfaces:**
- Produces:
  - `GET /og/posts/:id` (no `/api` prefix) → `text/html` with `og:title`, `og:description` (first 200 chars), `og:image`, `og:url` (`${appUrl}/posts/:id`), `twitter:card=summary_large_image`, and `<meta http-equiv="refresh" content="0;url=${appUrl}/posts/:id">`. `og:image` = public `thumb_md` URL only when the post is `approved`, `public`, `rating: 'all'`; otherwise `${appUrl}/og-default.png`. Unknown or non-viewable post → 404 HTML with the default image. All interpolated text HTML-escaped.

- [ ] **Step 1: Write failing tests**

```ts
it('approved all-ages post has og:image pointing at cuka-public thumb_md')
it('r18 or pending post uses default og image')
it('title with <script> is escaped')
it('smoke: register → verify via mail link → upload → create post → moderator approves → appears in /api/feed/home → 3 ai_art reports → gone from feed')
```

- [ ] **Step 2:** Run `npm -w @cuka/api test -- og smoke`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole suite: `npm test && npm run type-check && npm run build`. Expected: all PASS, builds succeed.
- [ ] **Step 5:** Manual check with the real dev DB: `npm run setup`, `npm run create-admin -- --email admin@cuka.local --password <pw> --username admin`, `npm run dev`; `curl localhost:3000/api/health` → `{"ok":true}`; worker logs `worker ready`.
- [ ] **Step 6: Commit** — `feat(api): open graph share route and smoke test`
