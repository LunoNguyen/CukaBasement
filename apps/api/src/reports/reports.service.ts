import { Inject, Injectable } from '@nestjs/common'
import { getConnectionToken, InjectModel } from '@nestjs/mongoose'
import type { ReportReason } from '@cuka/shared'
import { type Connection, type Model, Types } from 'mongoose'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { ModerationLogService } from '../moderation/moderation-log.service'
import { NotificationsService } from '../notifications/notifications.service'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { canViewPost } from '../posts/visibility'
import { SettingsService } from '../settings/settings.service'
import { REPORT_MODEL, type Report } from './report.schema'

export interface CreateReportInput {
  reason: ReportReason
  detail: string
}

export type ReportCounts = { total: number; ai_art: number }

function isDuplicate(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 11000
}

function postNotFound(): AppError {
  return new AppError('POST_NOT_FOUND', 404, 'Post not found')
}

/** Counts `open` reports per post for the given posts (absent ones count zero). Shared with the nightly reconcile. */
export async function countOpenReports(conn: Connection, postIds: Types.ObjectId[]): Promise<Map<string, ReportCounts>> {
  const rows = await conn
    .collection('reports')
    .aggregate<ReportCounts & { _id: Types.ObjectId }>([
      { $match: { postId: { $in: postIds }, status: 'open' } },
      { $group: { _id: '$postId', total: { $sum: 1 }, ai_art: { $sum: { $cond: [{ $eq: ['$reason', 'ai_art'] }, 1, 0] } } } },
    ])
    .toArray()
  const out = new Map<string, ReportCounts>()
  for (const id of postIds) out.set(id.toString(), { total: 0, ai_art: 0 })
  for (const r of rows) out.set(r._id.toString(), { total: r.total, ai_art: r.ai_art })
  return out
}

/**
 * Recomputes `posts.reportCounts` from the post's `open` reports and stores it. A plain function
 * over the connection so jobs can use it without Nest DI.
 */
export async function recountOpenReports(conn: Connection, postId: string): Promise<ReportCounts> {
  const _id = new Types.ObjectId(postId)
  const counts = (await countOpenReports(conn, [_id])).get(_id.toString())!
  // The raw driver leaves `updatedAt` alone: a recount is not an edit.
  await conn.collection('posts').updateOne({ _id }, { $set: { reportCounts: counts } })
  return counts
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(REPORT_MODEL) private readonly reports: Model<Report>,
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @Inject(getConnectionToken()) private readonly conn: Connection,
    private readonly settings: SettingsService,
    private readonly modLog: ModerationLogService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Spec §3.4 step 3: insert the report (the unique index rejects repeats), then bump the counters,
   * then hide with one conditional update. Only the request whose update flipped the post logs and
   * notifies, so concurrent reports crossing the threshold produce a single log and notification.
   */
  async create(viewer: Viewer, postId: string, input: CreateReportInput): Promise<{ reported: true }> {
    const post = /^[0-9a-fA-F]{24}$/.test(postId) ? await this.posts.findById(postId).lean() : null
    if (!post || !canViewPost(viewer, post)) throw postNotFound()
    if (post.authorId.toString() === viewer.id) throw new AppError('CANNOT_REPORT_OWN_POST', 400, 'You cannot report your own post')

    try {
      await this.reports.create({ postId: post._id, reporterId: new Types.ObjectId(viewer.id), reason: input.reason, detail: input.detail })
    } catch (err) {
      if (isDuplicate(err)) throw new AppError('REPORT_ALREADY_EXISTS', 409, 'You already reported this post')
      throw err
    }

    const inc: Record<string, number> = { 'reportCounts.total': 1 }
    if (input.reason === 'ai_art') inc['reportCounts.ai_art'] = 1
    // timestamps: false keeps `updatedAt` for real edits.
    await this.posts.updateOne({ _id: post._id }, { $inc: inc }, { timestamps: false })

    const { reportHideThreshold, reportAiHideThreshold } = await this.settings.get()
    const hidden = await this.posts
      .findOneAndUpdate(
        {
          _id: post._id,
          visibility: 'public',
          deletedAt: null,
          $or: [{ 'reportCounts.total': { $gte: reportHideThreshold } }, { 'reportCounts.ai_art': { $gte: reportAiHideThreshold } }],
        },
        { $set: { visibility: 'hidden_by_reports' } },
        { returnDocument: 'after', timestamps: false },
      )
      .lean()
    if (hidden) {
      const id = hidden._id.toString()
      await this.modLog.log('system', 'auto_hide', 'post', id, `total=${hidden.reportCounts.total} ai_art=${hidden.reportCounts.ai_art}`)
      await this.notifications.notify({ userId: hidden.authorId.toString(), type: 'post_hidden', postId: id })
    }
    return { reported: true }
  }

  recountOpen(postId: string): Promise<ReportCounts> {
    return recountOpenReports(this.conn, postId)
  }
}
