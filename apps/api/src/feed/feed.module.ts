import { Module } from '@nestjs/common'
import { InteractionModelsModule } from '../interactions/interaction-models.module'
import { PostsModule } from '../posts/posts.module'
import { FeedController } from './feed.controller'
import { FeedService } from './feed.service'

@Module({
  imports: [PostsModule, InteractionModelsModule],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
