import type { AuthorDto, PostCardDto, PostMediaDto } from '@/api/types'

export const author: AuthorDto = { id: 'u1', username: 'cuka', displayName: 'Cuka', avatarUrl: null }
export const media = (o: Partial<PostMediaDto> = {}): PostMediaDto => ({
  fileId: 'f1', kind: 'image', position: 0, isCover: true, status: 'ready',
  thumbSmUrl: 'http://cdn/t.webp', thumbMdUrl: null, previewUrl: null, blurred: false, ...o,
})
export const card = (o: Partial<PostCardDto> = {}): PostCardDto => ({
  id: 'p1', type: 'illustration', title: 'Mèo', rating: 'all', cover: media(), pageCount: 1,
  counts: { likes: 7, bookmarks: 0, comments: 0, views: 0 }, author,
  credit: { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' },
  createdAt: '2026-01-01T00:00:00Z', ...o,
})

