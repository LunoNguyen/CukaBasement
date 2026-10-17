import type { Role } from '@cuka/shared'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'

/**
 * Spec §5.2: a moderator may not act on content or accounts of another moderator or an admin; admins may.
 * Dependency-free so posts and comments can apply it without importing the moderation module.
 */
export function assertCanModerate(actor: Viewer, targetUserRole: Role): void {
  if (actor.role !== 'admin' && targetUserRole !== 'user') {
    throw new AppError('CANNOT_MODERATE_PEER', 403, 'Moderators cannot act on staff content')
  }
}
