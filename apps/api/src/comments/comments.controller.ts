import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { createCommentSchema, cursorQuerySchema } from '@cuka/shared'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import type { CursorQuery } from '../posts/posts.service'
import { type CreateCommentInput, CommentsService } from './comments.service'

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('posts/:id/comments')
  list(@CurrentViewer() v: Viewer | null, @Param('id') id: string, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.comments.list(v, id, q)
  }

  @Post('posts/:id/comments')
  @Auth({ verified: true, write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(createCommentSchema)) body: CreateCommentInput) {
    return this.comments.create(v, id, body)
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @Auth({ write: true })
  async remove(@CurrentViewer() v: Viewer, @Param('id') id: string): Promise<void> {
    await this.comments.remove(v, id)
  }
}
