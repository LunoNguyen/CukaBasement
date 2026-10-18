import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Types } from 'mongoose'
import type { FileDoc } from '../../uploads/file.schema'
import { bumpFeedIfListed } from './feed-gen'
import type { JobDeps } from './media'
import { publishVariants, renderCleanVariants } from './process-file'
import { contextOfPost } from './variants'

/**
 * Regenerates every display variant of the post's ready image/video files from the untouched original, with the
 * post's current credit burned in, in the bucket of its current rating. Files still processing are left to
 * processFile, which picks up the post's credit itself.
 */
export async function rewatermark(deps: JobDeps, data: { postId: string }): Promise<void> {
  if (!Types.ObjectId.isValid(data.postId)) return
  const post = await deps.conn
    .collection('posts')
    .findOne({ _id: new Types.ObjectId(data.postId) }, { projection: { rating: 1, credit: 1, authorId: 1, files: 1 } })
  if (!post) return
  const ctx = await contextOfPost(deps.conn, post)
  const fileIds = ((post.files ?? []) as Array<{ fileId: Types.ObjectId }>).map((f) => f.fileId)
  const files = deps.conn.collection<FileDoc>('files')
  for (const file of await files.find({ _id: { $in: fileIds }, status: 'ready', kind: { $in: ['image', 'video'] } }).toArray()) {
    const tmp = await mkdtemp(join(tmpdir(), 'cuka-media-'))
    try {
      const { rendered } = await renderCleanVariants(deps, file, tmp)
      await publishVariants(deps, file, rendered, ctx, {}, async (crop) => (await renderCleanVariants(deps, file, tmp, crop)).rendered)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
  await bumpFeedIfListed(deps, { postId: post._id as Types.ObjectId })
}
