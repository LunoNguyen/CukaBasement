import type { AuthorDto, CommentDto, PostCardDto, PostDto, PostMediaDto, PublicUserDto } from '@/api/types'

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

export const postDto = (o: Partial<PostDto> = {}): PostDto => ({
  id: 'p1', type: 'illustration', title: 'Mèo', description: 'Một con mèo', rating: 'all', tags: ['fanart'],
  credit: { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' },
  review: { status: 'approved' }, visibility: 'public',
  counts: { likes: 7, bookmarks: 2, comments: 0, views: 0 }, author,
  media: [media({ thumbMdUrl: 'http://cdn/md.webp' })],
  viewerState: { liked: false, bookmarked: false },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
})
export const publicUser = (o: Partial<PublicUserDto> = {}): PublicUserDto => ({
  id: 'u1', username: 'cuka', displayName: 'Cuka', bio: '', avatarUrl: null, bannerUrl: null,
  socialLinks: { x: '', facebook: '', youtube: '', pixiv: '' },
  stats: { followerCount: 3, followingCount: 0, postCount: 1 }, createdAt: '2026-01-01T00:00:00Z', isFollowing: false, ...o,
})
export const comment = (o: Partial<CommentDto> = {}): CommentDto => ({
  id: 'c1', body: 'Đẹp quá', author, parentId: null, status: 'visible', createdAt: '2026-01-02T00:00:00Z', ...o,
})
