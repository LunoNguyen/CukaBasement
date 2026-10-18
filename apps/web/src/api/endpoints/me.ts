import type { CropRect, Locale, SocialLink } from '@cuka/shared'
import { request } from '../client'
import type { MeDto } from '../types'

/** Mirrors `updateProfileSchema` in @cuka/shared. */
export interface UpdateProfileInput {
  displayName?: string
  bio?: string
  avatarFileId?: string
  bannerFileId?: string
  /** The box (fractions of the original) the worker crops the avatar / banner to; null or absent with a new file: centred. */
  avatarCrop?: CropRect | null
  bannerCrop?: CropRect | null
  /** The whole ordered list; replaces the stored one. */
  links?: SocialLink[]
}

/** Mirrors `updateSettingsSchema` in @cuka/shared; `birthDate` is `YYYY-MM-DD`. */
export interface UpdateSettingsInput {
  locale?: Locale
  birthDate?: string
  showR18?: boolean
}

/** Mirrors `changePasswordSchema` in @cuka/shared. */
export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export const getMe = () => request<MeDto>('/me')

export const updateProfile = (input: UpdateProfileInput) => request<MeDto>('/me', { method: 'PATCH', body: input })

export const updateSettings = (input: UpdateSettingsInput) => request<MeDto>('/me/settings', { method: 'PATCH', body: input })

export const changePassword = (input: ChangePasswordInput) => request<void>('/me/password', { method: 'POST', body: input })
