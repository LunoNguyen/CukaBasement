import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { createPostSchema, cursorQuerySchema, updatePostSchema } from '@cuka/shared'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import { type CreatePostInput, type CursorQuery, PostsService, type UpdatePostInput } from './posts.service'

@Controller()
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post('posts')
  @Auth({ verified: true, write: true })
  create(@CurrentViewer() v: Viewer, @Body(new ZodPipe(createPostSchema)) body: CreatePostInput) {
    return this.posts.create(v, body)
  }

  @Get('posts/:id')
  get(@CurrentViewer() v: Viewer | null, @Param('id') id: string) {
    return this.posts.get(v, id)
  }

  @Patch('posts/:id')
  @Auth({ verified: true, write: true })
  update(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(updatePostSchema)) body: UpdatePostInput) {
    return this.posts.update(v, id, body)
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @Auth({ write: true })
  async remove(@CurrentViewer() v: Viewer, @Param('id') id: string): Promise<void> {
    await this.posts.remove(v, id)
  }

  @Get('posts/:id/files/:fileId/url')
  fileUrl(@CurrentViewer() v: Viewer | null, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.posts.fileUrl(v, id, fileId)
  }

  @Get('users/:username/posts')
  byUser(@CurrentViewer() v: Viewer | null, @Param('username') username: string, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.posts.listByUser(v, username, q)
  }
}
