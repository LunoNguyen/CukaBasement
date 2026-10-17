import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { adminRoleSchema, adminSettingsSchema, adminStatusSchema, cursorQuerySchema, MOD_ACTIONS, ROLES, USER_STATUSES } from '@cuka/shared'
import { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { ZodPipe } from '../common/zod.pipe'
import { AdminService, type LogListQuery, type UserListQuery } from './admin.service'

const usersQuerySchema = cursorQuerySchema.extend({
  q: z.string().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
})

/** `actorId` is 'system' or a 24-hex user id. */
const logsQuerySchema = cursorQuerySchema.extend({
  actorId: z.string().regex(/^(system|[0-9a-fA-F]{24})$/, 'actorId must be "system" or a user id').optional(),
  action: z.enum(MOD_ACTIONS).optional(),
})

@Controller('admin')
@Auth({ roles: ['admin'] })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(@Query(new ZodPipe(usersQuerySchema)) q: UserListQuery) {
    return this.admin.listUsers(q)
  }

  @Post('users/:id/status')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  status(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(adminStatusSchema)) body: z.infer<typeof adminStatusSchema>) {
    return this.admin.setStatus(this.viewer(v), id, body.status, body.note)
  }

  @Post('users/:id/role')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  role(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(adminRoleSchema)) body: z.infer<typeof adminRoleSchema>) {
    return this.admin.setRole(this.viewer(v), id, body.role)
  }

  @Get('settings')
  settings() {
    return this.admin.getSettings()
  }

  @Patch('settings')
  @Auth({ roles: ['admin'], write: true })
  updateSettings(@CurrentViewer() v: Viewer, @Body(new ZodPipe(adminSettingsSchema)) body: z.infer<typeof adminSettingsSchema>) {
    return this.admin.updateSettings(this.viewer(v), body)
  }

  @Get('logs')
  logs(@Query(new ZodPipe(logsQuerySchema)) q: LogListQuery) {
    return this.admin.listLogs(q)
  }

  private viewer(v: Viewer | null): Viewer {
    if (!v) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required')
    return v
  }
}
