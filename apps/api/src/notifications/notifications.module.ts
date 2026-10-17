import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PostsModule } from '../posts/posts.module'
import { UsersModule } from '../users/users.module'
import { NotificationsController } from './notifications.controller'
import { NOTIFICATION_MODEL, NotificationSchema } from './notification.schema'
import { NotificationsService } from './notifications.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: NOTIFICATION_MODEL, schema: NotificationSchema }]), PostsModule, UsersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService, MongooseModule],
})
export class NotificationsModule {}
