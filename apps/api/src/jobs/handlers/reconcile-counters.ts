import { Logger } from '@nestjs/common'
import type { mongo, Types } from 'mongoose'
import { countOpenReports } from '../../reports/reports.service'
import type { JobDeps } from './media'

const BATCH = 500
const logger = new Logger('ReconcileCounters')

/** Test seam: runs after a batch is read and before its bulkWrite. */
export const reconcileHooks: { beforeWrite?: (coll: string) => Promise<void> } = {}

type Id = Types.ObjectId | string
type Doc = { _id: Id } & Record<string, unknown>

function valueAt(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], doc)
}

/** Counts `coll` rows matching `match` (with `field ∈ ids`) grouped by `field` (an array field is unwound). */
async function countBy(conn: mongo.Db, coll: string, field: string, ids: Id[], match: Record<string, unknown> = {}, unwind = false): Promise<Map<string, number>> {
  const pipeline: Record<string, unknown>[] = [{ $match: { ...match, [field]: { $in: ids } } }]
  if (unwind) pipeline.push({ $unwind: `$${field}` }, { $match: { [field]: { $in: ids } } })
  pipeline.push({ $group: { _id: `$${field}`, n: { $sum: 1 } } })
  const rows = await conn.collection(coll).aggregate<{ _id: Id; n: number }>(pipeline).toArray()
  return new Map(rows.map((r) => [r._id.toString(), r.n]))
}

/**
 * Walks `coll` in batches; `compute` returns the correct scalar values per doc as dotted leaf paths, and
 * only docs whose stored values differ are `$set` (one bulkWrite per batch). Returns how many docs were fixed.
 */
async function reconcile(
  conn: mongo.Db,
  coll: string,
  projection: Record<string, 1>,
  compute: (batch: Doc[]) => Promise<(doc: Doc) => Record<string, unknown>>,
): Promise<number> {
  let fixed = 0
  const flush = async (batch: Doc[]) => {
    const expected = await compute(batch)
    const ops = []
    for (const doc of batch) {
      const want = expected(doc)
      const read = Object.fromEntries(Object.keys(want).map((path) => [path, valueAt(doc, path) ?? null]))
      if (Object.entries(want).some(([path, v]) => read[path] !== v)) {
        // Compare-and-set: a doc changed since it was read (a concurrent like, follow, ...) is skipped
        // this run rather than overwritten with a stale recount.
        ops.push({ updateOne: { filter: { _id: doc._id, ...read }, update: { $set: want } } })
      }
    }
    await reconcileHooks.beforeWrite?.(coll)
    // The raw driver leaves `updatedAt` alone: a recount is not an edit.
    if (ops.length) fixed += (await conn.collection<Doc>(coll).bulkWrite(ops as never, { ordered: false })).modifiedCount
  }
  let batch: Doc[] = []
  for await (const doc of conn.collection<Doc>(coll).find({}, { projection }).batchSize(BATCH)) {
    batch.push(doc)
    if (batch.length === BATCH) {
      await flush(batch)
      batch = []
    }
  }
  if (batch.length) await flush(batch)
  return fixed
}

/**
 * Nightly: recomputes denormalized counters from their source collections, fixing drift such as the
 * `$gt: 0` decrement guard leaving counts above the real number of rows.
 * - posts.counts.likes/bookmarks: rows; counts.comments: comments with deletedAt null (replies of a
 *   deleted parent still count — kept simple); reportCounts: open reports (shared `countOpenReports`).
 * - users.stats: follows each way; postCount: the user's posts not deleted.
 * - tags.postCount: posts not deleted carrying the tag.
 */
export async function reconcileCounters(deps: JobDeps): Promise<{ fixed: number }> {
  const db = deps.conn.db!
  let fixed = 0

  fixed += await reconcile(db, 'posts', { counts: 1, reportCounts: 1 }, async (batch) => {
    const ids = batch.map((p) => p._id as Types.ObjectId)
    const [likes, bookmarks, comments, reports] = await Promise.all([
      countBy(db, 'likes', 'postId', ids),
      countBy(db, 'bookmarks', 'postId', ids),
      countBy(db, 'comments', 'postId', ids, { deletedAt: null }),
      countOpenReports(deps.conn, ids),
    ])
    return (p) => {
      const id = p._id.toString()
      return {
        'counts.likes': likes.get(id) ?? 0,
        'counts.bookmarks': bookmarks.get(id) ?? 0,
        'counts.comments': comments.get(id) ?? 0,
        'reportCounts.total': reports.get(id)!.total,
        'reportCounts.ai_art': reports.get(id)!.ai_art,
      }
    }
  })

  fixed += await reconcile(db, 'users', { stats: 1 }, async (batch) => {
    const ids = batch.map((u) => u._id)
    const [followers, following, posts] = await Promise.all([
      countBy(db, 'follows', 'followeeId', ids),
      countBy(db, 'follows', 'followerId', ids),
      countBy(db, 'posts', 'authorId', ids, { deletedAt: null }),
    ])
    return (u) => {
      const id = u._id.toString()
      return {
        'stats.followerCount': followers.get(id) ?? 0,
        'stats.followingCount': following.get(id) ?? 0,
        'stats.postCount': posts.get(id) ?? 0,
      }
    }
  })

  fixed += await reconcile(db, 'tags', { postCount: 1 }, async (batch) => {
    const counts = await countBy(db, 'posts', 'tags', batch.map((t) => t._id), { deletedAt: null }, true)
    return (t) => ({ postCount: counts.get(t._id.toString()) ?? 0 })
  })

  logger.log(`fixed=${fixed}`)
  return { fixed }
}
