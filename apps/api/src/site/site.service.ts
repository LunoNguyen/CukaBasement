import { Inject, Injectable } from '@nestjs/common'
import { getConnectionToken, InjectModel } from '@nestjs/mongoose'
import { EDITABLE_SITE_PAGES, type EditableSitePage, type HomeBanner, homeBannerSchema, homeImageIds, type HomeImage, type HomeSection, homeSectionSchema, homeVideoIds, type saveHomeDraftSchema, SITE_PAGES, type SitePage } from '@cuka/shared'
import { type Connection, type Model, Types } from 'mongoose'
import type { z } from 'zod'
import type { Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { AppError } from '../common/app-error'
import { CONFIG, type Config } from '../config/config'
import { removeFile } from '../jobs/handlers/cleanup-uploads'
import { JOBS, type JobsPort } from '../jobs/jobs.port'
import { ModerationLogService } from '../moderation/moderation-log.service'
import { StorageService } from '../storage/storage.service'
import { FILE_MODEL, type FileDoc } from '../uploads/file.schema'
import { USER_MODEL, type User } from '../users/user.schema'
import { ensureHomepage, ensureSitePages, HOME_COLLECTION, type HomepageDoc } from './home-seed'
import { feedsCol, musicSections, type PageYouTubeDto, resolveYouTube } from './music-store'

export { ensureHomepage }

/** Whether `v` names a CMS page (home, intro). */
export const isSitePage = (v: unknown): v is SitePage => typeof v === 'string' && (SITE_PAGES as readonly string[]).includes(v)

/** Whether `page` may still be edited (only the Introduction page; the old landing page is read-only). */
export const isEditableSitePage = (v: SitePage): v is EditableSitePage => (EDITABLE_SITE_PAGES as readonly string[]).includes(v)

export type SaveHomeDraftInput = z.output<typeof saveHomeDraftSchema>

/** A ready site image: the `thumb_md` render as `src`, every width in `srcset` (versioned by render time). */
export interface SiteImageDto {
  width: number | null
  height: number | null
  src: string
  srcset: string
}

/** A ready site video: its clip in the public bucket (versioned like the images); the poster frame is in `images`. */
export interface SiteVideoDto {
  src: string
  mime: string
  width: number | null
  height: number | null
  durationSec: number | null
}

export interface PublicHomeDto {
  page: SitePage
  /** Visible sections of the published version, in order. */
  sections: HomeSection[]
  /** Images the sections reference, by file id (a video's id maps to its poster frame); a missing id renders the section's decorative fallback. */
  images: Record<string, SiteImageDto>
  /** Background videos by file id; a missing id falls back to the poster, the slideshow or the brand art. */
  videos: Record<string, SiteVideoDto>
  /** What the music sections show: their automatic tabs' video ids and every video's details (see music-store). */
  youtube: PageYouTubeDto
  publishedAt: string
}

/** One automatic music tab's feed, for the admin form's status line. */
export interface MusicFeedStatusDto {
  key: string
  count: number
  fetchedAt: string | null
  attemptAt: string
  error: string | null
  errorAt: string | null
}

export interface MusicStatusDto {
  /** YOUTUBE_API_KEY is set: the newest and popular tabs may be automatic. */
  apiKey: boolean
  feeds: MusicFeedStatusDto[]
}

export interface AdminSiteImageDto {
  id: string
  kind: 'image' | 'video'
  status: FileDoc['status']
  originalName: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  durationSec: number | null
  /** Referenced by the draft or the published version of a page (then it cannot be deleted). */
  used: boolean
  /** The image's renders, or a video's poster frame. */
  image: SiteImageDto | null
  video: SiteVideoDto | null
}

/** The gallery's home banner as visitors get it: its picture resolved (null when it has none or it is not ready). */
export interface HomeBannerDto extends Omit<HomeBanner, 'image'> {
  image: (HomeImage & SiteImageDto) | null
}

export interface HomeDraftDto {
  page: SitePage
  revision: number
  sections: HomeSection[]
  /** The home banner being edited (Introduction page only; null when cleared or on the old landing page). */
  banner: HomeBanner | null
  updatedAt: string
  updatedBy: { username: string } | null
  publishedAt: string
  publishedBy: { username: string } | null
  /** The draft differs from the published version. */
  unpublished: boolean
  images: Record<string, SiteImageDto>
  videos: Record<string, SiteVideoDto>
  youtube: PageYouTubeDto
}

/** Stored sections that still pass the schema (a hand-edited or older document never breaks the page). */
function validSections(list: unknown): HomeSection[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((s) => {
    const r = homeSectionSchema.safeParse(s)
    return r.success ? [r.data] : []
  })
}

const sameSections = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A stored banner that still passes the schema, else null. */
function validBanner(v: unknown): HomeBanner | null {
  const r = homeBannerSchema.safeParse(v)
  return r.success ? r.data : null
}

/** What media checks and lookups walk: the sections plus the banner (as a pseudo-section holding an image). */
function mediaHolders(sections: HomeSection[], banner: HomeBanner | null): Array<{ type: string; data: unknown }> {
  return banner ? [...sections, { type: 'homeBanner', data: banner }] : sections
}

@Injectable()
export class SiteService {
  constructor(
    @Inject(getConnectionToken()) private readonly conn: Connection,
    @InjectModel(FILE_MODEL) private readonly files: Model<FileDoc>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @Inject(CONFIG) private readonly config: Config,
    private readonly storage: StorageService,
    private readonly cache: FeedCache,
    private readonly modLog: ModerationLogService,
    @Inject(JOBS) private readonly jobs: JobsPort,
  ) {}

  private col() {
    return this.conn.collection<HomepageDoc>(HOME_COLLECTION)
  }

  /** The pages were checked (seeded, banner, home → intro move) by this process; see ensureSitePages. */
  private pagesChecked = false

  private async load(page: SitePage): Promise<HomepageDoc> {
    if (!this.pagesChecked) {
      // The first read after an upgrade runs the one-time migration even before `npm run setup` is re-run.
      await ensureSitePages(this.conn)
      this.pagesChecked = true
    }
    let doc = await this.col().findOne({ _id: page })
    if (!doc) {
      await ensureSitePages(this.conn)
      doc = await this.col().findOne({ _id: page })
    }
    return doc!
  }

  /** A published page; cached with the feed cache (fail-open), invalidated by publish. */
  publicPage(page: SitePage): Promise<PublicHomeDto> {
    return this.cache.wrap('site-page', { page, v: 3 }, async () => {
      const doc = await this.load(page)
      const sections = validSections(doc.published.sections).filter((s) => s.visible)
      const media = await this.resolveMedia(homeImageIds(sections))
      return { page, sections, ...media, youtube: await this.youtube(sections), publishedAt: doc.published.publishedAt.toISOString() }
    })
  }

  /** The published home banner (the gallery's top strip); cached like the pages, refreshed by publish. */
  publicBanner(): Promise<{ banner: HomeBannerDto | null }> {
    return this.cache.wrap('site-banner', { v: 1 }, async () => {
      const banner = validBanner((await this.load('intro')).published.banner)
      if (!banner) return { banner: null }
      const { images } = await this.resolveMedia(banner.image ? [banner.image.fileId] : [])
      const img = banner.image && images[banner.image.fileId]
      return { banner: { ...banner, image: img ? { ...banner.image!, ...img } : null } }
    })
  }

  /** Stored YouTube data of the music sections (never fetched on the request path: see the youtube-sync job). */
  private youtube(sections: HomeSection[]): Promise<PageYouTubeDto> {
    return resolveYouTube(this.conn, sections, { apiKey: !!this.config.youtube?.apiKey, publicUrl: (k) => this.storage.publicUrl(k) })
  }

  /** Asks the worker to fetch what the music sections now need (new links, a changed channel or tab). */
  private async syncMusic(sections: HomeSection[], force = false): Promise<void> {
    if (!force && !musicSections(sections).length) return
    await this.jobs.enqueue('youtube-sync', force ? { force: true } : {})
  }

  /** The admin form's status: whether an API key is set and every automatic feed's last fetch. */
  async musicStatus(): Promise<MusicStatusDto> {
    const feeds = await feedsCol(this.conn).find({}).sort({ _id: 1 }).limit(200).toArray()
    return {
      apiKey: !!this.config.youtube?.apiKey,
      feeds: feeds.map((f) => ({
        key: f._id,
        count: f.ids.length,
        fetchedAt: f.fetchedAt?.toISOString() ?? null,
        attemptAt: f.attemptAt.toISOString(),
        error: f.error,
        errorAt: f.errorAt?.toISOString() ?? null,
      })),
    }
  }

  /** "Làm mới ngay": the worker refetches every feed now. */
  async refreshMusic(): Promise<void> {
    await this.syncMusic([], true)
  }

  async draft(page: SitePage): Promise<HomeDraftDto> {
    const doc = await this.load(page)
    const sections = validSections(doc.draft.sections)
    const banner = page === 'intro' ? validBanner(doc.draft.banner) : null
    const ids = [doc.draft.updatedBy, doc.published.publishedBy].filter((x): x is Types.ObjectId => !!x)
    const names = new Map(
      (ids.length ? await this.users.find({ _id: { $in: ids } }, { profile: 1 }).lean() : []).map((u) => [u._id.toString(), u.profile.username]),
    )
    const who = (id: Types.ObjectId | null) => (id && names.has(id.toString()) ? { username: names.get(id.toString())! } : null)
    return {
      page,
      revision: doc.draft.revision,
      sections,
      banner,
      updatedAt: doc.draft.updatedAt.toISOString(),
      updatedBy: who(doc.draft.updatedBy),
      publishedAt: doc.published.publishedAt.toISOString(),
      publishedBy: who(doc.published.publishedBy),
      unpublished: !sameSections(sections, validSections(doc.published.sections)) || (page === 'intro' && !sameSections(banner, validBanner(doc.published.banner))),
      ...(await this.resolveMedia(homeImageIds(mediaHolders(sections, banner)))),
      youtube: await this.youtube(sections),
    }
  }

  async saveDraft(actor: Viewer, page: EditableSitePage, input: SaveHomeDraftInput): Promise<HomeDraftDto> {
    await this.load(page)
    await this.assertMedia(mediaHolders(input.sections, input.banner ?? null), ['processing', 'ready'])
    // A body without `banner` keeps the stored one.
    const banner = input.banner === undefined ? {} : { 'draft.banner': input.banner }
    const res = await this.col().updateOne(
      { _id: page, 'draft.revision': input.revision },
      {
        $set: { 'draft.sections': input.sections, ...banner, 'draft.updatedAt': new Date(), 'draft.updatedBy': new Types.ObjectId(actor.id) },
        $inc: { 'draft.revision': 1 },
      },
    )
    if (res.matchedCount === 0) await this.conflict(page)
    await this.syncMusic(input.sections)
    return this.draft(page)
  }

  /** Publishes the draft the admin was looking at (`revision`); every image and video must be ready by then. */
  async publish(actor: Viewer, page: EditableSitePage, revision: number): Promise<HomeDraftDto> {
    const doc = await this.load(page)
    if (doc.draft.revision !== revision) await this.conflict(page)
    const sections = validSections(doc.draft.sections)
    const banner = validBanner(doc.draft.banner)
    await this.assertMedia(mediaHolders(sections, banner), ['ready'])
    const res = await this.col().updateOne(
      { _id: page, 'draft.revision': revision },
      { $set: { published: { sections, banner, publishedAt: new Date(), publishedBy: new Types.ObjectId(actor.id) } } },
    )
    if (res.matchedCount === 0) await this.conflict(page)
    await this.modLog.log(actor.id, 'homepage_publish', 'site', page, `${sections.length} sections`)
    await this.cache.bump()
    await this.syncMusic(sections)
    return this.draft(page)
  }

  /** Resets the draft to the published version. */
  async discard(actor: Viewer, page: EditableSitePage, revision: number): Promise<HomeDraftDto> {
    const doc = await this.load(page)
    const res = await this.col().updateOne(
      { _id: page, 'draft.revision': revision },
      {
        $set: { 'draft.sections': doc.published.sections, 'draft.banner': doc.published.banner ?? null, 'draft.updatedAt': new Date(), 'draft.updatedBy': new Types.ObjectId(actor.id) },
        $inc: { 'draft.revision': 1 },
      },
    )
    if (res.matchedCount === 0) await this.conflict(page)
    await this.modLog.log(actor.id, 'homepage_discard', 'site', page)
    return this.draft(page)
  }

  /** The admin's site media library (images and videos), newest first (abandoned uploads excluded). */
  async listImages(): Promise<AdminSiteImageDto[]> {
    const [docs, used] = await Promise.all([
      this.files.find({ purpose: 'site', status: { $in: ['processing', 'ready', 'failed'] } }).sort({ createdAt: -1, _id: -1 }).limit(300).lean(),
      this.usedIds(),
    ])
    return docs.map((f) => ({
      id: f._id.toString(),
      kind: f.kind === 'video' ? 'video' : 'image',
      status: f.status,
      originalName: f.originalName,
      sizeBytes: f.sizeBytes,
      width: f.width,
      height: f.height,
      createdAt: f.createdAt.toISOString(),
      durationSec: f.durationSec ?? null,
      used: used.has(f._id.toString()),
      image: this.imageOf(f),
      video: this.videoOf(f),
    }))
  }

  /** Deletes a site image nobody uses (409 SITE_IMAGE_IN_USE while the draft or published page references it). */
  async deleteImage(actor: Viewer, id: string): Promise<void> {
    const file = Types.ObjectId.isValid(id) ? await this.files.findOne({ _id: id, purpose: 'site' }).lean() : null
    if (!file) throw new AppError('NOT_FOUND', 404, 'Image not found')
    if ((await this.usedIds()).has(id)) throw new AppError('SITE_IMAGE_IN_USE', 409, 'A site page still uses this file')
    await removeFile({ conn: this.conn, storage: this.storage, config: this.config }, file)
    await this.modLog.log(actor.id, 'site_image_delete', 'site', id, file.originalName)
  }

  /** Ids referenced by the draft or published version of any page. */
  private async usedIds(): Promise<Set<string>> {
    const docs = await this.col().find({}).toArray()
    return new Set(
      homeImageIds(docs.flatMap((d) => [...mediaHolders(d.draft?.sections ?? [], d.draft?.banner ?? null), ...mediaHolders(d.published?.sections ?? [], d.published?.banner ?? null)])),
    )
  }

  private async conflict(page: SitePage): Promise<never> {
    const doc = await this.col().findOne({ _id: page }, { projection: { 'draft.revision': 1 } })
    throw new AppError('REVISION_CONFLICT', 409, 'The draft was changed by someone else; reload it', { revision: doc?.draft.revision ?? null })
  }

  /**
   * Every referenced id must be a site upload in one of `statuses`: a background video slot holds a video, every
   * other slot an image; else 400 SITE_IMAGE_INVALID. A video counts as ready only once its clip is published.
   */
  private async assertMedia(sections: ReadonlyArray<{ type: string; data: unknown }>, statuses: Array<FileDoc['status']>): Promise<void> {
    const ids = homeImageIds(sections)
    if (!ids.length) return
    const videos = new Set(homeVideoIds(sections))
    const found = await this.files.find({ _id: { $in: ids }, purpose: 'site', status: { $in: statuses } }, { _id: 1, kind: 1, status: 1, variants: 1 }).lean()
    const ok = new Set(
      found
        .filter((f) => {
          const id = f._id.toString()
          if (videos.has(id)) return f.kind === 'video' && (f.status !== 'ready' || f.variants.some((v) => v.name === 'video'))
          return f.kind === 'image'
        })
        .map((f) => f._id.toString()),
    )
    const bad = ids.filter((id) => !ok.has(id))
    if (bad.length) {
      const why = statuses.includes('processing') ? 'is not a site image or video for this slot' : 'is not a ready site image or video for this slot'
      throw new AppError('SITE_IMAGE_INVALID', 400, `File ${bad[0]} ${why}`, { fileIds: bad })
    }
  }

  private async resolveMedia(ids: string[]): Promise<{ images: Record<string, SiteImageDto>; videos: Record<string, SiteVideoDto> }> {
    const images: Record<string, SiteImageDto> = {}
    const videos: Record<string, SiteVideoDto> = {}
    if (!ids.length) return { images, videos }
    const docs = await this.files.find({ _id: { $in: ids }, purpose: 'site', status: 'ready' }).lean()
    for (const f of docs) {
      const img = this.imageOf(f)
      if (img) images[f._id.toString()] = img
      const video = this.videoOf(f)
      if (video) videos[f._id.toString()] = video
    }
    return { images, videos }
  }

  private version(f: FileDoc): string {
    return f.variantsAt ? `?v=${f.variantsAt.getTime()}` : ''
  }

  /** The published clip of a ready site video; null for images and until the worker has copied it. */
  private videoOf(f: FileDoc): SiteVideoDto | null {
    if (f.status !== 'ready' || f.kind !== 'video') return null
    const clip = f.variants.find((x) => x.name === 'video' && x.bucket === this.config.minio.bucketPublic)
    if (!clip) return null
    return { src: `${this.storage.publicUrl(clip.objectKey)}${this.version(f)}`, mime: f.mimeType, width: f.width, height: f.height, durationSec: f.durationSec ?? null }
  }

  /** Public URLs of a ready site image's renders (a video's poster frame); null until the worker has published them. */
  private imageOf(f: FileDoc): SiteImageDto | null {
    if (f.status !== 'ready') return null
    const v = this.version(f)
    const url = (key: string) => `${this.storage.publicUrl(key)}${v}`
    const renders = f.variants
      .filter((x) => x.bucket === this.config.minio.bucketPublic && ['thumb_sm', 'thumb_md', 'large'].includes(x.name) && x.width)
      .sort((a, b) => a.width! - b.width!)
    if (!renders.length) return null
    const byWidth = new Map(renders.map((r) => [r.width!, r]))
    const md = renders.find((r) => r.name === 'thumb_md') ?? renders[renders.length - 1]!
    return {
      width: f.width,
      height: f.height,
      src: url(md.objectKey),
      srcset: [...byWidth.entries()].map(([w, r]) => `${url(r.objectKey)} ${w}w`).join(', '),
    }
  }
}
