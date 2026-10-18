import { request } from '../client'

const post = (id: string) => `/posts/${encodeURIComponent(id)}`
const user = (username: string) => `/users/${encodeURIComponent(username)}`

export const like = (id: string) => request<{ liked: boolean; likes: number }>(`${post(id)}/like`, { method: 'POST' })
export const unlike = (id: string) => request<{ liked: boolean; likes: number }>(`${post(id)}/like`, { method: 'DELETE' })

export const bookmark = (id: string, isPrivate = false) =>
  request<{ bookmarked: boolean; bookmarks: number }>(`${post(id)}/bookmark`, { method: 'POST', body: { isPrivate } })
export const unbookmark = (id: string) => request<{ bookmarked: boolean; bookmarks: number }>(`${post(id)}/bookmark`, { method: 'DELETE' })

export const follow = (username: string) => request<{ following: boolean; followerCount: number }>(`${user(username)}/follow`, { method: 'POST' })
export const unfollow = (username: string) =>
  request<{ following: boolean; followerCount: number }>(`${user(username)}/follow`, { method: 'DELETE' })
