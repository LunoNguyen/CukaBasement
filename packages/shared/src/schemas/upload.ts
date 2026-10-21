import { z } from 'zod'
import { UPLOAD_PURPOSES } from '../enums'

export const createUploadSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().min(1),
  mime: z.string().min(1),
  /** `site`: a homepage image (admins only, images only). Default `post`. */
  purpose: z.enum(UPLOAD_PURPOSES).optional(),
})
