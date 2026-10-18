import { Logger } from '@nestjs/common'
import type { VariantName } from '@cuka/shared'
import type mongoose from 'mongoose'
import type { Types } from 'mongoose'
import sharp, { type Sharp } from 'sharp'
import type { FileDoc, FileVariant } from '../../uploads/file.schema'
import { type JobDeps, SHARP_INPUT } from './media'
import { applyWatermark, watermarkText, type WatermarkText } from './watermark'

export { SHARP_INPUT } from './media'

export type Rating = 'all' | 'r18'

/** A post-less profile image is center-cropped for its role: avatar 1:1, banner 4:1. */
export type ProfileCrop = 'avatar' | 'banner'

/** Frames beyond this make an animation fall back to its first frame. */
export const MAX_ANIMATED_PAGES = 300

/**
 * Whether an image is rendered animated: a gif or webp with 2..MAX_ANIMATED_PAGES frames whose whole roll
 * (width × frame height × frames) fits the limitInputPixels budget. Anything else uses its first frame.
 */
export function animationPlan(meta: { format?: string; width?: number; height?: number; pages?: number }): boolean {
  const pages = meta.pages ?? 1
  if (meta.format !== 'gif' && meta.format !== 'webp') return false
  if (pages < 2 || pages > MAX_ANIMATED_PAGES) return false
  return (meta.width ?? 0) * (meta.height ?? 0) * pages <= SHARP_INPUT.limitInputPixels
}

const WEBP = { quality: 82 }
const logger = new Logger('Variants')

/**
 * A file belongs to at most one post. A live post wins; otherwise a soft-deleted post's rating still
 * applies (so r18 variants never leak to the public bucket). No post at all → `all`.
 */
export async function findRatingForFile(conn: mongoose.Connection, fileId: Types.ObjectId): Promise<Rating> {
  // null deletedAt sorts first, so a live post is preferred.
  const post = await conn.collection('posts').findOne({ 'files.fileId': fileId }, { projection: { rating: 1 }, sort: { deletedAt: 1 } })
  return post?.rating === 'r18' ? 'r18' : 'all'
}

/**
 * What a file's display variants depend on: the bucket (rating, and whether the file is published at all) and the
 * burned-in credit (null: no watermark). `published` is false for a file in no post that is not a profile image:
 * its clean renders stay in the private originals bucket, so nobody can fetch them by their predictable keys.
 */
export interface VariantContext {
  rating: Rating
  watermark: WatermarkText | null
  published: boolean
  /** Set only for a post-less profile image: its clean renders are center-cropped for the role. */
  crop: ProfileCrop | null
}

interface PostForContext {
  rating?: unknown
  credit?: Parameters<typeof watermarkText>[0]
  authorId?: Types.ObjectId
}

/** Context of a post: own work (or no credit) needs the uploader's username; a missing user means no watermark. */
export async function contextOfPost(conn: mongoose.Connection, doc: Record<string, unknown> | null): Promise<VariantContext> {
  if (!doc) return { rating: 'all', watermark: null, published: false, crop: null }
  const post = doc as PostForContext
  const rating: Rating = post.rating === 'r18' ? 'r18' : 'all'
  const credit = post.credit ?? null
  if (credit && !credit.isOwnWork) return { rating, watermark: watermarkText(credit, ''), published: true, crop: null }
  const user = post.authorId ? await conn.collection('users').findOne({ _id: post.authorId }, { projection: { 'profile.username': 1 } }) : null
  const username = (user?.profile as { username?: unknown } | undefined)?.username
  return { rating, watermark: typeof username === 'string' && username ? watermarkText(credit, username) : null, published: true, crop: null }
}

/**
 * Same lookup as findRatingForFile: a live post wins, else a soft-deleted one. No post: a user's avatar or banner is
 * published (`all`, no watermark) and cropped for its role (avatar wins when a file is both); anything else stays
 * unpublished (private, no watermark).
 */
export async function findContextForFile(conn: mongoose.Connection, fileId: Types.ObjectId): Promise<VariantContext> {
  const post = await conn
    .collection('posts')
    .findOne({ 'files.fileId': fileId }, { projection: { rating: 1, credit: 1, authorId: 1 }, sort: { deletedAt: 1 } })
  if (post) return contextOfPost(conn, post)
  const users = conn.collection('users')
  const crop: ProfileCrop | null = (await users.findOne({ 'profile.avatarFileId': fileId }, { projection: { _id: 1 } }))
    ? 'avatar'
    : (await users.findOne({ 'profile.bannerFileId': fileId }, { projection: { _id: 1 } }))
      ? 'banner'
      : null
  return { rating: 'all', watermark: null, published: !!crop, crop }
}

/** Bucket for the variants of a file in context `ctx`: unpublished files stay in the private originals bucket. */
export function contextBucket(deps: JobDeps, ctx: VariantContext): string {
  return ctx.published ? variantBucket(deps, ctx.rating) : deps.config.minio.bucketOriginals
}

export function sameContext(a: VariantContext, b: VariantContext): boolean {
  return a.rating === b.rating && a.published === b.published && a.crop === b.crop && a.watermark?.full === b.watermark?.full && a.watermark?.short === b.watermark?.short
}

/** `all` variants are served publicly; `r18` ones stay private in the originals bucket. */
export function variantBucket(deps: JobDeps, rating: Rating): string {
  return rating === 'r18' ? deps.config.minio.bucketOriginals : deps.config.minio.bucketPublic
}

function otherBucket(deps: JobDeps, bucket: string): string {
  const { bucketOriginals, bucketPublic } = deps.config.minio
  return bucket === bucketPublic ? bucketOriginals : bucketPublic
}

export interface Rendered {
  name: VariantName
  body: Buffer
  /** One frame's size, also for an animated render. */
  width: number
  height: number
}

/** Resizes to `width` (never enlarging) as webp; an animated pipeline gives an animated webp. */
export async function render(name: VariantName, pipeline: Sharp, width: number): Promise<Rendered> {
  const { data, info } = await pipeline.resize({ width, withoutEnlargement: true }).webp(WEBP).toBuffer({ resolveWithObject: true })
  return { name, body: data, width: info.width, height: info.pageHeight ?? info.height }
}

/** The blurred teaser shown in place of r18 thumbnails; derived from `thumb_md` (first frame only, so always static; watermark it afterwards). */
export function renderBlurred(thumbMd: Buffer): Promise<Rendered> {
  return render('blurred', sharp(thumbMd, SHARP_INPUT).blur(40), 600)
}

/** Burns the credit in: `thumb_sm` gets the short text at small scale, every other variant the full text. */
export async function watermarkRendered(r: Rendered, text: WatermarkText): Promise<Rendered> {
  const body = r.name === 'thumb_sm' ? await applyWatermark(r.body, text.short, { scale: 'small' }) : await applyWatermark(r.body, text.full, { scale: 'full' })
  return { ...r, body }
}

/**
 * Turns clean renders (thumbs, preview) into the stored set for `ctx`: adds `blurred` for r18 (blurred first, then
 * watermarked, so the teaser still carries a readable credit) and watermarks every variant.
 */
export async function finalVariants(clean: Rendered[], ctx: VariantContext): Promise<Rendered[]> {
  const out = [...clean]
  const md = clean.find((r) => r.name === 'thumb_md')
  if (ctx.rating === 'r18' && md) out.push(await renderBlurred(md.body))
  return ctx.watermark ? Promise.all(out.map((r) => watermarkRendered(r, ctx.watermark!))) : out
}

/**
 * Stores the final variants of `clean` for `ctx` in its bucket (see contextBucket). For `all`, a `blurred` left over from an
 * earlier r18 rendering is removed from both buckets.
 */
export async function storeFinalVariants(deps: JobDeps, file: FileDoc, clean: Rendered[], ctx: VariantContext): Promise<FileVariant[]> {
  if (clean.length === 0) return []
  const variants = await storeVariants(deps, file, contextBucket(deps, ctx), await finalVariants(clean, ctx))
  if (ctx.rating === 'all') {
    const key = deps.storage.objectKey(file.ownerId.toString(), file._id.toString(), 'blurred', 'webp')
    await deps.storage.remove(deps.config.minio.bucketOriginals, key)
    await deps.storage.remove(deps.config.minio.bucketPublic, key)
  }
  return variants
}

/**
 * Uploads the rendered variants for `file` to `bucket` and returns their descriptors.
 * The same keys are removed from the other bucket, cleaning orphans of an earlier failed attempt.
 */
export async function storeVariants(deps: JobDeps, file: FileDoc, bucket: string, rendered: Rendered[]): Promise<FileVariant[]> {
  const out: FileVariant[] = []
  for (const r of rendered) {
    const objectKey = deps.storage.objectKey(file.ownerId.toString(), file._id.toString(), r.name, 'webp')
    await deps.storage.put(bucket, objectKey, r.body, 'image/webp')
    await deps.storage.remove(otherBucket(deps, bucket), objectKey)
    out.push({ name: r.name, bucket, objectKey, width: r.width, height: r.height })
  }
  return out
}

/**
 * Moves the file's variants to the bucket for `rating`, adding `blurred` for r18 (watermarked with `watermark`, the
 * full credit text, when given) and dropping it for all.
 * Idempotent: a variant already in the target (source gone) counts as moved, one missing everywhere is
 * dropped, and `variants` is persisted after every step so a retry resumes from the real state.
 */
export async function moveFileVariants(deps: JobDeps, file: FileDoc, rating: Rating, watermark: WatermarkText | null = null): Promise<void> {
  const files = deps.conn.collection<FileDoc>('files')
  const target = variantBucket(deps, rating)
  const source = otherBucket(deps, target)
  let variants = [...file.variants]
  const persist = () => files.updateOne({ _id: file._id }, { $set: { variants } })

  for (const v of [...variants]) {
    if (v.name === 'blurred' && rating === 'all') {
      await deps.storage.remove(v.bucket, v.objectKey)
      await deps.storage.remove(otherBucket(deps, v.bucket), v.objectKey)
      variants = variants.filter((x) => x !== v)
      await persist()
      continue
    }
    if (await deps.storage.stat(source, v.objectKey)) {
      // Copy before remove so a crash in between leaves a readable object behind.
      await deps.storage.copy(source, v.objectKey, target, v.objectKey)
      await deps.storage.remove(source, v.objectKey)
    } else if (!(await deps.storage.stat(target, v.objectKey))) {
      logger.warn(`Dropping variant ${v.name} of file ${file._id.toString()}: object missing from both buckets`)
      variants = variants.filter((x) => x !== v)
      await persist()
      continue
    }
    if (v.bucket !== target) {
      variants = variants.map((x) => (x === v ? { ...v, bucket: target } : x))
      await persist()
    }
  }

  const md = variants.find((v) => v.name === 'thumb_md')
  if (rating === 'r18' && md && !variants.some((v) => v.name === 'blurred')) {
    // thumb_md already carries the mark, which the blur smears: draw a fresh one on top.
    let blurred = await renderBlurred(await deps.storage.getBuffer(md.bucket, md.objectKey))
    if (watermark) blurred = await watermarkRendered(blurred, watermark)
    variants = [...variants, ...(await storeVariants(deps, file, target, [blurred]))]
    await persist()
  }
}
