import { z } from 'zod'
import { LIMITS } from '../limits'
import { POST_TYPES } from '../enums'

export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
})

export const searchQuerySchema = cursorQuerySchema.extend({
  q: z.string().min(1).max(100).optional(),
  tag: z.string().min(1).max(LIMITS.tagMax + 1).optional(),
  type: z.enum(POST_TYPES).optional(),
})
