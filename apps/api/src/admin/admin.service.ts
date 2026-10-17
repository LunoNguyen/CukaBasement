import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { GlobalSettings, ModAction, Role, UserStatus } from '@cuka/shared'
import { type Model, type QueryFilter, Types } from 'mongoose'
import { AUTH_TOKEN_MODEL, type AuthToken } from '../auth/auth-token.schema'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { MODERATION_LOG_MODEL, type ModerationLog } from '../moderation/moderation-log.schema'
import { ModerationLogService } from '../moderation/moderation-log.service'
import { SettingsService } from '../settings/settings.service'
import { USER_MODEL, type User } from '../users/user.schema'

export interface AdminUserDto {
  id: string
  email: string
  username: string
  displayName: string
  role: Role
  status: UserStatus
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
  stats: User['stats']
}

export interface AdminLogDto {
  id: string
  actor: { username: string } | 'system'
  action: ModAction
  targetType: string
  targetId: string
  note: string
  createdAt: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface UserListQuery {
  q?: string
  role?: Role
  status?: UserStatus
  cursor?: string
  limit: number
}

export interface LogListQuery {
  actorId?: string
  action?: ModAction
  cursor?: string
  limit: number
}

const STATUS_ACTION: Record<UserStatus, ModAction> = { banned: 'ban', suspended: 'suspend', active: 'unban' }

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'User not found')
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(AUTH_TOKEN_MODEL) private readonly authTokens: Model<AuthToken>,
    @InjectModel(MODERATION_LOG_MODEL) private readonly logs: Model<ModerationLog>,
    private readonly modLog: ModerationLogService,
    private readonly settings: SettingsService,
  ) {}

  /** Newest first over (createdAt, _id). `q` is a case-insensitive, regex-escaped prefix of email or username. */
  async listUsers(q: UserListQuery): Promise<Page<AdminUserDto>> {
    const filter: QueryFilter<User> = {}
    if (q.role) filter.role = q.role
    if (q.status) filter.status = q.status
    const and: QueryFilter<User>[] = []
    if (q.q) {
      const prefix = new RegExp(`^${escapeRegex(q.q)}`, 'i')
      and.push({ $or: [{ email: prefix }, { 'profile.username': prefix }] })
    }
    const cursor = decodeCursor(q.cursor)
    if (cursor) and.push(cursorFilter(cursor))
    if (and.length) filter.$and = and
    const docs = await this.users.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).lean()
    const page = pageOf(docs, q.limit)
    return { items: page.items.map((u) => this.toDto(u)), nextCursor: page.nextCursor }
  }

  /**
   * Bans (also revoking every refresh token), suspends or reactivates. Same status → no-op without a log.
   * Taking the last active admin out of service is refused.
   */
  async setStatus(actor: Viewer, id: string, status: UserStatus, note?: string): Promise<AdminUserDto> {
    const target = await this.target(actor, id)
    if (target.status === status) return this.toDto(target)
    const undo = await this.applyGuarded(target, { status }, status !== 'active')
    if (status === 'banned') await this.authTokens.deleteMany({ userId: target._id, type: 'refresh' })
    try {
      await this.modLog.log(actor.id, STATUS_ACTION[status], 'user', id, note)
    } catch (e) {
      await undo()
      throw e
    }
    return this.toDto((await this.users.findById(target._id).lean()) ?? target)
  }

  async setRole(actor: Viewer, id: string, role: Role): Promise<AdminUserDto> {
    const target = await this.target(actor, id)
    if (target.role === role) return this.toDto(target)
    const undo = await this.applyGuarded(target, { role }, role !== 'admin')
    try {
      await this.modLog.log(actor.id, 'change_role', 'user', id, `${target.role}→${role}`)
    } catch (e) {
      await undo()
      throw e
    }
    return this.toDto((await this.users.findById(target._id).lean()) ?? target)
  }

  getSettings(): Promise<GlobalSettings> {
    return this.settings.get()
  }

  /** Logs the keys whose value actually changed; nothing changed → no write and no log. */
  async updateSettings(actor: Viewer, patch: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const current = await this.settings.get()
    const changed = (Object.keys(patch) as Array<keyof GlobalSettings>).filter((k) => patch[k] !== undefined && patch[k] !== current[k])
    if (changed.length === 0) return current
    const next = await this.settings.update(Object.fromEntries(changed.map((k) => [k, patch[k]])) as Partial<GlobalSettings>)
    await this.modLog.log(actor.id, 'update_setting', 'settings', 'global', changed.join(', '))
    return next
  }

  async listLogs(q: LogListQuery): Promise<Page<AdminLogDto>> {
    const filter: QueryFilter<ModerationLog> = {}
    if (q.action) filter.action = q.action
    if (q.actorId) filter.actorId = q.actorId === 'system' ? 'system' : new Types.ObjectId(q.actorId)
    const cursor = decodeCursor(q.cursor)
    if (cursor) Object.assign(filter, cursorFilter(cursor))
    const docs = await this.logs.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).lean()
    const page = pageOf(docs, q.limit)
    const actorIds = [...new Set(page.items.flatMap((l) => (l.actorId === 'system' ? [] : [l.actorId.toString()])))]
    const actors = actorIds.length
      ? await this.users.find({ _id: { $in: actorIds.map((s) => new Types.ObjectId(s)) } }, { profile: 1 }).lean()
      : []
    const names = new Map(actors.map((u) => [u._id.toString(), u.profile.username]))
    return {
      items: page.items.map((l) => ({
        id: l._id.toString(),
        actor: l.actorId === 'system' ? 'system' : { username: names.get(l.actorId.toString()) ?? 'unknown' },
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        note: l.note,
        createdAt: l.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    }
  }

  private async target(actor: Viewer, id: string): Promise<User> {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) throw notFound()
    if (id === actor.id) throw new AppError('CANNOT_CHANGE_OWN_ROLE', 400, 'You cannot change your own role or status')
    const user = await this.users.findById(id).lean()
    if (!user) throw notFound()
    return user
  }

  /**
   * Applies `$set` to `target`. When the target is an active admin and the change removes it from service
   * (`leavesService`), another active admin must remain: checked before the write and again after it,
   * with the write reverted if two concurrent changes would otherwise remove the last two admins
   * (in that race both may be refused, which errs on the safe side). Returns a function that reverts the write.
   * "Active admin" = role 'admin' and status 'active'; banned or suspended admins do not count.
   */
  private async applyGuarded(target: User, $set: { status: UserStatus } | { role: Role }, leavesService: boolean): Promise<() => Promise<void>> {
    const guarded = leavesService && target.role === 'admin' && target.status === 'active'
    const others = () => this.users.countDocuments({ role: 'admin', status: 'active', _id: { $ne: target._id } })
    if (guarded && (await others()) === 0) throw new AppError('LAST_ADMIN', 400, 'At least one active admin must remain')
    const before = { status: target.status, role: target.role }
    await this.users.updateOne({ _id: target._id }, { $set })
    const undo = async () => {
      await this.users.updateOne({ _id: target._id }, { $set: before })
    }
    if (guarded && (await this.users.countDocuments({ role: 'admin', status: 'active' })) === 0) {
      await undo()
      throw new AppError('LAST_ADMIN', 400, 'At least one active admin must remain')
    }
    return undo
  }

  private toDto(u: User): AdminUserDto {
    return {
      id: u._id.toString(),
      email: u.email,
      username: u.profile.username,
      displayName: u.profile.displayName,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerifiedAt != null,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      stats: u.stats,
    }
  }
}
