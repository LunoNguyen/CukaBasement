import { REPORT_REASONS, REPORT_STATUSES, type ReportReason, type ReportStatus } from '@cuka/shared'
import { type HydratedDocument, Schema, Types } from 'mongoose'

export interface Report {
  _id: Types.ObjectId
  postId: Types.ObjectId
  reporterId: Types.ObjectId
  reason: ReportReason
  detail: string
  status: ReportStatus
  resolvedBy: Types.ObjectId | null
  resolvedAt: Date | null
  createdAt: Date
}

export type ReportDocument = HydratedDocument<Report>

export const REPORT_MODEL = 'Report'

export const ReportSchema = new Schema<Report>(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    reporterId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    detail: { type: String, default: '' },
    status: { type: String, enum: REPORT_STATUSES, default: 'open' },
    resolvedBy: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { collection: 'reports', timestamps: { createdAt: true, updatedAt: false } },
)

// One report per user per post, whatever its status: a dismissed report still blocks reporting again (spec §5.5).
ReportSchema.index({ postId: 1, reporterId: 1 }, { unique: true })
ReportSchema.index({ status: 1, reason: 1, createdAt: -1 })
