import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { emailOnlySchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema } from '@cuka/shared'
import type { CookieOptions, Request, Response } from 'express'
import type { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { CONFIG, type Config } from '../config/config'
import { Auth, CurrentViewer } from './decorators'
import { AuthService, REFRESH_TTL_MS, type RegisterInput, type Session } from './auth.service'
import type { Viewer } from './viewer'

export const REFRESH_COOKIE = 'cuka_rt'

/** Login attempts are counted per IP and email together. */
function loginTracker(req: Record<string, any>): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  return `${req.ip}|${email}`
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.config.nodeEnv === 'production', path: '/api/auth' }
  }

  private session(res: Response, s: Session) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, { ...this.cookieOptions(), maxAge: REFRESH_TTL_MS })
    return { accessToken: s.accessToken, user: s.user }
  }

  @Post('register')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body)
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, getTracker: loginTracker } })
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.session(res, await this.auth.login(body.email, body.password))
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.session(res, await this.auth.refresh(refreshCookieOf(req)))
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(refreshCookieOf(req))
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions())
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>): Promise<void> {
    await this.auth.verifyEmail(body.token)
  }

  @Post('resend-verification')
  @HttpCode(204)
  @Auth()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  async resendVerification(@CurrentViewer() viewer: Viewer): Promise<void> {
    await this.auth.resendVerification(viewer.id)
  }

  @Post('forgot-password')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  async forgotPassword(@Body(new ZodPipe(emailOnlySchema)) body: z.infer<typeof emailOnlySchema>): Promise<void> {
    await this.auth.forgotPassword(body.email)
  }

  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>): Promise<void> {
    await this.auth.resetPassword(body.token, body.password)
  }
}

function refreshCookieOf(req: Request): string | undefined {
  const v: unknown = req.cookies?.[REFRESH_COOKIE]
  return typeof v === 'string' && v ? v : undefined
}
