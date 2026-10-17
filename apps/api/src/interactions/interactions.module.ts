import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { PostsModule } from '../posts/posts.module'
import { UsersModule } from '../users/users.module'
import { InteractionModelsModule } from './interaction-models.module'
import { InteractionsController } from './interactions.controller'
import { InteractionsService } from './interactions.service'

@Module({
  imports: [InteractionModelsModule, NotificationsModule, PostsModule, UsersModule],
  controllers: [InteractionsController],
  providers: [InteractionsService],
})
export class InteractionsModule {}
