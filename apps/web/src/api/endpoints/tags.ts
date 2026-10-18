import { request } from '../client'

export interface TagDto {
  name: string
  display: string
  postCount: number
}

export const featuredTags = () => request<TagDto[]>('/tags/featured')
