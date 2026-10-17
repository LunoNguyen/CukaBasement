import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { cursorQuerySchema, rejectSchema, resolveReportsSchema } from '@cuka/shared'
import { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import type { CursorQuery } from '../posts/posts.service'
import { ModerationService, type QueueQuery } from './moderation.service'

const queueQuerySchema = cursorQuerySchema.extend({ status: z.enum(['pending', 'rejected']).default('pending') })
const hideSchema = z.object({ note: z.string().max(500).optional() })

@Controller('mod')
@Auth({ roles: ['moderator', 'admin'] })
export class ModerationController {
  constructor(private readonly mod: ModerationService) {}

  @Get('queue')
  queue(@CurrentViewer() v: Viewer, @Query(new ZodPipe(queueQuerySchema)) q: QueueQuery) {
    return this.mod.queue(v, q)
  }

  @Post('posts/:id/approve')
  @HttpCode(200)
  approve(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.approve(v, id)
  }

  @Post('posts/:id/reject')
  @HttpCode(200)
  reject(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.mod.reject(v, id, body.reason)
  }

  @Post('posts/:id/hide')
  @HttpCode(200)
  hide(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(hideSchema)) body: z.infer<typeof hideSchema>) {
    return this.mod.hide(v, id, body.note)
  }

  @Post('posts/:id/restore')
  @HttpCode(200)
  restore(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.restore(v, id)
  }

  /** `cursor` is accepted but unused: the top `limit` groups are returned (resolved groups drop out). */
  @Get('reports')
  reports(@CurrentViewer() v: Viewer, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.mod.reportQueue(v, q.limit)
  }

  @Post('reports/posts/:postId/resolve')
  @HttpCode(200)
  resolve(
    @CurrentViewer() v: Viewer,
    @Param('postId') postId: string,
    @Body(new ZodPipe(resolveReportsSchema)) body: z.infer<typeof resolveReportsSchema>,
  ) {
    return this.mod.resolve(v, postId, body.decision, body.note)
  }

  @Post('comments/:id/hide')
  @HttpCode(200)
  hideComment(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.hideComment(v, id)
  }
}
