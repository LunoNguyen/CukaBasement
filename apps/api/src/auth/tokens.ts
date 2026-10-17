import { createHash, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ROLES, type Role } from '@cuka/shared'

/** 32 random bytes, base64url (43 chars). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

/** sha256 hex — what the database stores for every opaque token. */
export function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex')
}

export interface AccessClaims {
  sub: string
  role: Role
}

/** Access JWTs (HS256, 15 min, signed with `jwt.accessSecret` via JwtModule in AuthModule). */
@Injectable()
export class TokensService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(user: { _id: { toString(): string }; role: Role }): string {
    return this.jwt.sign({ sub: user._id.toString(), role: user.role })
  }

  verifyAccess(token: string): AccessClaims | null {
    try {
      const p: unknown = this.jwt.verify(token, { algorithms: ['HS256'] })
      if (typeof p !== 'object' || p === null) return null
      const { sub, role } = p as { sub?: unknown; role?: unknown }
      if (typeof sub !== 'string' || !ROLES.includes(role as Role)) return null
      return { sub, role: role as Role }
    } catch {
      return null
    }
  }
}
