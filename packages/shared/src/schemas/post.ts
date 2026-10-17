import { z } from 'zod'
import { LIMITS } from '../limits'
import { POST_TYPES, RATINGS } from '../enums'

const postFields = z.object({
  type: z.enum(POST_TYPES),
  title: z.string().min(1).max(LIMITS.titleMax),
  description: z.string().max(LIMITS.descriptionMax),
  rating: z.enum(RATINGS),
  tags: z.array(z.string()).max(LIMITS.tagsPerPost),
  sourceCredit: z.string().max(500),
  aiDeclaration: z.literal(true),
  files: z
    .array(
      z.object({
        fileId: z.string().min(1),
        position: z.number().int().min(0),
        isCover: z.boolean(),
      }),
    )
    .min(1),
})

export const createPostSchema = postFields.extend({
  description: z.string().max(LIMITS.descriptionMax).default(''),
  sourceCredit: z.string().max(500).default(''),
})

// No defaults here: a partial PATCH must not blank fields that were not sent.
export const updatePostSchema = postFields.partial()
