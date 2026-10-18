import type { GlobalSettings, ModAction, Role, UserStatus } from '@cuka/shared'
import { request } from '../client'
import type { AdminLogDto, AdminUserDto, Page } from '../types'

export interface UserFilters {
  q?: string
  role?: Role
  status?: UserStatus
}

export const users = (f: UserFilters, cursor: string | null) =>
  request<Page<AdminUserDto>>('/admin/users', { query: { q: f.q || undefined, role: f.role, status: f.status, cursor: cursor ?? undefined } })
export const setStatus = (id: string, status: UserStatus, note?: string) =>
  request<AdminUserDto>(`/admin/users/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, ...(note ? { note } : {}) } })
export const setRole = (id: string, role: Role) =>
  request<AdminUserDto>(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'POST', body: { role } })

export const settings = () => request<GlobalSettings>('/admin/settings')
export const updateSettings = (patch: Partial<GlobalSettings>) => request<GlobalSettings>('/admin/settings', { method: 'PATCH', body: patch })

export const logs = (action: ModAction | undefined, cursor: string | null) =>
  request<Page<AdminLogDto>>('/admin/logs', { query: { action, cursor: cursor ?? undefined } })
