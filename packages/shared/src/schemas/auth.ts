import { z } from 'zod'
import { LIMITS } from '../limits'

const password = z.string().min(LIMITS.passwordMin).max(128)

export const registerSchema = z.object({
  email: z.email(),
  password,
  username: z.string().regex(/^[a-z0-9_]{3,24}$/),
  displayName: z.string().min(1).max(LIMITS.displayNameMax),
})
export const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) })
export const emailOnlySchema = z.object({ email: z.email() })
export const tokenSchema = z.object({ token: z.string().min(1) })
export const resetPasswordSchema = z.object({ token: z.string().min(1), password })
