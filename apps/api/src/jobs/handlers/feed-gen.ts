import type { Types } from 'mongoose'
import type { JobDeps } from './media'

const LISTED = { 'review.status': 'approved', visibility: 'public', deletedAt: null }

/**
 * After a variant job: invalidates the cached public lists (FeedCache) when what it changed shows on a list card, i.e.
 * the post is listed, the file is in a listed post, or the file is someone's avatar. Uploads that are in no listed
 * post (the common case) leave the cache alone. No-op without `deps.feed` (tests running handlers inline).
 */
export async function bumpFeedIfListed(deps: JobDeps, ref: { postId: Types.ObjectId } | { fileId: Types.ObjectId }): Promise<void> {
  if (!deps.feed) return
  const posts = deps.conn.collection('posts')
  const listed =
    'postId' in ref
      ? await posts.findOne({ _id: ref.postId, ...LISTED }, { projection: { _id: 1 } })
      : ((await posts.findOne({ 'files.fileId': ref.fileId, ...LISTED }, { projection: { _id: 1 } })) ??
        (await deps.conn.collection('users').findOne({ 'profile.avatarFileId': ref.fileId }, { projection: { _id: 1 } })))
  if (listed) await deps.feed.bump()
}
