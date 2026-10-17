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
}
