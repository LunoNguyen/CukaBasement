import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { InjectModel } from '@nestjs/mongoose'
import { type Model, Types } from 'mongoose'
import { MAINTENANCE_OPEN_PATHS, MaintenanceService } from '../backup/maintenance.service'
import { AppError } from '../common/app-error'
import { USER_MODEL, type User } from '../users/user.schema'
import { AUTH_KEY, type AuthOptions, type ViewerRequest } from './decorators'
import { TokensService } from './tokens'
import { isAdult, type Viewer } from './viewer'

/**
 * Global guard: resolves `req.viewer` from the bearer token (fresh from the DB on every request)
 * and enforces `@Auth()` and maintenance mode. A bad token on a route without `@Auth()` just means anonymous.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    private readonly maintenance: MaintenanceService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true
    const req = ctx.switchToHttp().getRequest<ViewerRequest & { headers: Record<string, unknown>; path: string }>()
    const viewer = await this.resolve(req.headers.authorization)
    req.viewer = viewer
    // During a restore only admins (and sign-in / health) get through.
    if (viewer?.role !== 'admin' && !MAINTENANCE_OPEN_PATHS.test(req.path) && (await this.maintenance.active())) {
      throw new AppError('MAINTENANCE', 503, 'The site is being restored from a backup')
    }

    const opts = this.reflector.getAllAndOverride<AuthOptions | undefined>(AUTH_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!opts) return true
    if (!viewer) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required')
    if (opts.verified && !viewer.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 403, 'Email is not verified')
    if (opts.write && viewer.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403, 'Account is suspended')
    if (opts.roles && !opts.roles.includes(viewer.role)) throw new AppError('FORBIDDEN', 403, 'Forbidden')
    return true
  }

  private async resolve(header: unknown): Promise<Viewer | null> {
    if (typeof header !== 'string') return null
    const m = /^Bearer\s+(\S+)$/i.exec(header)
    const claims = m?.[1] ? this.tokens.verifyAccess(m[1]) : null
    if (!claims || !Types.ObjectId.isValid(claims.sub)) return null
    const user = await this.users
      .findById(claims.sub, { role: 1, status: 1, emailVerifiedAt: 1, birthDate: 1, showR18: 1 })
      .lean()
    if (!user || user.status === 'banned') return null
    return {
      id: user._id.toString(),
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt != null,
      isAdult: isAdult(user.birthDate),
      showR18: user.showR18,
    }
  }
}
