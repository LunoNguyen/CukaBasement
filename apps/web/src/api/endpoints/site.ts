import type { HomeSection } from '@cuka/shared'
import { request } from '../client'
import type { AdminSiteImageDto, HomeDraftDto, Page, PostCardDto, PublicHomeDto } from '../types'

export const publicHome = () => request<PublicHomeDto>('/site/home')
export const fanartShowcase = (limit: number) => request<Page<PostCardDto>>('/feed/showcase', { query: { limit } })

export const homeDraft = () => request<HomeDraftDto>('/admin/site/home/draft')
export const saveHomeDraft = (revision: number, sections: HomeSection[]) =>
  request<HomeDraftDto>('/admin/site/home/draft', { method: 'PUT', body: { revision, sections } })
export const publishHome = (revision: number) => request<HomeDraftDto>('/admin/site/home/publish', { method: 'POST', body: { revision } })
export const discardHomeDraft = (revision: number) => request<HomeDraftDto>('/admin/site/home/discard', { method: 'POST', body: { revision } })

export const siteImages = () => request<AdminSiteImageDto[]>('/admin/site/images')
export const deleteSiteImage = (id: string) => request<void>(`/admin/site/images/${encodeURIComponent(id)}`, { method: 'DELETE' })
