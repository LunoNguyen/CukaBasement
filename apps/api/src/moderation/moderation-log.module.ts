import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { MODERATION_LOG_MODEL, ModerationLogSchema } from './moderation-log.schema'
import { ModerationLogService } from './moderation-log.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: MODERATION_LOG_MODEL, schema: ModerationLogSchema }])],
  providers: [ModerationLogService],
  exports: [ModerationLogService, MongooseModule],
})
export class ModerationLogModule {}
