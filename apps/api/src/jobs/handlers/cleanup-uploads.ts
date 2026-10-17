import { Logger } from '@nestjs/common'
import type { mongo, Types } from 'mongoose'
import type { FileDoc } from '../../uploads/file.schema'
import { stagingKey } from '../../uploads/uploads.service'
import type { JobsPort } from '../jobs.port'
import type { JobDeps } from './media'

const HOUR = 60 * 60 * 1000
const BATCH = 500
const logger = new Logger('CleanupUploads')

export type CleanupDeps = JobDeps & { jobs: JobsPort }

export interface CleanupResult {
  removed: number
  stagingSwept: number
  requeued: number
}

function stagingKeyOf(file: FileDoc): string {
  return stagingKey(file.ownerId.toString(), file._id.toString(), file.objectKey.slice(file.objectKey.lastIndexOf('.') + 1))
}

/**
 * Removes every object of the file (original, staging, variants in both buckets), then its doc.
 * Objects go first so a crash leaves the doc behind and the next run retries; removals are idempotent.
 */
export async function removeFile(deps: JobDeps, file: FileDoc): Promise<void> {
  const { bucketOriginals, bucketPublic } = deps.config.minio
  await deps.storage.remove(file.bucket, file.objectKey)
  await deps.storage.remove(file.bucket, stagingKeyOf(file))
  // A crashed relocate can leave a copy in the other bucket, so variants are removed from both.
  for (const v of file.variants) {
    await deps.storage.remove(bucketOriginals, v.objectKey)
    await deps.storage.remove(bucketPublic, v.objectKey)
  }
  await deps.conn.collection<FileDoc>('files').deleteOne({ _id: file._id })
}

/** Streams the matching files in batches so a large backlog is never held in memory at once. */
async function forEachBatch(deps: JobDeps, filter: mongo.Filter<FileDoc>, fn: (batch: FileDoc[]) => Promise<void>): Promise<void> {
  const cursor = deps.conn.collection<FileDoc>('files').find(filter).batchSize(BATCH)
  let batch: FileDoc[] = []
  for await (const file of cursor) {
    batch.push(file)
    if (batch.length === BATCH) {
      await fn(batch)
      batch = []
    }
  }
  if (batch.length) await fn(batch)
}

/** Ids among `ids` used by any post (deleted ones too: purge owns those) or as a user's avatar or banner. */
async function referencedIds(deps: JobDeps, ids: Types.ObjectId[]): Promise<Set<string>> {
  const used = new Set<string>()
  const posts = deps.conn.collection('posts').find({ 'files.fileId': { $in: ids } }, { projection: { files: 1 } })
  for await (const p of posts) for (const f of (p.files ?? []) as Array<{ fileId: Types.ObjectId }>) used.add(f.fileId.toString())
  const users = deps.conn
    .collection('users')
    .find(
      { $or: [{ 'profile.avatarFileId': { $in: ids } }, { 'profile.bannerFileId': { $in: ids } }] },
      { projection: { 'profile.avatarFileId': 1, 'profile.bannerFileId': 1 } },
    )
  for await (const u of users) {
    if (u.profile?.avatarFileId) used.add(u.profile.avatarFileId.toString())
    if (u.profile?.bannerFileId) used.add(u.profile.bannerFileId.toString())
  }
  return used
}

/** A `process-file` job for the file that is still due or running (a finished one has no nextRunAt or lock). */
async function hasPendingProcessJob(deps: JobDeps, fileId: string): Promise<boolean> {
  const job = await deps.conn
    .collection('jobs')
    .findOne({ name: 'process-file', 'data.fileId': fileId, $or: [{ nextRunAt: { $ne: null } }, { lockedAt: { $ne: null } }] }, { projection: { _id: 1 } })
  return job !== null
}

/**
 * Hourly upload hygiene:
 * 1. abandoned uploads: `uploading`, `failed` or stuck `validating` (crash mid-complete) older than 24h;
 * 2. `processing`/`ready` files older than 24h not used by any post, avatar or banner;
 * 3. leftover staging objects (`upload.<ext>`, best-effort removal in complete) of files past `uploading`
 *    created in the last 7 days. Files have no updatedAt; a presigned POST expires after 15 min, so a
 *    staging object can only appear right after createdAt and the 7-day window bounds the per-run cost;
 * 4. files `processing` for over 1h (by createdAt) with no pending `process-file` job are re-enqueued.
 */
export async function cleanupUploads(deps: CleanupDeps, now = new Date()): Promise<CleanupResult> {
  const dayAgo = new Date(now.getTime() - 24 * HOUR)
  const result: CleanupResult = { removed: 0, stagingSwept: 0, requeued: 0 }

  await forEachBatch(deps, { status: { $in: ['uploading', 'failed', 'validating'] }, createdAt: { $lt: dayAgo } }, async (batch) => {
    for (const file of batch) await removeFile(deps, file)
    result.removed += batch.length
  })

  await forEachBatch(deps, { status: { $in: ['processing', 'ready'] }, createdAt: { $lt: dayAgo } }, async (batch) => {
    const used = await referencedIds(deps, batch.map((f) => f._id))
    for (const file of batch) {
      if (used.has(file._id.toString())) continue
      await removeFile(deps, file)
      result.removed++
    }
  })

  const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR)
  // `validating` is excluded: complete() is still reading the staging object.
  await forEachBatch(deps, { status: { $in: ['processing', 'ready', 'failed'] }, createdAt: { $gte: weekAgo } }, async (batch) => {
    for (const file of batch) {
      const key = stagingKeyOf(file)
      if (!(await deps.storage.stat(file.bucket, key))) continue
      await deps.storage.remove(file.bucket, key)
      result.stagingSwept++
    }
  })

  const hourAgo = new Date(now.getTime() - HOUR)
  await forEachBatch(deps, { status: 'processing', createdAt: { $lt: hourAgo } }, async (batch) => {
    for (const file of batch) {
      const fileId = file._id.toString()
      if (await hasPendingProcessJob(deps, fileId)) continue
      await deps.jobs.enqueue('process-file', { fileId })
      result.requeued++
    }
  })

  logger.log(`removed=${result.removed} stagingSwept=${result.stagingSwept} requeued=${result.requeued}`)
  return result
}
