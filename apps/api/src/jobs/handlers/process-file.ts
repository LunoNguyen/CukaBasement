import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { VariantName } from '@cuka/shared'
import type mongoose from 'mongoose'
import { Types } from 'mongoose'
import sharp, { type Sharp } from 'sharp'
import type { FileDoc, FileVariant } from '../../uploads/file.schema'
import { extractFrame, type JobDeps, probe } from './media'

export type Rating = 'all' | 'r18'

const WEBP = { quality: 82 }
const THUMBS: Array<[VariantName, number]> = [
  ['thumb_sm', 360],
  ['thumb_md', 1200],
]

/** A file belongs to at most one live post; a file with no post yet is treated as `all`. */
export async function findRatingForFile(conn: mongoose.Connection, fileId: Types.ObjectId): Promise<Rating> {
  const post = await conn.collection('posts').findOne({ 'files.fileId': fileId, deletedAt: null }, { projection: { rating: 1 } })
  return post?.rating === 'r18' ? 'r18' : 'all'
}

/** `all` variants are served publicly; `r18` ones stay private in the originals bucket. */
export function variantBucket(deps: JobDeps, rating: Rating): string {
  return rating === 'r18' ? deps.config.minio.bucketOriginals : deps.config.minio.bucketPublic
}

export interface Rendered {
  name: VariantName
  body: Buffer
  width: number
  height: number
}

async function render(name: VariantName, pipeline: Sharp, width: number): Promise<Rendered> {
  const { data, info } = await pipeline.resize({ width, withoutEnlargement: true }).webp(WEBP).toBuffer({ resolveWithObject: true })
  return { name, body: data, width: info.width, height: info.height }
}

/** The blurred teaser shown in place of r18 thumbnails; derived from `thumb_md`. */
export function renderBlurred(thumbMd: Buffer): Promise<Rendered> {
  return render('blurred', sharp(thumbMd).blur(40), 600)
}

/** Uploads the rendered variants for `file` to `bucket` and returns their descriptors. */
export async function storeVariants(deps: JobDeps, file: FileDoc, bucket: string, rendered: Rendered[]): Promise<FileVariant[]> {
  const out: FileVariant[] = []
  for (const r of rendered) {
    const objectKey = deps.storage.objectKey(file.ownerId.toString(), file._id.toString(), r.name, 'webp')
    await deps.storage.put(bucket, objectKey, r.body, 'image/webp')
    out.push({ name: r.name, bucket, objectKey, width: r.width, height: r.height })
  }
  return out
}

async function thumbsFrom(input: Buffer): Promise<Rendered[]> {
  // sharp strips EXIF (incl. GPS) unless withMetadata/withExif is called; never call them here.
  const base = sharp(input, { animated: false }).rotate()
  return Promise.all(THUMBS.map(([name, width]) => render(name, base.clone(), width)))
}

export async function processFile(deps: JobDeps, data: { fileId: string }): Promise<void> {
  const files = deps.conn.collection<FileDoc>('files')
  const file = Types.ObjectId.isValid(data.fileId) ? await files.findOne({ _id: new Types.ObjectId(data.fileId) }) : null
  if (!file) return

  const tmp = await mkdtemp(join(tmpdir(), 'cuka-media-'))
  try {
    const set: Partial<FileDoc> = {}
    let rendered: Rendered[] = []

    if (file.kind === 'image') {
      const buf = await deps.storage.getBuffer(file.bucket, file.objectKey)
      const meta = await sharp(buf, { animated: false }).metadata()
      const dims = meta.autoOrient ?? { width: meta.width, height: meta.height }
      set.width = dims.width ?? null
      set.height = dims.height ?? null
      rendered = await thumbsFrom(buf)
    } else if (file.kind === 'video') {
      const input = join(tmp, `original${extname(file.objectKey)}`)
      const frame = join(tmp, 'frame.png')
      await deps.storage.getToFile(file.bucket, file.objectKey, input)
      const info = await probe(input, deps.config.ffprobePath)
      set.durationSec = info.durationSec
      set.width = info.width ?? null
      set.height = info.height ?? null
      await extractFrame(input, frame, 1, deps.config.ffmpegPath)
      const frameBuf = await sharp(frame).toBuffer()
      rendered = [await render('preview', sharp(frameBuf), 1200), ...(await thumbsFrom(frameBuf))]
    } else if (file.kind === 'audio') {
      const input = join(tmp, `original${extname(file.objectKey)}`)
      await deps.storage.getToFile(file.bucket, file.objectKey, input)
      set.durationSec = (await probe(input, deps.config.ffprobePath)).durationSec
    }
    // source / archive: nothing to derive.

    const rating = await findRatingForFile(deps.conn, file._id)
    if (rating === 'r18') {
      const md = rendered.find((r) => r.name === 'thumb_md')
      if (md) rendered.push(await renderBlurred(md.body))
    }
    const variants = await storeVariants(deps, file, variantBucket(deps, rating), rendered)
    await files.updateOne({ _id: file._id }, { $set: { ...set, variants, status: 'ready' } })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
