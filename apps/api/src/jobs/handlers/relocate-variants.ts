import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { Types } from 'mongoose'
import type { FileDoc } from '../../uploads/file.schema'
import { bumpFeedIfListed } from './feed-gen'
import type { JobDeps } from './media'
import { publishVariants, renderCleanVariants } from './process-file'
import { contextOfPost, findContextForFile, moveFileVariants } from './variants'

/** Moves every variant of the post's files into the bucket that matches the post's current rating (a new blurred is watermarked). */
export async function relocateVariants(deps: JobDeps, data: { postId: string }): Promise<void> {
  if (!Types.ObjectId.isValid(data.postId)) return
  const post = await deps.conn
    .collection('posts')
    .findOne({ _id: new Types.ObjectId(data.postId) }, { projection: { rating: 1, credit: 1, authorId: 1, files: 1 } })
  if (!post) return
  const { rating, watermark } = await contextOfPost(deps.conn, post)
  const fileIds = ((post.files ?? []) as Array<{ fileId: Types.ObjectId }>).map((f) => f.fileId)

  const files = deps.conn.collection<FileDoc>('files')
  for (const file of await files.find({ _id: { $in: fileIds } }).toArray()) {
    await moveFileVariants(deps, file, rating, watermark)
  }
  await bumpFeedIfListed(deps, { postId: post._id as Types.ObjectId })
}

const logger = new Logger('RelocateFile')

/** A file that is in no post (live or soft-deleted) and is some user's avatar or banner. */
async function isPostlessProfileImage(deps: JobDeps, fileId: Types.ObjectId): Promise<boolean> {
  if (await deps.conn.collection('posts').findOne({ 'files.fileId': fileId }, { projection: { _id: 1 } })) return false
  const user = await deps.conn
    .collection('users')
    .findOne({ $or: [{ 'profile.avatarFileId': fileId }, { 'profile.bannerFileId': fileId }] }, { projection: { _id: 1 } })
  return !!user
}

/**
 * Publishes the variants of a file that just became a profile image (avatar or banner): re-renders them from the
 * original, center-cropped for the role (avatar 1:1 ≤512px, banner 4:1 ≤1600px, animation kept), into the public
 * bucket. Acts only on a ready file that is in no post and is a profile image; a file in any post belongs to the post
 * jobs (rewatermark/relocate), which must not be pre-empted with clean renders. publishVariants re-checks the context
 * after storing, so a file that joined a post meanwhile is redrawn for that post (watermarked, uncropped), and the
 * post's own rewatermark job (enqueued by the post create) redraws it again.
 */
export async function relocateFile(deps: JobDeps, data: { fileId: string }): Promise<void> {
  if (!Types.ObjectId.isValid(data.fileId)) return
  const _id = new Types.ObjectId(data.fileId)
  const file = await deps.conn.collection<FileDoc>('files').findOne({ _id })
  if (!file || file.status !== 'ready') return
  if (!(await isPostlessProfileImage(deps, _id))) return
  if (file.kind !== 'image') {
    await moveFileVariants(deps, file, 'all', null)
    await bumpFeedIfListed(deps, { fileId: _id })
    return
  }
  const tmp = await mkdtemp(join(tmpdir(), 'cuka-media-'))
  try {
    const ctx = await findContextForFile(deps.conn, _id)
    const { rendered } = await renderCleanVariants(deps, file, tmp, ctx.crop)
    await publishVariants(deps, file, rendered, ctx, {}, async (crop) => (await renderCleanVariants(deps, file, tmp, crop)).rendered)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  await bumpFeedIfListed(deps, { fileId: _id })
  if (!(await isPostlessProfileImage(deps, _id))) {
    logger.warn(`File ${data.fileId} joined a post during relocate-file; leaving it to the post's rewatermark job`)
  }
}
