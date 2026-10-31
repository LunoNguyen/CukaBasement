import type { HomeBanner, HomeSection, SitePage } from '@cuka/shared'
import { request } from '../client'
import type { AdminSiteImageDto, HomeBannerDto, HomeDraftDto, MusicStatusDto, Page, PostCardDto, PublicHomeDto } from '../types'

/** A published page: `intro` (the Introduction page; `home` is the old landing page, read-only). */
export const publicPage = (page: SitePage) => request<PublicHomeDto>(`/site/pages/${page}`)
/** The fanart gallery's home banner (null when the admin cleared it). */
export const homeBanner = () => request<{ banner: HomeBannerDto | null }>('/site/banner')
export const fanartShowcase = (limit: number) => request<Page<PostCardDto>>('/feed/showcase', { query: { limit } })

export const pageDraft = (page: SitePage) => request<HomeDraftDto>(`/admin/site/pages/${page}/draft`)
/** Saves the draft; `banner` (the gallery's home banner, Introduction page only) is left as stored when undefined. */
export const savePageDraft = (page: SitePage, revision: number, sections: HomeSection[], banner?: HomeBanner | null) =>
  request<HomeDraftDto>(`/admin/site/pages/${page}/draft`, { method: 'PUT', body: banner === undefined ? { revision, sections } : { revision, sections, banner } })
export const publishPage = (page: SitePage, revision: number) => request<HomeDraftDto>(`/admin/site/pages/${page}/publish`, { method: 'POST', body: { revision } })
export const discardPageDraft = (page: SitePage, revision: number) => request<HomeDraftDto>(`/admin/site/pages/${page}/discard`, { method: 'POST', body: { revision } })

export const siteImages = () => request<AdminSiteImageDto[]>('/admin/site/images')
export const deleteSiteImage = (id: string) => request<void>(`/admin/site/images/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** The music section's automatic feeds (last fetch, count, error) and whether the server has a YouTube API key. */
export const musicStatus = () => request<MusicStatusDto>('/admin/site/music')
/** Asks the worker to refetch every YouTube feed now (rate-limited). */
export const refreshMusic = () => request<{ queued: boolean }>('/admin/site/music/refresh', { method: 'POST' })
