import { Logger } from '@nestjs/common'
import type { Types } from 'mongoose'
import type { FileDoc } from '../../uploads/file.schema'
import { profileFileIds, removeFile } from './cleanup-uploads'
import type { JobDeps } from './media'

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const logger = new Logger('PurgeDeletedPosts')

/**
 * Hard-deletes posts soft-deleted more than 30 days ago: their files (objects + docs; a file still set as
 * a user's avatar or banner is kept, and cleanup-uploads then protects it too), likes, bookmarks,
 * comments, reports and notifications, then the post itself. The post goes last so a crash midway is
 * retried by the next run. Author/tag counters were already adjusted at soft-delete time.
 */
export async function purgeDeletedPosts(deps: JobDeps, now = new Date()): Promise<{ purged: number }> {
  const { conn } = deps
  const cutoff = new Date(now.getTime() - RETENTION_MS)
  const posts = conn.collection('posts').find({ deletedAt: { $lt: cutoff } }, { projection: { files: 1 } })
  let purged = 0
  for await (const post of posts) {
    const fileIds = ((post.files ?? []) as Array<{ fileId: Types.ObjectId }>).map((f) => f.fileId)
    const inProfile = await profileFileIds(deps, fileIds)
    for (const file of await conn.collection<FileDoc>('files').find({ _id: { $in: fileIds } }).toArray()) {
      if (!inProfile.has(file._id.toString())) await removeFile(deps, file)
    }
    for (const name of ['likes', 'bookmarks', 'comments', 'reports', 'notifications']) {
      await conn.collection(name).deleteMany({ postId: post._id })
    }
    await conn.collection('posts').deleteOne({ _id: post._id })
    purged++
  }
  logger.log(`purged=${purged}`)
  return { purged }
}
