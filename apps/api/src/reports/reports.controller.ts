import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { createReportSchema } from '@cuka/shared'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import { type CreateReportInput, ReportsService } from './reports.service'

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('posts/:id/report')
  @Auth({ verified: true, write: true })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  create(@CurrentViewer() v: Viewer, @Param('id') id: string, @Body(new ZodPipe(createReportSchema)) body: CreateReportInput) {
    return this.reports.create(v, id, body)
  }
}
