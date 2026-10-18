import type { ReportReason } from '@cuka/shared'
import { request } from '../client'

/** Mirrors `createReportSchema` in @cuka/shared. */
export const reportPost = (postId: string, reason: ReportReason, detail: string) =>
  request<{ reported: boolean }>(`/posts/${encodeURIComponent(postId)}/report`, { method: 'POST', body: { reason, detail } })
