import { Module } from '@nestjs/common'
import { ModerationLogModule } from '../moderation/moderation-log.module'
import { BackupController, BackupDownloadController } from './backup.controller'
import { BackupService } from './backup.service'

@Module({
  imports: [ModerationLogModule],
  // The download controller first: its `download/:token` must not be shadowed by `:name` routes.
  controllers: [BackupDownloadController, BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
