import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { ModAction } from '@cuka/shared'
import { type Model, Types } from 'mongoose'
import { MODERATION_LOG_MODEL, type ModerationLog, type ModTargetType } from './moderation-log.schema'

@Injectable()
export class ModerationLogService {
  constructor(@InjectModel(MODERATION_LOG_MODEL) private readonly logs: Model<ModerationLog>) {}

  async log(actorId: string | 'system', action: ModAction, targetType: ModTargetType, targetId: string, note?: string): Promise<void> {
    await this.logs.create({
      actorId: actorId === 'system' ? 'system' : new Types.ObjectId(actorId),
      action,
      targetType,
      targetId,
      note: note ?? '',
    })
  }
}
