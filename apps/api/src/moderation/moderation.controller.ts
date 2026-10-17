import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { type Credit, creditSchema, cursorQuerySchema, rejectSchema, resolveReportsSchema } from '@cuka/shared'
import { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import type { CursorQuery } from '../posts/posts.service'
import { ModerationService, type QueueQuery } from './moderation.service'

const queueQuerySchema = cursorQuerySchema.extend({ status: z.enum(['pending', 'rejected']).default('pending') })
// `.default({})`: Express 5 leaves `req.body` undefined when no body is sent, and the note is optional.
const hideSchema = z.object({ note: z.string().max(500).optional() }).default({})
const hiddenCommentsQuerySchema = cursorQuerySchema.extend({ status: z.literal('hidden') })

/** Every moderation write refuses suspended staff (spec §5.2: suspended is read-only). */
const MOD_WRITE = Auth({ roles: ['moderator', 'admin'], write: true })

@Controller('mod')
@Auth({ roles: ['moderator', 'admin'] })
export class ModerationController {
  constructor(private readonly mod: ModerationService) {}

  @Get('queue')
  queue(@CurrentViewer() v: Viewer, @Query(new ZodPipe(queueQuerySchema)) q: QueueQuery) {
    return this.mod.queue(v, q)
  }

  @MOD_WRITE
  @Post('posts/:id/approve')
  @HttpCode(200)
  approve(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.approve(v, id)
  }

  @MOD_WRITE
  @Post('posts/:id/reject')
  @HttpCode(200)
  reject(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.mod.reject(v, id, body.reason)
  }

  @MOD_WRITE
  @Post('posts/:id/hide')
  @HttpCode(200)
  hide(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(hideSchema)) body: z.infer<typeof hideSchema>) {
    return this.mod.hide(v, id, body.note)
  }

  @MOD_WRITE
  @Post('posts/:id/restore')
  @HttpCode(200)
  restore(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.restore(v, id)
  }

  @MOD_WRITE
  @Patch('posts/:id/credit')
  updateCredit(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(creditSchema)) body: Credit) {
    return this.mod.updateCredit(v, id, body)
  }

  /** `cursor` is accepted but unused: the top `limit` groups are returned (resolved groups drop out). */
  @Get('reports')
  reports(@CurrentViewer() v: Viewer, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.mod.reportQueue(v, q.limit)
  }

  @MOD_WRITE
  @Post('reports/posts/:postId/resolve')
  @HttpCode(200)
  resolve(
    @CurrentViewer() v: Viewer,
    @Param('postId') postId: string,
    @Body(new ZodPipe(resolveReportsSchema)) body: z.infer<typeof resolveReportsSchema>,
  ) {
    return this.mod.resolve(v, postId, body.decision, body.note)
  }

  @MOD_WRITE
  @Post('comments/:id/hide')
  @HttpCode(200)
  hideComment(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.hideComment(v, id)
  }

  @MOD_WRITE
  @Post('comments/:id/restore')
  @HttpCode(200)
  restoreComment(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.mod.restoreComment(v, id)
  }

  @Get('comments')
  hiddenComments(@Query(new ZodPipe(hiddenCommentsQuerySchema)) q: CursorQuery) {
    return this.mod.hiddenComments(q)
  }
}
