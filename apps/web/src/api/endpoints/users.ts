import { request } from '../client'
import type { PublicUserDto } from '../types'

export const getUser = (username: string) => request<PublicUserDto>(`/users/${encodeURIComponent(username)}`)
