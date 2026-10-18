import { z } from 'zod'
import { LIMITS } from '../limits'
import { LOCALES } from '../enums'
import { SOCIAL_PLATFORMS } from '../social'

/**
 * One profile link: an http(s) URL of at most `socialLinkUrlMax` characters. `other` needs a label (an issue with
 * `params.code = 'LABEL_REQUIRED'` otherwise); other platforms are named by the platform, so their label is dropped.
 */
export const socialLinkSchema = z
  .object({
    platform: z.enum(SOCIAL_PLATFORMS),
    label: z.string().trim().max(LIMITS.socialLinkLabelMax).optional(),
    url: z.url({ protocol: /^https?$/ }).max(LIMITS.socialLinkUrlMax),
  })
  .superRefine((l, ctx) => {
    if (l.platform === 'other' && !l.label) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'label is required for platform other', params: { code: 'LABEL_REQUIRED' } })
    }
  })
  .transform(({ platform, label, url }) => (platform === 'other' ? { platform, label: label!, url } : { platform, url }))

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(LIMITS.displayNameMax).optional(),
  bio: z.string().max(LIMITS.bioMax).optional(),
  avatarFileId: z.string().min(1).optional(),
  bannerFileId: z.string().min(1).optional(),
  /** The whole ordered list (replaces the stored one); `[]` removes every link. */
  links: z.array(socialLinkSchema).max(LIMITS.socialLinksMax).optional(),
})

const birthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'invalid date')
  .refine((s) => s >= '1900-01-01', 'too early')
  .refine((s) => s <= new Date().toISOString().slice(0, 10), 'in the future')

export const updateSettingsSchema = z.object({
  locale: z.enum(LOCALES).optional(),
  birthDate: birthDate.optional(),
  showR18: z.boolean().optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(LIMITS.passwordMin).max(128),
})
