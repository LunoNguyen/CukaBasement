import { Inject, Injectable } from '@nestjs/common'
import { getConnectionToken, InjectModel } from '@nestjs/mongoose'
import { type HomeSection, homeImageIds, homeSectionSchema, type saveHomeDraftSchema } from '@cuka/shared'
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
import { ensureHomepage, HOME_COLLECTION, HOME_ID, type HomepageDoc } from './home-seed'

export { ensureHomepage }

export type SaveHomeDraftInput = z.output<typeof saveHomeDraftSchema>

/** A ready site image: the `thumb_md` render as `src`, every width in `srcset` (versioned by render time). */
export interface SiteImageDto {
  width: number | null
  height: number | null
  src: string
  srcset: string
}

export interface PublicHomeDto {
  /** Visible sections of the published version, in order. */
  sections: HomeSection[]
  /** Images the sections reference, by file id; a missing id renders the section's decorative fallback. */
  images: Record<string, SiteImageDto>
  publishedAt: string
}

export interface AdminSiteImageDto {
  id: string
  status: FileDoc['status']
  originalName: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  /** Referenced by the draft or the published homepage (then it cannot be deleted). */
  used: boolean
  image: SiteImageDto | null
}

export interface HomeDraftDto {
  revision: number
  sections: HomeSection[]
  updatedAt: string
  updatedBy: { username: string } | null
  publishedAt: string
  publishedBy: { username: string } | null
  /** The draft differs from the published version. */
  unpublished: boolean
  images: Record<string, SiteImageDto>
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

  private async load(): Promise<HomepageDoc> {
    let doc = await this.col().findOne({ _id: HOME_ID })
    if (!doc) {
      await ensureHomepage(this.conn)
      doc = await this.col().findOne({ _id: HOME_ID })
    }
    return doc!
  }

  /** The published homepage; cached with the feed cache (fail-open), invalidated by publish. */
  publicHome(): Promise<PublicHomeDto> {
    return this.cache.wrap('site-home', { v: 1 }, async () => {
      const doc = await this.load()
      const sections = validSections(doc.published.sections).filter((s) => s.visible)
      return { sections, images: await this.resolveImages(homeImageIds(sections)), publishedAt: doc.published.publishedAt.toISOString() }
    })
  }

  async draft(): Promise<HomeDraftDto> {
    const doc = await this.load()
    const sections = validSections(doc.draft.sections)
    const ids = [doc.draft.updatedBy, doc.published.publishedBy].filter((x): x is Types.ObjectId => !!x)
    const names = new Map(
      (ids.length ? await this.users.find({ _id: { $in: ids } }, { profile: 1 }).lean() : []).map((u) => [u._id.toString(), u.profile.username]),
    )
    const who = (id: Types.ObjectId | null) => (id && names.has(id.toString()) ? { username: names.get(id.toString())! } : null)
    return {
      revision: doc.draft.revision,
      sections,
      updatedAt: doc.draft.updatedAt.toISOString(),
      updatedBy: who(doc.draft.updatedBy),
      publishedAt: doc.published.publishedAt.toISOString(),
      publishedBy: who(doc.published.publishedBy),
      unpublished: !sameSections(sections, validSections(doc.published.sections)),
      images: await this.resolveImages(homeImageIds(sections)),
    }
  }

  async saveDraft(actor: Viewer, input: SaveHomeDraftInput): Promise<HomeDraftDto> {
    await this.load()
    await this.assertImages(homeImageIds(input.sections), ['processing', 'ready'])
    const res = await this.col().updateOne(
      { _id: HOME_ID, 'draft.revision': input.revision },
      {
        $set: { 'draft.sections': input.sections, 'draft.updatedAt': new Date(), 'draft.updatedBy': new Types.ObjectId(actor.id) },
        $inc: { 'draft.revision': 1 },
      },
    )
    if (res.matchedCount === 0) await this.conflict()
    return this.draft()
  }

  /** Publishes the draft the admin was looking at (`revision`); every image must be ready by then. */
  async publish(actor: Viewer, revision: number): Promise<HomeDraftDto> {
    const doc = await this.load()
    if (doc.draft.revision !== revision) await this.conflict()
    const sections = validSections(doc.draft.sections)
    await this.assertImages(homeImageIds(sections), ['ready'])
    const res = await this.col().updateOne(
      { _id: HOME_ID, 'draft.revision': revision },
      { $set: { published: { sections, publishedAt: new Date(), publishedBy: new Types.ObjectId(actor.id) } } },
    )
    if (res.matchedCount === 0) await this.conflict()
    await this.modLog.log(actor.id, 'homepage_publish', 'site', HOME_ID, `${sections.length} sections`)
    await this.cache.bump()
    return this.draft()
  }

  /** Resets the draft to the published version. */
  async discard(actor: Viewer, revision: number): Promise<HomeDraftDto> {
    const doc = await this.load()
    const res = await this.col().updateOne(
      { _id: HOME_ID, 'draft.revision': revision },
      {
        $set: { 'draft.sections': doc.published.sections, 'draft.updatedAt': new Date(), 'draft.updatedBy': new Types.ObjectId(actor.id) },
        $inc: { 'draft.revision': 1 },
      },
    )
    if (res.matchedCount === 0) await this.conflict()
    await this.modLog.log(actor.id, 'homepage_discard', 'site', HOME_ID)
    return this.draft()
  }

  /** The admin's site image library, newest first (abandoned uploads excluded). */
  async listImages(): Promise<AdminSiteImageDto[]> {
    const [docs, used] = await Promise.all([
      this.files.find({ purpose: 'site', status: { $in: ['processing', 'ready', 'failed'] } }).sort({ createdAt: -1, _id: -1 }).limit(300).lean(),
      this.usedIds(),
    ])
    return docs.map((f) => ({
      id: f._id.toString(),
      status: f.status,
      originalName: f.originalName,
      sizeBytes: f.sizeBytes,
      width: f.width,
      height: f.height,
      createdAt: f.createdAt.toISOString(),
      used: used.has(f._id.toString()),
      image: this.imageOf(f),
    }))
  }

  /** Deletes a site image nobody uses (409 SITE_IMAGE_IN_USE while the draft or published page references it). */
  async deleteImage(actor: Viewer, id: string): Promise<void> {
    const file = Types.ObjectId.isValid(id) ? await this.files.findOne({ _id: id, purpose: 'site' }).lean() : null
    if (!file) throw new AppError('NOT_FOUND', 404, 'Image not found')
    if ((await this.usedIds()).has(id)) throw new AppError('SITE_IMAGE_IN_USE', 409, 'The homepage still uses this image')
    await removeFile({ conn: this.conn, storage: this.storage, config: this.config }, file)
    await this.modLog.log(actor.id, 'site_image_delete', 'site', id, file.originalName)
  }

  private async usedIds(): Promise<Set<string>> {
    const doc = await this.col().findOne({ _id: HOME_ID })
    return new Set(homeImageIds([...(doc?.draft.sections ?? []), ...(doc?.published.sections ?? [])]))
  }

  private async conflict(): Promise<never> {
    const doc = await this.col().findOne({ _id: HOME_ID }, { projection: { 'draft.revision': 1 } })
    throw new AppError('REVISION_CONFLICT', 409, 'The draft was changed by someone else; reload it', { revision: doc?.draft.revision ?? null })
  }

  /** Every id must be an existing image uploaded as a site image, in one of `statuses`; else 400 SITE_IMAGE_INVALID. */
  private async assertImages(ids: string[], statuses: Array<FileDoc['status']>): Promise<void> {
    if (!ids.length) return
    const found = await this.files.find({ _id: { $in: ids }, purpose: 'site', kind: 'image', status: { $in: statuses } }, { _id: 1 }).lean()
    const ok = new Set(found.map((f) => f._id.toString()))
    const bad = ids.filter((id) => !ok.has(id))
    if (bad.length) {
      const why = statuses.includes('processing') ? 'is not a site image' : 'is not a ready site image'
      throw new AppError('SITE_IMAGE_INVALID', 400, `Image ${bad[0]} ${why}`, { fileIds: bad })
    }
  }

  private async resolveImages(ids: string[]): Promise<Record<string, SiteImageDto>> {
    if (!ids.length) return {}
    const docs = await this.files.find({ _id: { $in: ids }, purpose: 'site', status: 'ready' }).lean()
    const out: Record<string, SiteImageDto> = {}
    for (const f of docs) {
      const img = this.imageOf(f)
      if (img) out[f._id.toString()] = img
    }
    return out
  }

  /** Public URLs of a ready site image's renders; null until the worker has published them. */
  private imageOf(f: FileDoc): SiteImageDto | null {
    if (f.status !== 'ready') return null
    const v = f.variantsAt ? `?v=${f.variantsAt.getTime()}` : ''
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
