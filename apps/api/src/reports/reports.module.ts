import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ModerationLogModule } from '../moderation/moderation-log.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PostsModule } from '../posts/posts.module'
import { SettingsModule } from '../settings/settings.module'
import { REPORT_MODEL, ReportSchema } from './report.schema'
import { ReportsController } from './reports.controller'
import { ReportsService } from './reports.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: REPORT_MODEL, schema: ReportSchema }]), PostsModule, SettingsModule, NotificationsModule, ModerationLogModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService, MongooseModule],
})
export class ReportsModule {}
