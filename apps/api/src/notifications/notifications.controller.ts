import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { cursorQuerySchema } from '@cuka/shared'
import { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import type { CursorQuery } from '../posts/posts.service'
import { NotificationsService } from './notifications.service'

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/)

const markReadSchema = z
  .object({ ids: z.array(objectIdString).max(100).optional(), all: z.boolean().optional() })
  .refine((v) => v.all === true || (v.ids !== undefined && v.ids.length > 0), { message: 'Provide ids or all' })

type MarkReadInput = z.infer<typeof markReadSchema>

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Auth()
  list(@CurrentViewer() v: Viewer, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.notifications.list(v.id, q)
  }

  @Get('unread-count')
  @Auth()
  unreadCount(@CurrentViewer() v: Viewer) {
    return this.notifications.unreadCount(v.id)
  }

  @Post('read')
  @HttpCode(204)
  @Auth()
  async read(@CurrentViewer() v: Viewer, @Body(new ZodPipe(markReadSchema)) body: MarkReadInput): Promise<void> {
    await this.notifications.markRead(v.id, body)
  }
}
