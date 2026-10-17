import { z } from 'zod'
import { REPORT_REASONS } from '../enums'

export const createReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(1000).default(''),
})
