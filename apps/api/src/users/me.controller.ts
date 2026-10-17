import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common'
import { changePasswordSchema, updateProfileSchema, updateSettingsSchema } from '@cuka/shared'
import type { Request } from 'express'
import { Auth, CurrentViewer } from '../auth/decorators'
import { REFRESH_COOKIE } from '../auth/auth.controller'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import { UsersService, type UpdateProfileInput, type UpdateSettingsInput } from './users.service'
import type { z } from 'zod'

@Controller('me')
@Auth()
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentViewer() v: Viewer) {
    return this.users.me(v.id)
  }

  @Patch()
  @Auth({ write: true })
  update(@CurrentViewer() v: Viewer, @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput) {
    return this.users.updateProfile(v.id, body)
  }

  @Patch('settings')
  settings(@CurrentViewer() v: Viewer, @Body(new ZodPipe(updateSettingsSchema)) body: UpdateSettingsInput) {
    return this.users.updateSettings(v.id, body)
  }

  @Post('password')
  @HttpCode(204)
  async password(
    @CurrentViewer() v: Viewer,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: Request,
  ): Promise<void> {
    const rt: unknown = req.cookies?.[REFRESH_COOKIE]
    await this.users.changePassword(v.id, body.currentPassword, body.newPassword, typeof rt === 'string' && rt ? rt : undefined)
  }
}
