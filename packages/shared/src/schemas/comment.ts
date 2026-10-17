import { z } from 'zod'
import { LIMITS } from '../limits'

export const createCommentSchema = z.object({
  body: z.string().min(1).max(LIMITS.commentMax),
  parentId: z.string().min(1).optional(),
})
