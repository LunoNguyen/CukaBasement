import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { type Credit, type createPostSchema, type cursorQuerySchema, type PostType, R18_REQUIRED_TAGS, type Rating, type ReviewStatus, type updatePostSchema, type Visibility } from '@cuka/shared'
import { type Model, Types } from 'mongoose'
import type { z } from 'zod'
import type { Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { AppError } from '../common/app-error'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { CONFIG, type Config } from '../config/config'
import { BOOKMARK_MODEL, type Bookmark, LIKE_MODEL, type Like } from '../interactions/interaction.schemas'
import { JOBS, type JobsPort } from '../jobs/jobs.port'
import { SettingsService } from '../settings/settings.service'
import { StorageService } from '../storage/storage.service'
import { normalizeTags, TagsService } from '../tags/tags.service'
import { FILE_MODEL, type FileDoc } from '../uploads/file.schema'
import { UploadsService } from '../uploads/uploads.service'
import { USER_MODEL, type User } from '../users/user.schema'
import { UsersService } from '../users/users.service'
import { assertCanModerate } from '../moderation/peer-rule'
import { buildMedia, canSeeFullMedia, type MediaContext, type MediaDeps, type PostMediaDto } from './file-urls'
import { PostEvents } from './post-events'
import { POST_MODEL, type Post, type PostFile } from './post.schema'
import { canViewPost, isStaff, visiblePostsFilter } from './visibility'

export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type CursorQuery = z.infer<typeof cursorQuerySchema>
type FileInput = CreatePostInput['files']

export interface AuthorDto {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface PostDto {
  id: string
  type: PostType
  title: string
  description: string
  rating: Rating
  tags: string[]
  credit: Credit
  review: { status: ReviewStatus; reason?: string }
  visibility: Visibility
  counts: Post['counts']
  author: AuthorDto
  media: PostMediaDto[]
  viewerState: { liked: boolean; bookmarked: boolean }
  createdAt: string
  updatedAt: string
}

export interface PostCardDto {
  id: string
  type: PostType
  title: string
  rating: Rating
  cover: PostMediaDto | null
  pageCount: number
  counts: Post['counts']
  author: AuthorDto
  credit: Credit
  createdAt: string
}

const MEDIA_KINDS = new Set(['image', 'video', 'audio'])
/** Repost originals anyone who can view the post may fetch: the player needs them (ruling R19). */
const PLAYABLE_KINDS = new Set(['video', 'audio'])

function oid(id: string): Types.ObjectId | null {
  return /^[0-9a-fA-F]{24}$/.test(id) ? new Types.ObjectId(id) : null
}

function notFound(): AppError {
  return new AppError('POST_NOT_FOUND', 404, 'Post not found')
}

/** The unique `files.fileId` index rejected a file already attached to another post. */
function isFileTaken(err: unknown): boolean {
  const e = err as { code?: unknown; keyPattern?: Record<string, unknown> }
  return e?.code === 11000 && !!e.keyPattern && 'files.fileId' in e.keyPattern
}

function fileTaken(): AppError {
  return new AppError('FILE_NOT_READY', 400, 'File is already attached to a post')
}

/** Spec §9 / ruling R16: tags in R18_REQUIRED_TAGS (normalized) need an r18 rating. */
function assertTagRating(tags: string[], rating: Rating): void {
  if (rating !== 'r18' && tags.some((t) => R18_REQUIRED_TAGS.includes(t))) {
    throw new AppError('VALIDATION_FAILED', 400, 'Posts with this tag must be rated r18', { field: 'rating', reason: 'R18_TAG_REQUIRES_R18' })
  }
}

/** Server-side twin of the shared schema refinement: a repost names its artist, platform and source. */
export function assertCredit(credit: Credit): void {
  if (!credit.isOwnWork && (!credit.artistName || !credit.platform || !credit.sourceUrl)) {
    throw new AppError('CREDIT_REQUIRED', 400, 'A repost must credit the artist, platform and source URL')
  }
}

/** Posts saved before credits existed count as the uploader's own work. */
export const OWN_WORK: Credit = { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' }

function sameFileSet(a: PostFile[], b: PostFile[]): boolean {
  const ids = (fs: PostFile[]) => [...new Set(fs.map((f) => f.fileId.toString()))].sort().join(',')
  return ids(a) === ids(b)
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger('PostsService')

  constructor(
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(FILE_MODEL) private readonly files: Model<FileDoc>,
    @InjectModel(LIKE_MODEL) private readonly likes: Model<Like>,
    @InjectModel(BOOKMARK_MODEL) private readonly bookmarks: Model<Bookmark>,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(JOBS) private readonly jobs: JobsPort,
    private readonly uploads: UploadsService,
    private readonly usersService: UsersService,
    private readonly tags: TagsService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly events: PostEvents,
    private readonly feedCache: FeedCache,
  ) {}

  private get mediaDeps(): MediaDeps {
    return { storage: this.storage, publicBucket: this.config.minio.bucketPublic }
  }

  async create(viewer: Viewer, input: CreatePostInput): Promise<PostDto> {
    const tags = normalizeTags(input.tags).map((t) => t.tag)
    assertTagRating(tags, input.rating)
    assertCredit(input.credit)
    const files = await this.checkFiles(viewer.id, input.files)
    let post: Post
    try {
      const doc = await this.posts.create({
        authorId: new Types.ObjectId(viewer.id),
        type: input.type,
        title: input.title,
        description: input.description,
        rating: input.rating,
        visibility: 'public',
        review: { status: 'pending', reason: null, by: null, at: null },
        aiDeclaration: true,
        credit: input.credit,
        files,
        tags,
      })
      post = doc.toObject()
    } catch (err) {
      throw isFileTaken(err) ? fileTaken() : err
    }
    // Counters after the post itself (spec §3.4); the nightly reconcile job repairs any drift.
    await this.users.updateOne({ _id: post.authorId }, { $inc: { 'stats.postCount': 1 } })
    await this.tags.applyDelta(input.tags, [])
    // Files processed before the post existed have public variants; move them to the private bucket.
    // Files are usually processed before the post exists, so their variants carry no watermark yet. rewatermark also
    // stores them in the bucket of the post's rating, so no relocate-variants (two jobs would race on the same keys).
    await this.jobs.enqueue('rewatermark', { postId: post._id.toString() })
    return this.toDto(post, viewer)
  }

  async get(viewer: Viewer | null, id: string): Promise<PostDto> {
    const post = await this.findViewable(viewer, id)
    if (viewer?.id !== post.authorId.toString()) {
      this.posts
        .updateOne({ _id: post._id }, { $inc: { 'counts.views': 1 } }, { timestamps: false })
        .catch((err: Error) => this.logger.warn(`Could not count a view of post ${id}: ${err.message}`))
    }
    return this.toDto(post, viewer)
  }

  async update(viewer: Viewer, id: string, input: UpdatePostInput): Promise<PostDto> {
    const post = await this.findViewable(viewer, id)
    if (post.authorId.toString() !== viewer.id) throw new AppError('FORBIDDEN', 403, 'Only the author can edit this post')

    const $set: Record<string, unknown> = {}
    for (const key of ['type', 'title', 'description', 'rating'] as const) {
      if (input[key] !== undefined) $set[key] = input[key]
    }
    // The credit is replaced whole; a credit edit alone keeps the review status.
    if (input.credit !== undefined) {
      assertCredit(input.credit)
      $set.credit = input.credit
    }
    const tags = input.tags !== undefined ? normalizeTags(input.tags) : null
    assertTagRating(tags ? tags.map((t) => t.tag) : post.tags, input.rating ?? post.rating)
    if (tags) $set.tags = tags.map((t) => t.tag)
    let filesChanged = false
    if (input.files !== undefined) {
      const files = await this.checkFiles(viewer.id, input.files, post._id)
      $set.files = files
      filesChanged = !sameFileSet(post.files, files)
    }
    const ratingChanged = input.rating !== undefined && input.rating !== post.rating

    // Spec §5.4: new or removed files, r18 → all, or any edit of a rejected post needs review again.
    const edited = Object.keys(input).length > 0
    if (filesChanged || (post.rating === 'r18' && input.rating === 'all') || (post.review.status === 'rejected' && edited)) {
      $set['review.status'] = 'pending'
      $set['review.reason'] = null
    }
    if (Object.keys($set).length === 0) return this.toDto(post, viewer)

    let updated: Post | null
    try {
      updated = await this.posts.findOneAndUpdate({ _id: post._id, deletedAt: null }, { $set }, { returnDocument: 'after' }).lean()
    } catch (err) {
      throw isFileTaken(err) ? fileTaken() : err
    }
    if (!updated) throw notFound()
    // Any edit of a listed post (title, rating, credit, cover...) changes its card. `post` was read before the write and a
    // moderator may have approved it since, so its stale status cannot tell whether it is listed: always invalidate.
    await this.feedCache.bump()

    if (tags) {
      const before = new Set(post.tags)
      const after = new Set(tags.map((t) => t.tag))
      await this.tags.applyDelta(
        tags.filter((t) => !before.has(t.tag)).map((t) => t.display),
        post.tags.filter((t) => !after.has(t)),
      )
    }
    // The watermark shows the credit: redraw it for a new credit or newly attached files. rewatermark also places the
    // variants in the bucket of the current rating, so it replaces relocate-variants rather than racing it.
    if (input.credit !== undefined || filesChanged) await this.jobs.enqueue('rewatermark', { postId: post._id.toString() })
    else if (ratingChanged) await this.jobs.enqueue('relocate-variants', { postId: post._id.toString() })
    return this.toDto(updated, viewer)
  }

  async remove(viewer: Viewer, id: string): Promise<void> {
    const post = await this.findViewable(viewer, id)
    const isOwner = post.authorId.toString() === viewer.id
    if (!isOwner) {
      if (!isStaff(viewer)) throw new AppError('FORBIDDEN', 403, 'Only the author or staff can delete this post')
      // A missing author counts as a plain user.
      const author = await this.users.findById(post.authorId, { role: 1 }).lean()
      assertCanModerate(viewer, author?.role ?? 'user')
    }
    const res = await this.posts.updateOne({ _id: post._id, deletedAt: null }, { $set: { deletedAt: new Date() } })
    if (res.modifiedCount === 0) throw notFound()
    // Unconditional for the same reason as in update(): the status read before the write may be stale.
    await this.feedCache.bump()
    await this.users.updateOne({ _id: post.authorId }, { $inc: { 'stats.postCount': -1 } })
    await this.tags.applyDelta([], post.tags)
    // Staff deletes are moderation: the moderation module logs them and notifies the author.
    if (!isOwner) await this.events.staffRemoved({ actorId: viewer.id, postId: id, authorId: post.authorId.toString() })
  }

  /**
   * Presigned download of a post file's original; r18 originals only for eligible viewers. A repost's clean
   * (unwatermarked) image, source and archive originals are only for its uploader and staff; its video and audio
   * stay playable for every viewer of the post (ruling R19).
   */
  async fileUrl(viewer: Viewer | null, id: string, fileId: string): Promise<{ url: string }> {
    const post = await this.findViewable(viewer, id)
    if (post.rating === 'r18' && !canSeeFullMedia(viewer)) throw notFound()
    const fid = oid(fileId)
    const file = fid && post.files.some((f) => f.fileId.equals(fid)) ? await this.files.findById(fid).lean() : null
    const repost = post.credit && !post.credit.isOwnWork
    if (repost && !PLAYABLE_KINDS.has(file?.kind ?? '') && viewer?.id !== post.authorId.toString() && !isStaff(viewer)) throw notFound()
    if (!file || (file.status !== 'processing' && file.status !== 'ready')) throw new AppError('NOT_FOUND', 404, 'File not found')
    return { url: await this.storage.presignGet(file.bucket, file.objectKey, { downloadName: file.originalName }) }
  }

  async listByUser(viewer: Viewer | null, username: string, q: CursorQuery): Promise<{ items: PostCardDto[]; nextCursor: string | null }> {
    const user = await this.users.findOne({ 'profile.username': username }, { status: 1 }).lean()
    if (!user || user.status === 'banned') throw new AppError('NOT_FOUND', 404, 'User not found')
    const cursor = decodeCursor(q.cursor)
    const docs = await this.posts
      .find({ $and: [{ authorId: user._id }, visiblePostsFilter(viewer, 'direct'), ...(cursor ? [cursorFilter(cursor)] : [])] })
      .sort({ createdAt: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const page = pageOf(docs, q.limit)
    return { items: await this.toCards(page.items, viewer), nextCursor: page.nextCursor }
  }

  /** `context: 'mod'` only from /mod endpoints (staff full-r18 rule, see canSeeFullMedia). */
  async toCards(posts: Post[], viewer: Viewer | null, context: MediaContext = 'default'): Promise<PostCardDto[]> {
    const authors = await this.authorsOf(posts.map((p) => p.authorId))
    const covers = posts.map((p) => p.files.find((f) => f.isCover) ?? p.files[0])
    const files = await this.files.find({ _id: { $in: covers.filter((c) => c).map((c) => c!.fileId) } }).lean()
    return Promise.all(
      posts.map(async (p, i) => {
        const cover = covers[i]
        const media = cover ? await buildMedia({ rating: p.rating, files: [cover], credit: p.credit }, files, viewer, this.mediaDeps, context) : []
        return {
          id: p._id.toString(),
          type: p.type,
          title: p.title,
          rating: p.rating,
          cover: media[0] ?? null,
          pageCount: p.files.length,
          counts: p.counts,
          author: authors.get(p.authorId.toString())!,
          // Cards never carry the permission note (ruling R20).
          credit: { ...(p.credit ?? OWN_WORK), permissionNote: '' },
          createdAt: p.createdAt.toISOString(),
        }
      }),
    )
  }

  private async toDto(post: Post, viewer: Viewer | null): Promise<PostDto> {
    const authors = await this.authorsOf([post.authorId])
    const files = await this.files.find({ _id: { $in: post.files.map((f) => f.fileId) } }).lean()
    const showReason = isStaff(viewer) || viewer?.id === post.authorId.toString()
    const viewerState = await this.viewerStateOf(post._id, viewer)
    return {
      id: post._id.toString(),
      type: post.type,
      title: post.title,
      description: post.description,
      rating: post.rating,
      tags: post.tags,
      // The permission note is for the uploader and staff only (ruling R20).
      credit: { ...(post.credit ?? OWN_WORK), ...(showReason ? {} : { permissionNote: '' }) },
      review: { status: post.review.status, ...(showReason && post.review.reason ? { reason: post.review.reason } : {}) },
      visibility: post.visibility,
      counts: post.counts,
      author: authors.get(post.authorId.toString())!,
      media: await buildMedia(post, files, viewer, this.mediaDeps),
      viewerState,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    }
  }

  /** One lookup per interaction collection, both in parallel. */
  private async viewerStateOf(postId: Types.ObjectId, viewer: Viewer | null): Promise<PostDto['viewerState']> {
    if (!viewer) return { liked: false, bookmarked: false }
    const key = { userId: new Types.ObjectId(viewer.id), postId }
    const [liked, bookmarked] = await Promise.all([this.likes.exists(key), this.bookmarks.exists(key)])
    return { liked: !!liked, bookmarked: !!bookmarked }
  }

  /** Author summaries keyed by id; an author missing from `users` gets an empty placeholder. */
  private async authorsOf(ids: Types.ObjectId[]): Promise<Map<string, AuthorDto>> {
    const users = await this.users.find({ _id: { $in: ids } }, { profile: 1 }).lean()
    const out = new Map<string, AuthorDto>()
    for (const id of ids) out.set(id.toString(), { id: id.toString(), username: '', displayName: '', avatarUrl: null })
    for (const u of users) {
      const avatarUrl = u.profile.avatarFileId ? await this.usersService.publicAvatarUrl(u.profile.avatarFileId.toString()) : null
      out.set(u._id.toString(), { id: u._id.toString(), username: u.profile.username, displayName: u.profile.displayName, avatarUrl })
    }
    return out
  }

  private async findViewable(viewer: Viewer | null, id: string): Promise<Post> {
    const _id = oid(id)
    const post = _id ? await this.posts.findById(_id).lean() : null
    if (!post || !canViewPost(viewer, post)) throw notFound()
    return post
  }

  /**
   * Validates a post's file list (spec §4 step 5) and returns it in position order with exactly one cover
   * (the lowest position when none was chosen). `exceptPostId` lets a post keep its own files on edit.
   */
  private async checkFiles(ownerId: string, input: FileInput, exceptPostId?: Types.ObjectId): Promise<PostFile[]> {
    const { maxFilesPerPost } = await this.settings.get()
    if (input.length > maxFilesPerPost) throw new AppError('TOO_MANY_FILES', 400, `A post may have at most ${maxFilesPerPost} files`)
    if (new Set(input.map((f) => f.fileId)).size !== input.length) throw new AppError('VALIDATION_FAILED', 400, 'Duplicate fileId')
    if (new Set(input.map((f) => f.position)).size !== input.length) throw new AppError('VALIDATION_FAILED', 400, 'Duplicate position')
    if (input.filter((f) => f.isCover).length > 1) throw new AppError('VALIDATION_FAILED', 400, 'Only one file can be the cover')

    const docs = await this.uploads.assertUsableFiles(ownerId, input.map((f) => f.fileId))
    if (!docs.some((d) => MEDIA_KINDS.has(d.kind))) throw new AppError('POST_NEEDS_MEDIA', 400, 'A post needs an image, video or audio file')
    const ids = docs.map((d) => d._id)
    if (await this.posts.exists({ 'files.fileId': { $in: ids }, ...(exceptPostId ? { _id: { $ne: exceptPostId } } : {}) })) throw fileTaken()
    // Profile images stay out of posts (their variants are public and unwatermarked).
    if (await this.users.exists({ $or: [{ 'profile.avatarFileId': { $in: ids } }, { 'profile.bannerFileId': { $in: ids } }] })) {
      throw new AppError('FILE_NOT_READY', 400, 'File is used as an avatar or banner')
    }

    const files = [...input].sort((a, b) => a.position - b.position).map((f) => ({ fileId: new Types.ObjectId(f.fileId), position: f.position, isCover: f.isCover }))
    if (!files.some((f) => f.isCover)) files[0]!.isCover = true
    return files
  }
}
