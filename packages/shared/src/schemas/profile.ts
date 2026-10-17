import { z } from 'zod'
import { LIMITS } from '../limits'
import { LOCALES } from '../enums'

const link = z.union([z.literal(''), z.url()])

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(LIMITS.bioMax).optional(),
  avatarFileId: z.string().min(1).optional(),
  bannerFileId: z.string().min(1).optional(),
  socialLinks: z
    .object({
      x: link.optional(),
      facebook: link.optional(),
      youtube: link.optional(),
      pixiv: link.optional(),
    })
    .optional(),
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
