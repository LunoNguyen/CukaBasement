import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { normalizeTag } from '@cuka/shared'
import type { Model } from 'mongoose'
import { TAG_MODEL, type Tag } from './tag.schema'

/** Normalized, deduped tags of `raw` (invalid ones dropped), each with the first raw spelling for display. */
export function normalizeTags(raw: string[]): Array<{ tag: string; display: string }> {
  const out = new Map<string, string>()
  for (const r of raw) {
    const tag = normalizeTag(r)
    if (tag && !out.has(tag)) out.set(tag, r.replace(/^#+/, '').trim())
  }
  return [...out].map(([tag, display]) => ({ tag, display }))
}

export const FEATURED_TAGS = ['ducaart', 'hibikiduca', 'wearecuka'] as const
const FEATURED_DISPLAY: Record<(typeof FEATURED_TAGS)[number], string> = {
  ducaart: 'DuCaArt',
  hibikiduca: 'HibikiDuCa',
  wearecuka: 'WeAreCuka',
}

export interface TagDto {
  name: string
  display: string
  postCount: number
}

@Injectable()
export class TagsService {
  constructor(@InjectModel(TAG_MODEL) private readonly tags: Model<Tag>) {}

  /** `+1 postCount` for each added tag (created with its display text on first use), `-1` for each removed one. */
  async applyDelta(added: string[], removed: string[]): Promise<void> {
    for (const { tag, display } of normalizeTags(added)) {
      await this.tags.updateOne({ _id: tag }, { $inc: { postCount: 1 }, $setOnInsert: { display } }, { upsert: true })
    }
    for (const { tag } of normalizeTags(removed)) {
      await this.tags.updateOne({ _id: tag }, { $inc: { postCount: -1 } })
    }
  }

  /** Top 10 tags starting with the normalized `q`, most used first. */
  async suggest(q: string): Promise<TagDto[]> {
    const prefix = normalizeTag(q)
    if (!prefix) return []
    const docs = await this.tags
      .find({ _id: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
      .sort({ postCount: -1, _id: 1 })
      .limit(10)
      .lean()
    return docs.map((t) => ({ name: t._id, display: t.display, postCount: t.postCount }))
  }

  async featured(): Promise<TagDto[]> {
    const docs = await this.tags.find({ _id: { $in: [...FEATURED_TAGS] } }).lean()
    const byId = new Map(docs.map((t) => [t._id, t]))
    return FEATURED_TAGS.map((name) => {
      const t = byId.get(name)
      return { name, display: t?.display ?? FEATURED_DISPLAY[name], postCount: t?.postCount ?? 0 }
    })
  }
}
