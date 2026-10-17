import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { VariantName } from '@cuka/shared'
import { Types } from 'mongoose'
import sharp from 'sharp'
import type { FileDoc } from '../../uploads/file.schema'
import { extractFrame, type JobDeps, probe } from './media'
import { findRatingForFile, moveFileVariants, type Rendered, render, renderBlurred, SHARP_INPUT, storeVariants, variantBucket } from './variants'

export { findRatingForFile } from './variants'

const THUMBS: Array<[VariantName, number]> = [
  ['thumb_sm', 360],
  ['thumb_md', 1200],
]

/** Test seam: runs after the rating is read and before variants are stored. */
export const processFileHooks: { beforeStore?: () => Promise<void> } = {}

async function thumbsFrom(input: Buffer): Promise<Rendered[]> {
  // sharp strips EXIF (incl. GPS) unless withMetadata/withExif is called; never call them here.
  const base = sharp(input, { ...SHARP_INPUT, animated: false }).rotate()
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

    const rating = await findRatingForFile(deps.conn, file._id)
    if (rating === 'r18') {
      const md = rendered.find((r) => r.name === 'thumb_md')
      if (md) rendered.push(await renderBlurred(md.body))
    }
    await processFileHooks.beforeStore?.()
    const variants = await storeVariants(deps, file, variantBucket(deps, rating), rendered)
    await files.updateOne({ _id: file._id }, { $set: { ...set, variants, status: 'ready' } })

    // A rating change during processing may have run relocate-variants against the old (empty) variants.
    const now = await findRatingForFile(deps.conn, file._id)
    if (now !== rating) await moveFileVariants(deps, { ...file, variants }, now)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
