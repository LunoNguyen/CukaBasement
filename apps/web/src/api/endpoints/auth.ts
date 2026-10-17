import { request } from '../client'
import type { SessionDto } from '../types'

/** Mirrors `registerSchema` in @cuka/shared. */
export interface RegisterInput {
  email: string
  password: string
  username: string
  displayName: string
}

export const login = (email: string, password: string) =>
  request<SessionDto>('/auth/login', { method: 'POST', body: { email, password }, auth: false })

export const register = (input: RegisterInput) =>
  request<{ userId: string }>('/auth/register', { method: 'POST', body: input, auth: false })

export const logout = () => request<void>('/auth/logout', { method: 'POST', auth: false })

export const verifyEmail = (token: string) => request<void>('/auth/verify-email', { method: 'POST', body: { token }, auth: false })

export const resendVerification = () => request<void>('/auth/resend-verification', { method: 'POST' })

export const forgotPassword = (email: string) =>
  request<void>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false })

export const resetPassword = (token: string, password: string) =>
  request<void>('/auth/reset-password', { method: 'POST', body: { token, password }, auth: false })
