import { Types } from 'mongoose'
import type { FileDoc, FileVariant } from '../../uploads/file.schema'
import type { JobDeps } from './media'
import { type Rating, renderBlurred, storeVariants, variantBucket } from './process-file'

/** Moves every variant of the post's files into the bucket that matches the post's current rating. */
export async function relocateVariants(deps: JobDeps, data: { postId: string }): Promise<void> {
  if (!Types.ObjectId.isValid(data.postId)) return
  const post = await deps.conn
    .collection('posts')
    .findOne({ _id: new Types.ObjectId(data.postId) }, { projection: { rating: 1, files: 1 } })
  if (!post) return
  const rating: Rating = post.rating === 'r18' ? 'r18' : 'all'
  const target = variantBucket(deps, rating)
  const fileIds = ((post.files ?? []) as Array<{ fileId: Types.ObjectId }>).map((f) => f.fileId)

  const files = deps.conn.collection<FileDoc>('files')
  for (const file of await files.find({ _id: { $in: fileIds } }).toArray()) {
    const variants: FileVariant[] = []
    for (const v of file.variants) {
      if (v.name === 'blurred' && rating === 'all') {
        await deps.storage.remove(v.bucket, v.objectKey)
        continue
      }
      if (v.bucket !== target) {
        // Copy before remove so a crash in between leaves a readable object behind.
        await deps.storage.copy(v.bucket, v.objectKey, target, v.objectKey)
        await deps.storage.remove(v.bucket, v.objectKey)
      }
      variants.push({ ...v, bucket: target })
    }

    const md = variants.find((v) => v.name === 'thumb_md')
    if (rating === 'r18' && md && !variants.some((v) => v.name === 'blurred')) {
      const blurred = await renderBlurred(await deps.storage.getBuffer(md.bucket, md.objectKey))
      variants.push(...(await storeVariants(deps, file, target, [blurred])))
    }
    await files.updateOne({ _id: file._id }, { $set: { variants } })
  }
}
