import type { ReviewStatus, Visibility } from '@cuka/shared'
import { Types, type QueryFilter } from 'mongoose'
import { canSeeR18, type Viewer } from '../auth/viewer'
import type { Post } from './post.schema'

/** `feed`: home, search, tag and following lists. `direct`: the post page and profiles. */
export type PostContext = 'feed' | 'direct'

export function isStaff(viewer: Viewer | null): boolean {
  return viewer?.role === 'moderator' || viewer?.role === 'admin'
}

const DIRECT_REVIEW: ReviewStatus[] = ['pending', 'approved']

/** Spec §5.3. Owners and staff see every non-deleted state of a post in `direct` context only. */
export function visiblePostsFilter(viewer: Viewer | null, context: PostContext): QueryFilter<Post> {
  if (context === 'feed') {
    return {
      'review.status': 'approved',
      visibility: 'public',
      deletedAt: null,
      ...(canSeeR18(viewer) ? {} : { rating: 'all' }),
    }
  }
  if (isStaff(viewer)) return { deletedAt: null }
  const publicDirect = { 'review.status': { $in: DIRECT_REVIEW }, visibility: 'public' as const }
  if (!viewer || !Types.ObjectId.isValid(viewer.id)) return { ...publicDirect, deletedAt: null }
  return { deletedAt: null, $or: [publicDirect, { authorId: new Types.ObjectId(viewer.id) }] }
}

/** The in-memory counterpart of `visiblePostsFilter(viewer, 'direct')`. */
export function canViewPost(
  viewer: Viewer | null,
  post: { authorId: Types.ObjectId; review: { status: ReviewStatus }; visibility: Visibility; deletedAt?: Date | null },
): boolean {
  if (post.deletedAt) return false
  if (isStaff(viewer) || (viewer && post.authorId.toString() === viewer.id)) return true
  return DIRECT_REVIEW.includes(post.review.status) && post.visibility === 'public'
}
