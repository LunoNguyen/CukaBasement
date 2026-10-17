import { Types } from 'mongoose'
import type { FileDoc } from '../../uploads/file.schema'
import type { JobDeps } from './media'
import { moveFileVariants, type Rating } from './variants'

/** Moves every variant of the post's files into the bucket that matches the post's current rating. */
export async function relocateVariants(deps: JobDeps, data: { postId: string }): Promise<void> {
  if (!Types.ObjectId.isValid(data.postId)) return
  const post = await deps.conn
    .collection('posts')
    .findOne({ _id: new Types.ObjectId(data.postId) }, { projection: { rating: 1, files: 1 } })
  if (!post) return
  const rating: Rating = post.rating === 'r18' ? 'r18' : 'all'
  const fileIds = ((post.files ?? []) as Array<{ fileId: Types.ObjectId }>).map((f) => f.fileId)

  const files = deps.conn.collection<FileDoc>('files')
  for (const file of await files.find({ _id: { $in: fileIds } }).toArray()) {
    await moveFileVariants(deps, file, rating)
  }
}
