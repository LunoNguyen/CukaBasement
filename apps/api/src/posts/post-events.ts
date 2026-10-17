import { Injectable } from '@nestjs/common'

export interface StaffPostRemoval {
  actorId: string
  postId: string
  authorId: string
}

type Listener = (e: StaffPostRemoval) => Promise<void>

/**
 * In-process hook so the moderation module can log and notify when staff delete a post, without PostsService
 * depending on NotificationsService (that module imports PostsModule).
 */
@Injectable()
export class PostEvents {
  private readonly listeners: Listener[] = []

  onStaffRemoved(listener: Listener): void {
    this.listeners.push(listener)
  }

  async staffRemoved(e: StaffPostRemoval): Promise<void> {
    for (const l of this.listeners) await l(e)
  }
}
