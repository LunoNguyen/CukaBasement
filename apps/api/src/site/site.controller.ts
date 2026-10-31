import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { type EditableSitePage, homeRevisionSchema, saveHomeDraftSchema, type SitePage } from '@cuka/shared'
import type { z } from 'zod'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { ZodPipe } from '../common/zod.pipe'
import { isEditableSitePage, isSitePage, type SaveHomeDraftInput, SiteService } from './site.service'

type RevisionBody = z.infer<typeof homeRevisionSchema>

/** `:page` of the page routes: home or intro; anything else is a 404 like an unknown path. */
function pageOf(v: string): SitePage {
  if (!isSitePage(v)) throw new AppError('NOT_FOUND', 404, 'No such page')
  return v
}

/** `:page` of the write routes: only the Introduction page; the old landing page (`home`) is read-only (400). */
function editablePageOf(v: string): EditableSitePage {
  const page = pageOf(v)
  if (!isEditableSitePage(page)) throw new AppError('VALIDATION_FAILED', 400, 'The old landing page is read-only; edit the Introduction page')
  return page
}

@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  /** The published homepage (public, cached); same as GET pages/home. */
  @Get('home')
  home() {
    return this.site.publicPage('home')
  }

  /** The fanart gallery's home banner (published version; null when the admin cleared it). */
  @Get('banner')
  banner() {
    return this.site.publicBanner()
  }

  /** A published page: `home` (the old landing page, read-only) or `intro` (the Introduction page). */
  @Get('pages/:page')
  page(@Param('page') page: string) {
    return this.site.publicPage(pageOf(page))
  }
}

/**
 * Page editing (Quản trị → Trang chủ): admins only, like the other site-wide settings. Only the Introduction page
 * (`pages/intro/…`) takes writes; `home/…` and `pages/home/…` still read the old landing page and refuse writes.
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
    return this.site.saveDraft(v, editablePageOf('home'), body)
  }

  @Post('home/publish')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  publish(@CurrentViewer() v: Viewer, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.publish(v, editablePageOf('home'), body.revision)
  }

  @Post('home/discard')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  discard(@CurrentViewer() v: Viewer, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.discard(v, editablePageOf('home'), body.revision)
  }

  @Get('pages/:page/draft')
  pageDraft(@Param('page') page: string) {
    return this.site.draft(pageOf(page))
  }

  @Put('pages/:page/draft')
  @Auth({ roles: ['admin'], write: true })
  pageSave(@CurrentViewer() v: Viewer, @Param('page') page: string, @Body(new ZodPipe(saveHomeDraftSchema)) body: SaveHomeDraftInput) {
    return this.site.saveDraft(v, editablePageOf(page), body)
  }

  @Post('pages/:page/publish')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  pagePublish(@CurrentViewer() v: Viewer, @Param('page') page: string, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.publish(v, editablePageOf(page), body.revision)
  }

  @Post('pages/:page/discard')
  @HttpCode(200)
  @Auth({ roles: ['admin'], write: true })
  pageDiscard(@CurrentViewer() v: Viewer, @Param('page') page: string, @Body(new ZodPipe(homeRevisionSchema)) body: RevisionBody) {
    return this.site.discard(v, editablePageOf(page), body.revision)
  }

  /** The music section's automatic feeds: last fetch, count and error, and whether an API key is set. */
  @Get('music')
  musicStatus() {
    return this.site.musicStatus()
  }

  /** "Làm mới ngay": queues a refetch of every YouTube feed (the worker does it; a few per minute at most). */
  @Post('music/refresh')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Auth({ roles: ['admin'], write: true })
  async refreshMusic() {
    await this.site.refreshMusic()
    return { queued: true }
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
