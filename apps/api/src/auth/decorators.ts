import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Role } from '@cuka/shared'
import type { Viewer } from './viewer'

export interface AuthOptions {
  /** Require a verified email. */
  verified?: boolean
  /** Allowed roles; any role when omitted. */
  roles?: Role[]
  /** The route writes content: suspended users are refused. */
  write?: boolean
}

export const AUTH_KEY = 'cuka:auth'

/** Requires an authenticated viewer; checked by the global AuthGuard. */
export const Auth = (opts: AuthOptions = {}) => SetMetadata(AUTH_KEY, opts)

/** Request property where AuthGuard stores the viewer. */
export interface ViewerRequest {
  viewer?: Viewer | null
}

export const CurrentViewer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Viewer | null => ctx.switchToHttp().getRequest<ViewerRequest>().viewer ?? null,
)
