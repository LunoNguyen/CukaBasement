import { request } from '../client'
import type { NotificationDto, Page } from '../types'

export const list = (cursor: string | null) => request<Page<NotificationDto>>('/notifications', { query: { cursor: cursor ?? undefined } })
export const unreadCount = () => request<{ count: number }>('/notifications/unread-count')
export const markRead = (body: { ids: string[] } | { all: true }) => request<void>('/notifications/read', { method: 'POST', body })
