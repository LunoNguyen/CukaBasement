import type { HomeSection, SitePage } from '@cuka/shared'
import { request } from '../client'
import type { AdminSiteImageDto, HomeDraftDto, MusicStatusDto, Page, PostCardDto, PublicHomeDto } from '../types'

/** A published page: `home` (the landing page at "/") or `intro` (the Introduction page). */
export const publicPage = (page: SitePage) => request<PublicHomeDto>(`/site/pages/${page}`)
export const publicHome = () => publicPage('home')
export const fanartShowcase = (limit: number) => request<Page<PostCardDto>>('/feed/showcase', { query: { limit } })

export const pageDraft = (page: SitePage) => request<HomeDraftDto>(`/admin/site/pages/${page}/draft`)
export const savePageDraft = (page: SitePage, revision: number, sections: HomeSection[]) =>
  request<HomeDraftDto>(`/admin/site/pages/${page}/draft`, { method: 'PUT', body: { revision, sections } })
export const publishPage = (page: SitePage, revision: number) => request<HomeDraftDto>(`/admin/site/pages/${page}/publish`, { method: 'POST', body: { revision } })
export const discardPageDraft = (page: SitePage, revision: number) => request<HomeDraftDto>(`/admin/site/pages/${page}/discard`, { method: 'POST', body: { revision } })

export const siteImages = () => request<AdminSiteImageDto[]>('/admin/site/images')
export const deleteSiteImage = (id: string) => request<void>(`/admin/site/images/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** The music section's automatic feeds (last fetch, count, error) and whether the server has a YouTube API key. */
export const musicStatus = () => request<MusicStatusDto>('/admin/site/music')
/** Asks the worker to refetch every YouTube feed now (rate-limited). */
export const refreshMusic = () => request<{ queued: boolean }>('/admin/site/music/refresh', { method: 'POST' })
