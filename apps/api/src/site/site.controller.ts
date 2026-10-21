import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common'
import { homeRevisionSchema, saveHomeDraftSchema, type SitePage } from '@cuka/shared'
import type { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { ZodPipe } from '../common/zod.pipe'
import { isSitePage, type SaveHomeDraftInput, SiteService } from './site.service'

type RevisionBody = z.infer<typeof homeRevisionSchema>

/** `:page` of the page routes: home or intro; anything else is a 404 like an unknown path. */
function pageOf(v: string): SitePage {
  if (!isSitePage(v)) throw new AppError('NOT_FOUND', 404, 'No such page')
  return v
}

@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  /** The published homepage (public, cached); same as GET pages/home. */
  @Get('home')
  home() {
    return this.site.publicPage('home')
  }

  /** A published page: `home` (the landing page) or `intro` (the Introduction page). */
  @Get('pages/:page')
  page(@Param('page') page: string) {
    return this.site.publicPage(pageOf(page))
  }
}

/**
 * Page editing (Quản trị → Trang chủ): admins only, like the other site-wide settings. `home/…` is kept as the
 * homepage's original address; `pages/:page/…` edits either page.
 */
@Controller('admin/site')
@Auth({ roles: ['admin'] })
export class AdminSiteController {
  constructor(private readonly site: SiteService) {}

  @Get('home/draft')
  draft() {
    return this.site.draft('home')
  }

  @Put('home/draft')
  @Auth({ roles: ['admin'], write: true })
  save(@CurrentViewer() v: Viewer, @Body(new ZodPipe(saveHomeDraftSchema)) body: SaveHomeDraftInput) {
    return this.site.saveDraft(v, 'home', body)
  }

  @Post('home/publish')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  publish(@CurrentViewer() v: Viewer, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.publish(v, 'home', body.revision)
  }

  @Post('home/discard')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  discard(@CurrentViewer() v: Viewer, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.discard(v, 'home', body.revision)
  }

  @Get('pages/:page/draft')
  pageDraft(@Param('page') page: string) {
    return this.site.draft(pageOf(page))
  }

  @Put('pages/:page/draft')
  @Auth({ roles: ['admin'], write: true })
  pageSave(@CurrentViewer() v: Viewer, @Param('page') page: string, @Body(new ZodPipe(saveHomeDraftSchema)) body: SaveHomeDraftInput) {
    return this.site.saveDraft(v, pageOf(page), body)
  }

  @Post('pages/:page/publish')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  pagePublish(@CurrentViewer() v: Viewer, @Param('page') page: string, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.publish(v, pageOf(page), body.revision)
  }

  @Post('pages/:page/discard')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  pageDiscard(@CurrentViewer() v: Viewer, @Param('page') page: string, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.discard(v, pageOf(page), body.revision)
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
