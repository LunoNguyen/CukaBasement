import { Module } from '@nestjs/common'
import { ModerationLogModule } from '../moderation/moderation-log.module'
import { UploadsModule } from '../uploads/uploads.module'
import { UsersModule } from '../users/users.module'
import { AdminSiteController, SiteController } from './site.controller'
import { SiteService } from './site.service'

@Module({
  imports: [UploadsModule, UsersModule, ModerationLogModule],
  controllers: [SiteController, AdminSiteController],
  providers: [SiteService],
})
export class SiteModule {}
