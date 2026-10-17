import { type HydratedDocument, Schema, Types } from 'mongoose'

export type CommentStatus = 'visible' | 'hidden'

export interface Comment {
  _id: Types.ObjectId
  postId: Types.ObjectId
  authorId: Types.ObjectId
  parentId: Types.ObjectId | null
  body: string
  status: CommentStatus
  createdAt: Date
  deletedAt: Date | null
}

export type CommentDocument = HydratedDocument<Comment>

export const COMMENT_MODEL = 'Comment'

export const CommentSchema = new Schema<Comment>(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    parentId: { type: Schema.Types.ObjectId, default: null },
    body: { type: String, required: true },
    status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
    deletedAt: { type: Date, default: null },
  },
  { collection: 'comments', timestamps: { createdAt: true, updatedAt: false } },
)

CommentSchema.index({ postId: 1, createdAt: 1 })
