import { Schema } from 'mongoose'

export interface Tag {
  /** The normalized tag. */
  _id: string
  /** The text as first written, without the leading `#`. */
  display: string
  postCount: number
}

export const TAG_MODEL = 'Tag'

export const TagSchema = new Schema<Tag>(
  {
    _id: { type: String, required: true },
    display: { type: String, required: true },
    postCount: { type: Number, default: 0 },
  },
  { collection: 'tags', versionKey: false },
)
