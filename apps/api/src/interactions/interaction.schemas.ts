import { Schema, Types } from 'mongoose'

export interface Like {
  _id: Types.ObjectId
  userId: Types.ObjectId
  postId: Types.ObjectId
  createdAt: Date
}

export interface Bookmark {
  _id: Types.ObjectId
  userId: Types.ObjectId
  postId: Types.ObjectId
  isPrivate: boolean
  createdAt: Date
}

export interface Follow {
  _id: Types.ObjectId
  followerId: Types.ObjectId
  followeeId: Types.ObjectId
  createdAt: Date
}

export const LIKE_MODEL = 'Like'
export const BOOKMARK_MODEL = 'Bookmark'
export const FOLLOW_MODEL = 'Follow'

const ref = { type: Schema.Types.ObjectId, required: true }
const createdOnly = { createdAt: true, updatedAt: false }

export const LikeSchema = new Schema<Like>(
  { userId: ref, postId: ref },
  { collection: 'likes', timestamps: createdOnly },
)
LikeSchema.index({ userId: 1, postId: 1 }, { unique: true })

export const BookmarkSchema = new Schema<Bookmark>(
  { userId: ref, postId: ref, isPrivate: { type: Boolean, default: false } },
  { collection: 'bookmarks', timestamps: createdOnly },
)
BookmarkSchema.index({ userId: 1, postId: 1 }, { unique: true })
BookmarkSchema.index({ userId: 1, createdAt: -1 })

export const FollowSchema = new Schema<Follow>(
  { followerId: ref, followeeId: ref },
  { collection: 'follows', timestamps: createdOnly },
)
FollowSchema.index({ followerId: 1, followeeId: 1 }, { unique: true })
FollowSchema.index({ followeeId: 1 })
