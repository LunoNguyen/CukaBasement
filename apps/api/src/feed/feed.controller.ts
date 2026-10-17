import { Controller, Get, Query } from '@nestjs/common'
import { cursorQuerySchema, searchQuerySchema } from '@cuka/shared'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import type { CursorQuery } from '../posts/posts.service'
import { FeedService, type SearchQuery } from './feed.service'

@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('feed/home')
  home(@CurrentViewer() v: Viewer | null, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.feed.home(v, q)
  }

  @Auth()
  @Get('feed/following')
  following(@CurrentViewer() v: Viewer, @Query(new ZodPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.feed.following(v, q)
  }

  @Get('search')
  search(@CurrentViewer() v: Viewer | null, @Query(new ZodPipe(searchQuerySchema)) q: SearchQuery) {
    return this.feed.search(v, q)
  }
}
