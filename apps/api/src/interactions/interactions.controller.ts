import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { cursorQuerySchema } from '@cuka/shared'
import { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import type { CursorQuery } from '../posts/posts.service'
import { InteractionsService } from './interactions.service'

// Express 5 leaves req.body undefined when no body is sent.
const bookmarkBodySchema = z.object({ isPrivate: z.boolean().default(false) }).default({ isPrivate: false })
type BookmarkBody = z.infer<typeof bookmarkBodySchema>

@Controller()
export class InteractionsController {
  constructor(private readonly interactions: InteractionsService) {}

  @Post('posts/:id/like')
  @HttpCode(200)
  @Auth({ write: true })
  like(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.interactions.like(v, id)
  }

  @Delete('posts/:id/like')
  @Auth({ write: true })
  unlike(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.interactions.unlike(v, id)
  }

  @Post('posts/:id/bookmark')
  @HttpCode(200)
  @Auth({ write: true })
  bookmark(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(bookmarkBodySchema)) body: BookmarkBody) {
    return this.interactions.bookmark(v, id, body.isPrivate)
  }

  @Delete('posts/:id/bookmark')
  @Auth({ write: true })
  unbookmark(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.interactions.unbookmark(v, id)
  }

  @Post('users/:username/follow')
  @HttpCode(200)
  @Auth({ write: true })
  follow(@CurrentViewer() v: Viewer, @Param('username') username: string) {
    return this.interactions.follow(v, username)
  }

  @Delete('users/:username/follow')
  @Auth({ write: true })
  unfollow(@CurrentViewer() v: Viewer, @Param('username') username: string) {
    return this.interactions.unfollow(v, username)
  }

  @Get('users/:username/followers')
  followers(@CurrentViewer() v: Viewer | null, @Param('username') username: string, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.interactions.followers(v, username, q)
  }

  @Get('users/:username/following')
  following(@CurrentViewer() v: Viewer | null, @Param('username') username: string, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.interactions.following(v, username, q)
  }

  @Get('users/:username/bookmarks')
  bookmarks(@CurrentViewer() v: Viewer | null, @Param('username') username: string, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.interactions.listBookmarks(v, username, q)
  }
}
