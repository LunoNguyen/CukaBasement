import { Logger } from '@nestjs/common'
import type { NotificationType } from '@cuka/shared'
import { type mongo, Types } from 'mongoose'
import type { JobDeps } from './media'

/** Inserts per insertMany call; staff lists are small, this only bounds a pathological one. */
export const NOTIFY_BATCH = 500
const logger = new Logger('NotifyStaffReview')

export type ReviewEvent = 'submitted' | 'resubmitted'

export interface NotifyStaffReviewData {
  postId: string
  event: ReviewEvent
  /** Distinguishes occurrences of the same event on one post (each resubmission); stable across job retries. */
  key: string
}

const TYPE_OF: Record<ReviewEvent, NotificationType> = { submitted: 'post_pending_review', resubmitted: 'post_resubmitted' }

export function reviewDedupeKey(data: NotifyStaffReviewData): string {
  return `review:${data.postId}:${data.event}:${data.key}`
}

/** Write errors of a bulk insert that are all duplicate-key ones (already notified on a previous attempt). */
function duplicateCount(err: unknown): number | null {
  const e = err as { code?: number; writeErrors?: unknown }
  const errors = e.writeErrors === undefined ? [e] : Array.isArray(e.writeErrors) ? e.writeErrors : [e.writeErrors]
  return errors.length > 0 && errors.every((w) => (w as { code?: number }).code === 11000) ? errors.length : null
}

/**
 * Tells every active moderator and admin (except the author) that a post waits for review. Idempotent: the unique
 * (userId, dedupeKey) index turns a retry into a no-op for users already notified. Skips posts no longer pending.
 * Returns how many notifications were inserted.
 */
export async function notifyStaffReview(deps: Pick<JobDeps, 'conn'>, data: NotifyStaffReviewData): Promise<{ inserted: number }> {
  if (!Types.ObjectId.isValid(data.postId) || !(data.event in TYPE_OF)) return { inserted: 0 }
  const postId = new Types.ObjectId(data.postId)
  const db = deps.conn
  const post = await db
    .collection<{ authorId: Types.ObjectId; review: { status: string }; deletedAt: Date | null }>('posts')
    .findOne({ _id: postId, deletedAt: null }, { projection: { authorId: 1, review: 1 } })
  if (!post || post.review.status !== 'pending') return { inserted: 0 }

  const type = TYPE_OF[data.event]
  const dedupeKey = reviewDedupeKey(data)
  const staff = db
    .collection('users')
    .find({ role: { $in: ['moderator', 'admin'] }, status: 'active', _id: { $ne: post.authorId } }, { projection: { _id: 1 } })
    .batchSize(NOTIFY_BATCH)
  const notifications = db.collection('notifications')

  let inserted = 0
  let batch: mongo.OptionalId<mongo.Document>[] = []
  const flush = async () => {
    if (batch.length === 0) return
    const docs = batch
    batch = []
    try {
      inserted += (await notifications.insertMany(docs, { ordered: false })).insertedCount
    } catch (err) {
      const dups = duplicateCount(err)
      if (dups === null) throw err
      inserted += docs.length - dups
    }
  }
  const createdAt = new Date()
  for await (const u of staff) {
    batch.push({ userId: u._id, type, actorId: post.authorId, postId, commentId: null, readAt: null, dedupeKey, createdAt })
    if (batch.length >= NOTIFY_BATCH) await flush()
  }
  await flush()
  if (inserted > 0) logger.log(`${type} for post ${data.postId}: notified ${inserted} staff`)
  return { inserted }
}
