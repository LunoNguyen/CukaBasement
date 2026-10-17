import { z } from 'zod'
import { LIMITS } from '../limits'
import { CREDIT_PLATFORMS } from '../credit'
import { POST_TYPES, RATINGS } from '../enums'

/**
 * Fanart credit. A repost (`isOwnWork: false`) must name the artist, the platform and the source URL; an issue
 * carrying `params.code = 'CREDIT_REQUIRED'` is reported when one is missing (the API answers 400 CREDIT_REQUIRED).
 * Own work needs nothing else; a missing platform becomes `other`.
 */
export const creditSchema = z
  .object({
    isOwnWork: z.boolean(),
    artistName: z.string().trim().max(100).default(''),
    artistHandle: z.string().trim().max(100).default(''),
    platform: z.enum(CREDIT_PLATFORMS).optional(),
    sourceUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)]).default(''),
    permissionNote: z.string().trim().max(300).default(''),
  })
  .superRefine((c, ctx) => {
    if (c.isOwnWork) return
    for (const field of ['artistName', 'platform', 'sourceUrl'] as const) {
      if (!c[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required for a repost`, params: { code: 'CREDIT_REQUIRED' } })
      }
    }
  })
  .transform((c) => ({ ...c, platform: c.platform ?? 'other' }))

export type Credit = z.output<typeof creditSchema>

const postFields = z.object({
  type: z.enum(POST_TYPES),
  title: z.string().min(1).max(LIMITS.titleMax),
  description: z.string().max(LIMITS.descriptionMax),
  rating: z.enum(RATINGS),
  tags: z.array(z.string()).max(LIMITS.tagsPerPost),
  credit: creditSchema,
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
})

// No defaults here: a partial PATCH must not blank fields that were not sent.
export const updatePostSchema = postFields.partial()
