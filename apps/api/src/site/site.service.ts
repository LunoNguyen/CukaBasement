import { Inject, Injectable } from '@nestjs/common'
import { getConnectionToken, InjectModel } from '@nestjs/mongoose'
import { type HomeSection, homeImageIds, homeSectionSchema, homeVideoIds, type saveHomeDraftSchema, SITE_PAGES, type SitePage } from '@cuka/shared'
import { type Connection, type Model, Types } from 'mongoose'
import type { z } from 'zod'
import type { Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { AppError } from '../common/app-error'
import { CONFIG, type Config } from '../config/config'
import { removeFile } from '../jobs/handlers/cleanup-uploads'
import { ModerationLogService } from '../moderation/moderation-log.service'
import { StorageService } from '../storage/storage.service'
import { FILE_MODEL, type FileDoc } from '../uploads/file.schema'
import { USER_MODEL, type User } from '../users/user.schema'
import { ensureHomepage, ensureSitePages, HOME_COLLECTION, type HomepageDoc } from './home-seed'

export { ensureHomepage }

/** Whether `v` names a CMS page (home, intro). */
export const isSitePage = (v: unknown): v is SitePage => typeof v === 'string' && (SITE_PAGES as readonly string[]).includes(v)

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
  publishedAt: string
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

export interface HomeDraftDto {
  page: SitePage
  revision: number
  sections: HomeSection[]
  updatedAt: string
  updatedBy: { username: string } | null
  publishedAt: string
  publishedBy: { username: string } | null
  /** The draft differs from the published version. */
  unpublished: boolean
  images: Record<string, SiteImageDto>
  videos: Record<string, SiteVideoDto>
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
  ) {}

  private col() {
    return this.conn.collection<HomepageDoc>(HOME_COLLECTION)
  }

  private async load(page: SitePage): Promise<HomepageDoc> {
    let doc = await this.col().findOne({ _id: page })
    if (!doc) {
      await ensureSitePages(this.conn)
      doc = await this.col().findOne({ _id: page })
    }
    return doc!
  }

  /** A published page; cached with the feed cache (fail-open), invalidated by publish. */
  publicPage(page: SitePage): Promise<PublicHomeDto> {
    return this.cache.wrap('site-page', { page, v: 2 }, async () => {
      const doc = await this.load(page)
      const sections = validSections(doc.published.sections).filter((s) => s.visible)
      const media = await this.resolveMedia(homeImageIds(sections))
      return { page, sections, ...media, publishedAt: doc.published.publishedAt.toISOString() }
    })
  }

  async draft(page: SitePage): Promise<HomeDraftDto> {
    const doc = await this.load(page)
    const sections = validSections(doc.draft.sections)
    const ids = [doc.draft.updatedBy, doc.published.publishedBy].filter((x): x is Types.ObjectId => !!x)
    const names = new Map(
      (ids.length ? await this.users.find({ _id: { $in: ids } }, { profile: 1 }).lean() : []).map((u) => [u._id.toString(), u.profile.username]),
    )
    const who = (id: Types.ObjectId | null) => (id && names.has(id.toString()) ? { username: names.get(id.toString())! } : null)
    return {
      page,
      revision: doc.draft.revision,
      sections,
      updatedAt: doc.draft.updatedAt.toISOString(),
      updatedBy: who(doc.draft.updatedBy),
      publishedAt: doc.published.publishedAt.toISOString(),
      publishedBy: who(doc.published.publishedBy),
      unpublished: !sameSections(sections, validSections(doc.published.sections)),
      ...(await this.resolveMedia(homeImageIds(sections))),
    }
  }

  async saveDraft(actor: Viewer, page: SitePage, input: SaveHomeDraftInput): Promise<HomeDraftDto> {
    await this.load(page)
    await this.assertMedia(input.sections, ['processing', 'ready'])
    const res = await this.col().updateOne(
      { _id: page, 'draft.revision': input.revision },
      {
        $set: { 'draft.sections': input.sections, 'draft.updatedAt': new Date(), 'draft.updatedBy': new Types.ObjectId(actor.id) },
        $inc: { 'draft.revision': 1 },
      },
    )
    if (res.matchedCount === 0) await this.conflict(page)
    return this.draft(page)
  }

  /** Publishes the draft the admin was looking at (`revision`); every image and video must be ready by then. */
  async publish(actor: Viewer, page: SitePage, revision: number): Promise<HomeDraftDto> {
    const doc = await this.load(page)
    if (doc.draft.revision !== revision) await this.conflict(page)
    const sections = validSections(doc.draft.sections)
    await this.assertMedia(sections, ['ready'])
    const res = await this.col().updateOne(
      { _id: page, 'draft.revision': revision },
      { $set: { published: { sections, publishedAt: new Date(), publishedBy: new Types.ObjectId(actor.id) } } },
    )
    if (res.matchedCount === 0) await this.conflict(page)
    await this.modLog.log(actor.id, 'homepage_publish', 'site', page, `${sections.length} sections`)
    await this.cache.bump()
    return this.draft(page)
  }

  /** Resets the draft to the published version. */
  async discard(actor: Viewer, page: SitePage, revision: number): Promise<HomeDraftDto> {
    const doc = await this.load(page)
    const res = await this.col().updateOne(
      { _id: page, 'draft.revision': revision },
      {
        $set: { 'draft.sections': doc.published.sections, 'draft.updatedAt': new Date(), 'draft.updatedBy': new Types.ObjectId(actor.id) },
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
    return new Set(homeImageIds(docs.flatMap((d) => [...(d.draft?.sections ?? []), ...(d.published?.sections ?? [])])))
  }

  private async conflict(page: SitePage): Promise<never> {
    const doc = await this.col().findOne({ _id: page }, { projection: { 'draft.revision': 1 } })
    throw new AppError('REVISION_CONFLICT', 409, 'The draft was changed by someone else; reload it', { revision: doc?.draft.revision ?? null })
  }

  /**
   * Every referenced id must be a site upload in one of `statuses`: a background video slot holds a video, every
   * other slot an image; else 400 SITE_IMAGE_INVALID. A video counts as ready only once its clip is published.
   */
  private async assertMedia(sections: HomeSection[], statuses: Array<FileDoc['status']>): Promise<void> {
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
