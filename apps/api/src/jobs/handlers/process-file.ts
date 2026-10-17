import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { VariantName } from '@cuka/shared'
import { Types } from 'mongoose'
import sharp from 'sharp'
import type { FileDoc, FileVariant } from '../../uploads/file.schema'
import { extractFrame, type JobDeps, probe, SHARP_INPUT } from './media'
import { findContextForFile, type Rendered, render, sameContext, storeFinalVariants, type VariantContext } from './variants'

export { findRatingForFile } from './variants'

const THUMBS: Array<[VariantName, number]> = [
  ['thumb_sm', 360],
  ['thumb_md', 1200],
]

/** A post created, re-credited or re-rated while variants are stored triggers a redraw; this bounds the retries. */
const MAX_REDRAWS = 3

/** Test seam: runs after the post context is read and before variants are stored. */
export const processFileHooks: { beforeStore?: () => Promise<void> } = {}

async function thumbsFrom(input: Buffer): Promise<Rendered[]> {
  // sharp strips EXIF (incl. GPS) unless withMetadata/withExif is called; never call them here.
  const base = sharp(input, { ...SHARP_INPUT, animated: false }).rotate()
  return Promise.all(THUMBS.map(([name, width]) => render(name, base.clone(), width)))
}

/**
 * Reads the original (never modified) and renders the clean display variants: image thumbs, or the video poster's
 * preview and thumbs (the video itself is not re-encoded). Also returns the file's probed metadata.
 */
export async function renderCleanVariants(deps: JobDeps, file: FileDoc, tmp: string): Promise<{ set: Partial<FileDoc>; rendered: Rendered[] }> {
  const set: Partial<FileDoc> = {}
  let rendered: Rendered[] = []
  if (file.kind === 'image') {
    const buf = await deps.storage.getBuffer(file.bucket, file.objectKey)
    const meta = await sharp(buf, { ...SHARP_INPUT, animated: false }).metadata()
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
    const frameBuf = await sharp(frame, SHARP_INPUT).toBuffer()
    rendered = [await render('preview', sharp(frameBuf, SHARP_INPUT), 1200), ...(await thumbsFrom(frameBuf))]
  } else if (file.kind === 'audio') {
    const input = join(tmp, `original${extname(file.objectKey)}`)
    await deps.storage.getToFile(file.bucket, file.objectKey, input)
    set.durationSec = (await probe(input, deps.config.ffprobePath)).durationSec
  }
  // source / archive: nothing to derive.
  return { set, rendered }
}

/**
 * Stores the variants of `clean` for `ctx` and persists them with `set`. Then, while the file's post context has
 * changed meanwhile (post created, credit or rating edited), redraws from the same clean renders, so the last writer
 * always stores the current credit in the current bucket. processFile and rewatermark both end here; with the same
 * context they write identical objects, so either finishing last is fine.
 */
export async function publishVariants(deps: JobDeps, file: FileDoc, clean: Rendered[], ctx: VariantContext, set: Partial<FileDoc>): Promise<void> {
  const files = deps.conn.collection<FileDoc>('files')
  let variants: FileVariant[] = await storeFinalVariants(deps, file, clean, ctx)
  await files.updateOne({ _id: file._id }, { $set: { ...set, variants } })
  if (clean.length === 0) return
  for (let i = 0; i < MAX_REDRAWS; i++) {
    const now = await findContextForFile(deps.conn, file._id)
    if (sameContext(now, ctx)) return
    ctx = now
    variants = await storeFinalVariants(deps, file, clean, ctx)
    await files.updateOne({ _id: file._id }, { $set: { variants } })
  }
}

export async function processFile(deps: JobDeps, data: { fileId: string }): Promise<void> {
  const files = deps.conn.collection<FileDoc>('files')
  const file = Types.ObjectId.isValid(data.fileId) ? await files.findOne({ _id: new Types.ObjectId(data.fileId) }) : null
  if (!file) return

  const tmp = await mkdtemp(join(tmpdir(), 'cuka-media-'))
  try {
    const { set, rendered } = await renderCleanVariants(deps, file, tmp)
    // No post yet → no watermark; creating the post enqueues rewatermark, and publishVariants re-checks.
    const ctx = await findContextForFile(deps.conn, file._id)
    await processFileHooks.beforeStore?.()
    // `ready` is written before the re-check, so a post created after it sees a ready file in its rewatermark job.
    await publishVariants(deps, file, rendered, ctx, { ...set, status: 'ready' })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
