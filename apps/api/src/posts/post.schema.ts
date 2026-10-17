import { POST_TYPES, type PostType, RATINGS, type Rating, REVIEW_STATUSES, type ReviewStatus, VISIBILITIES, type Visibility } from '@cuka/shared'
import { type HydratedDocument, Schema, Types } from 'mongoose'

export interface PostFile {
  fileId: Types.ObjectId
  position: number
  isCover: boolean
}

export interface Post {
  _id: Types.ObjectId
  authorId: Types.ObjectId
  type: PostType
  title: string
  description: string
  rating: Rating
  visibility: Visibility
  review: { status: ReviewStatus; reason: string | null; by: Types.ObjectId | null; at: Date | null }
  aiDeclaration: true
  sourceCredit: string
  files: PostFile[]
  tags: string[]
  counts: { likes: number; bookmarks: number; comments: number; views: number }
  reportCounts: { total: number; ai_art: number }
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export type PostDocument = HydratedDocument<Post>

export const POST_MODEL = 'Post'

const count = { type: Number, default: 0 }

const postFileSchema = new Schema<PostFile>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    position: { type: Number, required: true },
    isCover: { type: Boolean, required: true },
  },
  { _id: false },
)

export const PostSchema = new Schema<Post>(
  {
    authorId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: POST_TYPES, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    rating: { type: String, enum: RATINGS, required: true },
    visibility: { type: String, enum: VISIBILITIES, default: 'public' },
    review: {
      status: { type: String, enum: REVIEW_STATUSES, default: 'pending' },
      reason: { type: String, default: null },
      by: { type: Schema.Types.ObjectId, default: null },
      at: { type: Date, default: null },
    },
    aiDeclaration: { type: Boolean, required: true },
    sourceCredit: { type: String, default: '' },
    files: { type: [postFileSchema], default: [] },
    tags: { type: [String], default: [] },
    counts: { likes: count, bookmarks: count, comments: count, views: count },
    reportCounts: { total: count, ai_art: count },
    deletedAt: { type: Date, default: null },
  },
  { collection: 'posts', timestamps: true },
)

PostSchema.index({ 'review.status': 1, visibility: 1, rating: 1, createdAt: -1 })
PostSchema.index({ tags: 1, createdAt: -1 })
PostSchema.index({ authorId: 1, createdAt: -1 })
PostSchema.index({ title: 'text', description: 'text', tags: 'text' }, { weights: { title: 5, tags: 3, description: 1 } })
// A file belongs to at most one post (deleted ones included): its variants live in the bucket of that post's rating.
PostSchema.index({ 'files.fileId': 1 }, { unique: true })
