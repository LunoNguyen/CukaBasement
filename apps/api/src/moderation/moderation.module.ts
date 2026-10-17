import { Module } from '@nestjs/common'
import { CommentsModule } from '../comments/comments.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PostsModule } from '../posts/posts.module'
import { ReportsModule } from '../reports/reports.module'
import { UsersModule } from '../users/users.module'
import { ModerationController } from './moderation.controller'
import { ModerationLogModule } from './moderation-log.module'
import { ModerationService } from './moderation.service'

@Module({
  imports: [PostsModule, ReportsModule, NotificationsModule, ModerationLogModule, UsersModule, CommentsModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
