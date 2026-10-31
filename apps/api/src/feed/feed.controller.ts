import { Controller, Get, Query } from '@nestjs/common'
import { feedQuerySchema, HOME_LIMITS, rankingQuerySchema, searchQuerySchema } from '@cuka/shared'
import { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import { type FeedQuery, FeedService, type RankingQuery, type SearchQuery } from './feed.service'

const showcaseQuerySchema = z.object({ limit: z.coerce.number().int().min(HOME_LIMITS.fanartMin).max(HOME_LIMITS.fanartMax).default(8) })

@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('feed/home')
  home(@CurrentViewer() v: Viewer | null, @Query(new ZodPipe(feedQuerySchema)) q: FeedQuery) {
    return this.feed.home(v, q)
  }

  /** The homepage fanart strip: newest approved all-ages posts (see FeedService.showcase). */
  @Get('feed/showcase')
  showcase(@Query(new ZodPipe(showcaseQuerySchema)) q: z.infer<typeof showcaseQuerySchema>) {
    return this.feed.showcase(q.limit)
  }

  /** The fanart ranking: most liked and bookmarked posts of the last day, week or month (see FeedService.ranking). */
  @Get('feed/ranking')
  ranking(@CurrentViewer() v: Viewer | null, @Query(new ZodPipe(rankingQuerySchema)) q: RankingQuery) {
    return this.feed.ranking(v, q)
  }

  @Auth()
  @Get('feed/following')
  following(@CurrentViewer() v: Viewer, @Query(new ZodPipe(feedQuerySchema)) q: FeedQuery) {
    return this.feed.following(v, q)
  }

  @Get('search')
  search(@CurrentViewer() v: Viewer | null, @Query(new ZodPipe(searchQuerySchema)) q: SearchQuery) {
    return this.feed.search(v, q)
  }
}
