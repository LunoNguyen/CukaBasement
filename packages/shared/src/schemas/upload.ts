import { z } from 'zod'

export const createUploadSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().min(1),
  mime: z.string().min(1),
})
