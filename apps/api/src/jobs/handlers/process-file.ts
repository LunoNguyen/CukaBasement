import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { VariantName } from '@cuka/shared'
import { Logger } from '@nestjs/common'
import { Types } from 'mongoose'
import sharp, { type Sharp } from 'sharp'
import type { FileDoc, FileVariant } from '../../uploads/file.schema'
import { extractFrame, type JobDeps, probe, SHARP_INPUT } from './media'
import { watermarkHash } from './watermark'
import {
  animatedTooLarge,
  animationPlan,
  findContextForFile,
  MAX_ANIMATED_PAGES,
  type ProfileCrop,
  type Rendered,
  render,
  sameContext,
  storeFinalVariants,
  type VariantContext,
} from './variants'

export { findRatingForFile } from './variants'

const THUMBS: Array<[VariantName, number]> = [
  ['thumb_sm', 360],
  ['thumb_md', 1200],
]

/** Profile renders: aspect ratio (width / height) and the width of each thumb. */
const PROFILE: Record<ProfileCrop, { ratio: number; widths: Record<'thumb_sm' | 'thumb_md', number> }> = {
  avatar: { ratio: 1, widths: { thumb_sm: 360, thumb_md: 512 } },
  banner: { ratio: 4, widths: { thumb_sm: 360, thumb_md: 1600 } },
}

const logger = new Logger('ProcessFile')

/** A post created, re-credited or re-rated while variants are stored triggers a redraw; this bounds the retries. */
const MAX_REDRAWS = 3

/** Test seam: runs after the post context is read and before variants are stored. */
export const processFileHooks: { beforeStore?: () => Promise<void> } = {}

/** The centred box of aspect `ratio` (width / height) inside a `width` × `height` frame. */
function centerBox(width: number, height: number, ratio: number): { left: number; top: number; width: number; height: number } {
  const w = width / height > ratio ? Math.max(1, Math.round(height * ratio)) : width
  const h = width / height > ratio ? height : Math.max(1, Math.round(width / ratio))
  return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h }
}

interface ImageInput {
  /** One frame's size after auto-orientation. */
  width: number
  height: number
  animated: boolean
}

/** Reads the frame size and decides whether the image is rendered animated (see animationPlan). */
async function inspectImage(input: Buffer, fileId: string): Promise<ImageInput> {
  const meta = await sharp(input, { ...SHARP_INPUT, animated: false }).metadata()
  const dims = meta.autoOrient ?? { width: meta.width, height: meta.height }
  const animated = animationPlan({ format: meta.format, width: meta.width, height: meta.height, pages: meta.pages })
  if (!animated && (meta.pages ?? 1) > 1 && (meta.format === 'gif' || meta.format === 'webp')) {
    logger.warn(
      `File ${fileId}: ${meta.pages} frames of ${meta.width}×${meta.height} exceed the animation limits (${MAX_ANIMATED_PAGES} frames, ${SHARP_INPUT.limitInputPixels} pixels); using the first frame`,
    )
  }
  return { width: dims.width ?? 0, height: dims.height ?? 0, animated }
}

async function thumbsFrom(input: Buffer, crop: ProfileCrop | null = null, fileId = ''): Promise<Rendered[]> {
  const img = await inspectImage(input, fileId)
  const widths = THUMBS.map(([name, width]): [VariantName, number] => [name, crop ? PROFILE[crop].widths[name as 'thumb_sm' | 'thumb_md'] : width])
  // sharp strips EXIF (incl. GPS) unless withMetadata/withExif is called; never call them here.
  // An animated input is a "toilet roll" of frames; resize/extract apply per frame and webp output keeps the animation.
  const pipeline = (animated: boolean): Sharp => {
    const base = sharp(input, { ...SHARP_INPUT, animated }).rotate()
    return crop ? base.extract(centerBox(img.width, img.height, PROFILE[crop].ratio)) : base
  }
  const animated = pipeline(img.animated)
  const rendered = await Promise.all(widths.map(([name, width]) => render(name, animated.clone(), width)))
  if (!img.animated) return rendered
  // An animated render heavier than its cap or than the original falls back to the first frame.
  return Promise.all(
    rendered.map(async (r, i) => {
      if (!animatedTooLarge(r.name, r.body.length, input.length)) return r
      logger.warn(`File ${fileId}: animated ${r.name} is ${r.body.length} bytes (original ${input.length}); using the first frame`)
      return render(r.name, pipeline(false), widths[i]![1])
    }),
  )
}

/**
 * Reads the original (never modified) and renders the clean display variants: image thumbs (animated for an animated
 * gif/webp; center-cropped for `crop`), or the video poster's preview and thumbs (the video itself is not
 * re-encoded). Also returns the file's probed metadata (width/height: one frame).
 */
export async function renderCleanVariants(
  deps: JobDeps,
  file: FileDoc,
  tmp: string,
  crop: ProfileCrop | null = null,
): Promise<{ set: Partial<FileDoc>; rendered: Rendered[] }> {
  const set: Partial<FileDoc> = {}
  let rendered: Rendered[] = []
  if (file.kind === 'image') {
    const buf = await deps.storage.getBuffer(file.bucket, file.objectKey)
    const meta = await sharp(buf, { ...SHARP_INPUT, animated: false }).metadata()
    const dims = meta.autoOrient ?? { width: meta.width, height: meta.height }
    set.width = dims.width ?? null
    set.height = dims.height ?? null
    rendered = await thumbsFrom(buf, crop, file._id.toString())
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
 * always stores the current credit in the current bucket. A context whose profile crop differs needs other clean
 * renders: `rerender` draws them from the original. processFile, rewatermark and relocateFile all end here; with the
 * same context they write identical objects, so either finishing last is fine.
 */
export async function publishVariants(
  deps: JobDeps,
  file: FileDoc,
  clean: Rendered[],
  ctx: VariantContext,
  set: Partial<FileDoc>,
  rerender?: (crop: ProfileCrop | null) => Promise<Rendered[]>,
): Promise<void> {
  const files = deps.conn.collection<FileDoc>('files')
  let variants: FileVariant[] = await storeFinalVariants(deps, file, clean, ctx)
  await files.updateOne({ _id: file._id }, { $set: { ...set, variants, watermarkedFor: clean.length ? watermarkHash(ctx.watermark) : '', variantsAt: new Date() } })
  if (clean.length === 0) return
  for (let i = 0; i < MAX_REDRAWS; i++) {
    const now = await findContextForFile(deps.conn, file._id)
    if (sameContext(now, ctx)) return
    if (now.crop !== ctx.crop && rerender) clean = await rerender(now.crop)
    ctx = now
    variants = await storeFinalVariants(deps, file, clean, ctx)
    await files.updateOne({ _id: file._id }, { $set: { variants, watermarkedFor: watermarkHash(ctx.watermark), variantsAt: new Date() } })
  }
}

export async function processFile(deps: JobDeps, data: { fileId: string }): Promise<void> {
  const files = deps.conn.collection<FileDoc>('files')
  const file = Types.ObjectId.isValid(data.fileId) ? await files.findOne({ _id: new Types.ObjectId(data.fileId) }) : null
  if (!file) return

  const tmp = await mkdtemp(join(tmpdir(), 'cuka-media-'))
  try {
    // No post yet → no watermark; creating the post enqueues rewatermark, and publishVariants re-checks.
    const ctx = await findContextForFile(deps.conn, file._id)
    const { set, rendered } = await renderCleanVariants(deps, file, tmp, ctx.crop)
    await processFileHooks.beforeStore?.()
    // `ready` is written before the re-check, so a post created after it sees a ready file in its rewatermark job.
    const rerender = async (crop: ProfileCrop | null) => (await renderCleanVariants(deps, file, tmp, crop)).rendered
    await publishVariants(deps, file, rendered, ctx, { ...set, status: 'ready' }, rerender)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
