import { z } from 'zod'
import { REPORT_REASONS } from '../enums'
import { LIMITS } from '../limits'

export const createReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(LIMITS.reportDetailMax).default(''),
})
