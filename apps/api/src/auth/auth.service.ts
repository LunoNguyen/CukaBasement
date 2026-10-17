import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { z } from 'zod'
import type { registerSchema } from '@cuka/shared'
import * as argon2 from 'argon2'
import type { Model, Types } from 'mongoose'
import { AppError } from '../common/app-error'
import { CONFIG, type Config } from '../config/config'
import { MAIL, type MailPort } from '../mail/mail.port'
import { USER_MODEL, type User } from '../users/user.schema'
import { type MeDto, UsersService } from '../users/users.service'
import { AUTH_TOKEN_MODEL, type AuthToken } from './auth-token.schema'
import { hashToken, randomToken, TokensService } from './tokens'

const HOUR = 3600_000
const VERIFY_TTL_MS = 24 * HOUR
const RESET_TTL_MS = HOUR
export const REFRESH_TTL_MS = 30 * 24 * HOUR

export type RegisterInput = z.infer<typeof registerSchema>

export interface Session {
  accessToken: string
  refreshToken: string
  user: MeDto
}

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

/** Keys of a Mongo duplicate-key error, e.g. `['email']`; null for any other error. */
function duplicateKeys(e: unknown): string[] | null {
  if (typeof e !== 'object' || e === null || (e as { code?: unknown }).code !== 11000) return null
  return Object.keys((e as { keyPattern?: object }).keyPattern ?? {})
}

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so both login failures cost one argon2 verify. */
  private dummyHash?: Promise<string>

  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(AUTH_TOKEN_MODEL) private readonly tokens: Model<AuthToken>,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MAIL) private readonly mail: MailPort,
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
  ) {}

  async register(input: RegisterInput): Promise<{ userId: string }> {
    const passwordHash = await hashPassword(input.password)
    let user
    try {
      user = await this.users.create({
        email: input.email,
        passwordHash,
        profile: { username: input.username, displayName: input.displayName },
      })
    } catch (e) {
      const keys = duplicateKeys(e)
      if (keys?.includes('email')) throw new AppError('EMAIL_TAKEN', 409, 'Email is already registered')
      if (keys?.includes('profile.username')) throw new AppError('USERNAME_TAKEN', 409, 'Username is already taken')
      throw e
    }
    await this.sendVerification(user)
    return { userId: user._id.toString() }
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.users.findOne({ email: email.trim().toLowerCase() })
    const hash = user?.passwordHash ?? (await (this.dummyHash ??= hashPassword(randomToken())))
    const ok = await argon2.verify(hash, password).catch(() => false)
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password')
    if (user.status === 'banned') throw new AppError('ACCOUNT_BANNED', 403, 'Account is banned')
    user.lastLoginAt = new Date()
    await user.save()
    const refreshToken = await this.issueRefresh(user._id, randomUUID())
    return { accessToken: this.tokensService.signAccess(user), refreshToken, user: this.usersService.toMe(user) }
  }

  /** Rotates a refresh token; presenting an already-rotated one revokes every session of its user. */
  async refresh(raw: string | undefined): Promise<Session> {
    if (!raw) throw invalidToken()
    const tokenHash = hashToken(raw)
    const now = new Date()
    // Claim the token atomically so two concurrent uses cannot both succeed.
    const claimed = await this.tokens.findOneAndUpdate(
      { tokenHash, type: 'refresh', usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    )
    if (!claimed) {
      const reused = await this.tokens.findOne({ tokenHash, type: 'refresh', usedAt: { $ne: null } })
      if (reused) await this.tokens.deleteMany({ userId: reused.userId, type: 'refresh' })
      throw invalidToken()
    }
    const user = await this.users.findById(claimed.userId)
    if (!user || user.status === 'banned') {
      await this.tokens.deleteMany({ userId: claimed.userId, type: 'refresh' })
      throw invalidToken()
    }
    const refreshToken = await this.issueRefresh(user._id, claimed.familyId ?? randomUUID())
    return { accessToken: this.tokensService.signAccess(user), refreshToken, user: this.usersService.toMe(user) }
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.tokens.deleteOne({ tokenHash: hashToken(raw), type: 'refresh' })
  }

  async verifyEmail(raw: string): Promise<void> {
    const token = await this.claim(raw, 'verify_email')
    await this.users.updateOne({ _id: token.userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } })
  }

  /** Sends a fresh verification link unless the user is already verified. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId)
    if (user && user.emailVerifiedAt == null) await this.sendVerification(user)
  }

  /** Sends a reset link when the email belongs to a user; silent otherwise. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findOne({ email: email.trim().toLowerCase() })
    if (!user) return
    const raw = await this.issueToken(user._id, 'reset_password', RESET_TTL_MS)
    const link = `${this.config.appUrl}/reset-password?token=${raw}`
    await this.mail.send({
      to: user.email,
      subject: 'Đặt lại mật khẩu CukaBasement / Reset your CukaBasement password',
      text: `Mở liên kết sau để đặt lại mật khẩu (hết hạn sau 1 giờ):\nOpen this link to reset your password (expires in 1 hour):\n\n${link}\n`,
    })
  }

  /** Sets a new password and signs the user out everywhere. */
  async resetPassword(raw: string, password: string): Promise<void> {
    const token = await this.claim(raw, 'reset_password')
    await this.users.updateOne({ _id: token.userId }, { $set: { passwordHash: await hashPassword(password) } })
    await this.tokens.deleteMany({ userId: token.userId, type: 'refresh' })
  }

  /** Marks a single-use token as used atomically; unknown, used or expired → 400 TOKEN_INVALID. */
  private async claim(raw: string, type: 'verify_email' | 'reset_password'): Promise<AuthToken> {
    const now = new Date()
    const token = await this.tokens.findOneAndUpdate(
      { tokenHash: hashToken(raw), type, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    )
    if (!token) throw new AppError('TOKEN_INVALID', 400, 'Invalid or expired token')
    return token
  }

  private async issueToken(userId: Types.ObjectId, type: 'verify_email' | 'reset_password', ttlMs: number) {
    const raw = randomToken()
    await this.tokens.create({ userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) })
    return raw
  }

  private async issueRefresh(userId: Types.ObjectId, familyId: string): Promise<string> {
    const raw = randomToken()
    await this.tokens.create({
      userId,
      type: 'refresh',
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      familyId,
    })
    return raw
  }

  private async sendVerification(user: User): Promise<void> {
    const raw = await this.issueToken(user._id, 'verify_email', VERIFY_TTL_MS)
    const link = `${this.config.appUrl}/verify-email?token=${raw}`
    await this.mail.send({
      to: user.email,
      subject: 'Xác thực email CukaBasement / Verify your CukaBasement email',
      text: `Mở liên kết sau để xác thực email (hết hạn sau 24 giờ):\nOpen this link to verify your email (expires in 24 hours):\n\n${link}\n`,
    })
  }
}

function invalidToken(): AppError {
  return new AppError('TOKEN_INVALID', 401, 'Invalid or expired refresh token')
}
