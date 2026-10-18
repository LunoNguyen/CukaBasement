import { Global, Module } from '@nestjs/common'
import { FeedCache } from './feed-cache.service'

/** Global so moderation, posts, users, admin and the worker can invalidate the list cache without imports. */
@Global()
@Module({
  providers: [FeedCache],
  exports: [FeedCache],
})
export class CacheModule {}
