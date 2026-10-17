import { Module } from '@nestjs/common'
import { ModerationLogModule } from '../moderation/moderation-log.module'
import { UsersModule } from '../users/users.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [UsersModule, ModerationLogModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
