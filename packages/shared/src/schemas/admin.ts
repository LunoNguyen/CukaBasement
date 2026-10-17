import { z } from 'zod'
import { DEFAULT_SETTINGS } from '../limits'
import { ROLES } from '../enums'

export const rejectSchema = z.object({ reason: z.string().min(1).max(500) })

export const resolveReportsSchema = z.object({
  decision: z.enum(['keep', 'remove']),
  note: z.string().max(500).optional(),
})

export const adminStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned']),
  note: z.string().max(500).optional(),
})

export const adminRoleSchema = z.object({ role: z.enum(ROLES) })

const posInt = z.number().int().positive()
export const adminSettingsSchema = z.object({
  reportHideThreshold: posInt.optional(),
  reportAiHideThreshold: posInt.optional(),
  maxFileBytes: posInt.max(DEFAULT_SETTINGS.maxFileBytes).optional(),
  maxFilesPerPost: posInt.optional(),
  dailyUploadQuotaBytes: posInt.optional(),
})
