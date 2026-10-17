import type { Role, UserStatus } from '@cuka/shared'

/** The authenticated user as seen by request handlers; `null` means anonymous. */
export type Viewer = {
  id: string
  role: Role
  status: UserStatus
  emailVerified: boolean
  isAdult: boolean
  showR18: boolean
}

/** True when at least 18 full years have passed since `birthDate` (compared as UTC calendar dates). */
export function isAdult(birthDate: Date | null, now = new Date()): boolean {
  if (!birthDate) return false
  let years = now.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) years--
  return years >= 18
}

export function canSeeR18(v: Viewer | null): boolean {
  return !!v && v.isAdult && v.showR18
}
