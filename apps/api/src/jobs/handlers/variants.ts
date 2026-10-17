import { Logger } from '@nestjs/common'
import type { VariantName } from '@cuka/shared'
import type mongoose from 'mongoose'
import type { Types } from 'mongoose'
import sharp, { type Sharp } from 'sharp'
import type { FileDoc, FileVariant } from '../../uploads/file.schema'
import type { JobDeps } from './media'

export type Rating = 'all' | 'r18'

/** Explicit decompression-bomb guard for every untrusted image input. */
export const SHARP_INPUT = { limitInputPixels: 100_000_000 }
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
  width: number
  height: number
}

export async function render(name: VariantName, pipeline: Sharp, width: number): Promise<Rendered> {
  const { data, info } = await pipeline.resize({ width, withoutEnlargement: true }).webp(WEBP).toBuffer({ resolveWithObject: true })
  return { name, body: data, width: info.width, height: info.height }
}

/** The blurred teaser shown in place of r18 thumbnails; derived from `thumb_md`. */
export function renderBlurred(thumbMd: Buffer): Promise<Rendered> {
  return render('blurred', sharp(thumbMd, SHARP_INPUT).blur(40), 600)
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
 * Moves the file's variants to the bucket for `rating`, adding `blurred` for r18 and dropping it for all.
 * Idempotent: a variant already in the target (source gone) counts as moved, one missing everywhere is
 * dropped, and `variants` is persisted after every step so a retry resumes from the real state.
 */
export async function moveFileVariants(deps: JobDeps, file: FileDoc, rating: Rating): Promise<void> {
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
    const blurred = await renderBlurred(await deps.storage.getBuffer(md.bucket, md.objectKey))
    variants = [...variants, ...(await storeVariants(deps, file, target, [blurred]))]
    await persist()
  }
}
