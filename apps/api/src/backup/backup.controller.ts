import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { type BackupSchedule, backupNameSchema, backupScheduleSchema, restoreBackupSchema } from '@cuka/shared'
import type { Request, Response } from 'express'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { ZodPipe } from '../common/zod.pipe'
import { BackupService } from './backup.service'

const nameOf = (raw: string): string => {
  const r = backupNameSchema.safeParse(raw)
  if (!r.success) throw new AppError('BACKUP_INVALID', 400, 'Invalid backup name')
  return r.data
}

const actorOf = (v: Viewer | null): Viewer => {
  if (!v) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required')
  return v
}

/** Admin only (not moderators). Every mutating route is rate limited. */
@Controller('admin/backups')
@Auth({ roles: ['admin'] })
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  overview() {
    return this.backups.overview()
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.backups.run(id)
  }

  @Post()
  @HttpCode(202)
  @Auth({ roles: ['admin'], write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentViewer() v: Viewer | null) {
    return this.backups.startBackup(actorOf(v))
  }

  @Post('upload')
  @HttpCode(201)
  @Auth({ roles: ['admin'], write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  upload(@CurrentViewer() v: Viewer | null, @Req() req: Request) {
    if (!/^application\/octet-stream\b/i.test(req.headers['content-type'] ?? '')) {
      throw new AppError('VALIDATION_FAILED', 415, 'Send the archive as application/octet-stream')
    }
    return this.backups.upload(actorOf(v), req)
  }

  @Put('schedule')
  @Auth({ roles: ['admin'], write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  schedule(@CurrentViewer() v: Viewer | null, @Body(new ZodPipe(backupScheduleSchema)) body: BackupSchedule) {
    return this.backups.updateSchedule(actorOf(v), body)
  }

  @Post(':name/restore')
  @HttpCode(202)
  @Auth({ roles: ['admin'], write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  restore(@CurrentViewer() v: Viewer | null, @Param('name') name: string, @Body(new ZodPipe(restoreBackupSchema)) _body: unknown) {
    return this.backups.startRestore(actorOf(v), nameOf(name))
  }

  @Post(':name/download')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  downloadLink(@CurrentViewer() v: Viewer | null, @Param('name') name: string) {
    return this.backups.downloadToken(actorOf(v), nameOf(name))
  }

  @Delete(':name')
  @HttpCode(204)
  @Auth({ roles: ['admin'], write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async remove(@CurrentViewer() v: Viewer | null, @Param('name') name: string) {
    await this.backups.remove(actorOf(v), nameOf(name))
  }
}

/**
 * The one-time link from `POST /admin/backups/:name/download`. No bearer token: the browser navigates here
 * (so a multi-GB file streams to disk instead of into memory); the single-use, 60-second token is the credential.
 */
@Controller('admin/backups/download')
export class BackupDownloadController {
  constructor(private readonly backups: BackupService) {}

  @Get(':token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(@Param('token') token: string, @Res() res: Response) {
    await this.backups.download(token, res)
  }
}
