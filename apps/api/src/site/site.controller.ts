import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common'
import { homeRevisionSchema, saveHomeDraftSchema } from '@cuka/shared'
import type { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import { type SaveHomeDraftInput, SiteService } from './site.service'

type RevisionBody = z.infer<typeof homeRevisionSchema>

@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  /** The published homepage (public, cached). */
  @Get('home')
  home() {
    return this.site.publicHome()
  }
}

/** Homepage editing (Quản trị → Trang chủ): admins only, like the other site-wide settings. */
@Controller('admin/site')
@Auth({ roles: ['admin'] })
export class AdminSiteController {
  constructor(private readonly site: SiteService) {}

  @Get('home/draft')
  draft() {
    return this.site.draft()
  }

  @Put('home/draft')
  @Auth({ roles: ['admin'], write: true })
  save(@CurrentViewer() v: Viewer, @Body(new ZodPipe(saveHomeDraftSchema)) body: SaveHomeDraftInput) {
    return this.site.saveDraft(v, body)
  }

  @Post('home/publish')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  publish(@CurrentViewer() v: Viewer, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.publish(v, body.revision)
  }

  @Post('home/discard')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  discard(@CurrentViewer() v: Viewer, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.discard(v, body.revision)
  }

  @Get('images')
  images() {
    return this.site.listImages()
  }

  @Delete('images/:id')
  @HttpCode(204)
  @Auth({ roles: ['admin'], write: true })
  async deleteImage(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    await this.site.deleteImage(v, id)
  }
}
