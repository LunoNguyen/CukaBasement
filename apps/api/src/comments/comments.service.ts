import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { createCommentSchema } from '@cuka/shared'
import { type Model, Types } from 'mongoose'
import type { z } from 'zod'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { type Cursor, decodeCursor, pageOf } from '../common/cursor'
import { NotificationsService } from '../notifications/notifications.service'
import { POST_MODEL, type Post } from '../posts/post.schema'
import type { AuthorDto, CursorQuery } from '../posts/posts.service'
import { canViewPost, isStaff } from '../posts/visibility'
import { USER_MODEL, type User } from '../users/user.schema'
import { UsersService } from '../users/users.service'
import { COMMENT_MODEL, type Comment, type CommentStatus } from './comment.schema'

export type CreateCommentInput = z.infer<typeof createCommentSchema>

export interface CommentDto {
  id: string
  body: string
  author: AuthorDto
  parentId: string | null
  status: CommentStatus
  createdAt: string
  replies?: CommentDto[]
}

const isObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id)

const postNotFound = () => new AppError('POST_NOT_FOUND', 404, 'Post not found')
const commentNotFound = () => new AppError('COMMENT_NOT_FOUND', 404, 'Comment not found')

/** Page after `c` in (createdAt asc, _id asc) order: comments read oldest first. */
function ascCursorFilter(c: Cursor) {
  return { $or: [{ createdAt: { $gt: c.createdAt } }, { createdAt: c.createdAt, _id: { $gt: c.id } }] }
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(COMMENT_MODEL) private readonly comments: Model<Comment>,
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    private readonly notifications: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  async list(viewer: Viewer | null, postId: string, q: CursorQuery): Promise<{ items: CommentDto[]; nextCursor: string | null }> {
    const post = await this.viewablePost(viewer, postId)
    const cursor = decodeCursor(q.cursor)
    const top = await this.comments
      .find({ postId: post._id, parentId: null, deletedAt: null, ...(cursor ? ascCursorFilter(cursor) : {}) })
      .sort({ createdAt: 1, _id: 1 })
      .limit(q.limit + 1)
      .lean()
    const page = pageOf(top, q.limit)
    const replies = page.items.length
      ? await this.comments
          .find({ postId: post._id, parentId: { $in: page.items.map((c) => c._id) }, deletedAt: null })
          .sort({ createdAt: 1, _id: 1 })
          .lean()
      : []
    const authors = await this.authorsOf([...page.items, ...replies].map((c) => c.authorId))
    const repliesByParent = new Map<string, CommentDto[]>()
    for (const r of replies) {
      const key = r.parentId!.toString()
      const dto = this.toDto(r, viewer, authors)
      const bucket = repliesByParent.get(key)
      if (bucket) bucket.push(dto)
      else repliesByParent.set(key, [dto])
    }
    const items = page.items.map((c) => ({ ...this.toDto(c, viewer, authors), replies: repliesByParent.get(c._id.toString()) ?? [] }))
    return { items, nextCursor: page.nextCursor }
  }

  async create(viewer: Viewer, postId: string, input: CreateCommentInput): Promise<CommentDto> {
    const post = await this.viewablePost(viewer, postId)
    let parent: Comment | null = null
    if (input.parentId !== undefined) {
      parent = isObjectId(input.parentId) ? await this.comments.findOne({ _id: input.parentId, postId: post._id, deletedAt: null }).lean() : null
      if (!parent) throw commentNotFound()
      if (parent.parentId !== null) throw new AppError('REPLY_DEPTH_EXCEEDED', 400, 'Replies can only be one level deep')
    }
    const created = await this.comments.create({
      postId: post._id,
      authorId: new Types.ObjectId(viewer.id),
      parentId: parent?._id ?? null,
      body: input.body,
    })
    // timestamps: false keeps `updatedAt` for real edits.
    await this.posts.updateOne({ _id: post._id }, { $inc: { 'counts.comments': 1 } }, { timestamps: false })

    // One notification per user: a parent author who is also the post author gets only the 'reply'.
    const base = { actorId: viewer.id, postId: post._id.toString(), commentId: created._id.toString() }
    const parentAuthor = parent?.authorId.toString()
    if (parentAuthor) await this.notifications.notify({ ...base, userId: parentAuthor, type: 'reply' })
    if (post.authorId.toString() !== parentAuthor) await this.notifications.notify({ ...base, userId: post.authorId.toString(), type: 'comment' })

    const authors = await this.authorsOf([created.authorId])
    return this.toDto(created.toObject(), viewer, authors)
  }

  async remove(viewer: Viewer, id: string): Promise<void> {
    const comment = isObjectId(id) ? await this.comments.findOne({ _id: id, deletedAt: null }).lean() : null
    if (!comment) throw commentNotFound()
    if (comment.authorId.toString() !== viewer.id && !isStaff(viewer)) throw new AppError('FORBIDDEN', 403, 'Only the author or staff can delete this comment')
    // deletedAt: null in the filter makes a repeated or racing delete count once.
    const res = await this.comments.updateOne({ _id: comment._id, deletedAt: null }, { $set: { deletedAt: new Date() } })
    if (res.modifiedCount !== 1) throw commentNotFound()
    await this.posts.updateOne({ _id: comment.postId, 'counts.comments': { $gt: 0 } }, { $inc: { 'counts.comments': -1 } }, { timestamps: false })
  }

  private toDto(c: Comment, viewer: Viewer | null, authors: Map<string, AuthorDto>): CommentDto {
    const authorId = c.authorId.toString()
    const concealed = c.status === 'hidden' && !isStaff(viewer) && viewer?.id !== authorId
    return {
      id: c._id.toString(),
      body: concealed ? '' : c.body,
      author: authors.get(authorId)!,
      parentId: c.parentId?.toString() ?? null,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    }
  }

  private async viewablePost(viewer: Viewer | null, id: string): Promise<Post> {
    const post = isObjectId(id) ? await this.posts.findById(id).lean() : null
    if (!post || !canViewPost(viewer, post)) throw postNotFound()
    return post
  }

  /** Author summaries keyed by id; an author missing from `users` gets an empty placeholder. */
  private async authorsOf(ids: Types.ObjectId[]): Promise<Map<string, AuthorDto>> {
    const users = await this.users.find({ _id: { $in: ids } }, { profile: 1 }).lean()
    const out = new Map<string, AuthorDto>()
    for (const id of ids) out.set(id.toString(), { id: id.toString(), username: '', displayName: '', avatarUrl: null })
    for (const u of users) {
      const avatarUrl = u.profile.avatarFileId ? await this.usersService.publicAvatarUrl(u.profile.avatarFileId.toString()) : null
      out.set(u._id.toString(), { id: u._id.toString(), username: u.profile.username, displayName: u.profile.displayName, avatarUrl })
    }
    return out
  }
}
