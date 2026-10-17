import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { NOTIFICATION_MODEL, NotificationSchema } from './notification.schema'
import { NotificationsService } from './notifications.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: NOTIFICATION_MODEL, schema: NotificationSchema }])],
  providers: [NotificationsService],
  exports: [NotificationsService, MongooseModule],
})
export class NotificationsModule {}
