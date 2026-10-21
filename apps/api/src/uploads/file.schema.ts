import { FILE_KINDS, FILE_STATUSES, type FileKind, type FileStatus, UPLOAD_PURPOSES, type UploadPurpose, VARIANT_NAMES, type VariantName } from '@cuka/shared'
import { type HydratedDocument, Schema, Types } from 'mongoose'

export interface FileVariant {
  name: VariantName
  bucket: string
  objectKey: string
  width: number | null
  height: number | null
}

export interface FileDoc {
  _id: Types.ObjectId
  ownerId: Types.ObjectId
  bucket: string
  objectKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  kind: FileKind
  width: number | null
  height: number | null
  durationSec: number | null
  /** `validating` is internal: a complete() call has claimed the file and is checking its bytes. */
  status: FileStatus | 'validating'
  variants: FileVariant[]
  /** watermarkHash of the text burned into the variants; '' for clean renders (see buildMedia's repost gate). */
  watermarkedFor: string
  /** When the display variants were last rendered; versions their public URLs, whose keys a re-render reuses. */
  variantsAt: Date | null
  /**
   * `site`: a homepage image uploaded by an admin. Published clean (no watermark) with a `large` render, never
   * usable in a post or profile, and kept by the cleanup job until an admin deletes it. Missing on older files: `post`.
   */
  purpose?: UploadPurpose
  createdAt: Date
}

export type FileDocument = HydratedDocument<FileDoc>

export const FILE_MODEL = 'File'

const variantSchema = new Schema<FileVariant>(
  {
    name: { type: String, enum: VARIANT_NAMES, required: true },
    bucket: { type: String, required: true },
    objectKey: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false },
)

export const FileSchema = new Schema<FileDoc>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    bucket: { type: String, required: true },
    objectKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    kind: { type: String, enum: FILE_KINDS, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationSec: { type: Number, default: null },
    status: { type: String, enum: [...FILE_STATUSES, 'validating'], default: 'uploading' },
    variants: { type: [variantSchema], default: [] },
    watermarkedFor: { type: String, default: '' },
    variantsAt: { type: Date, default: null },
    purpose: { type: String, enum: UPLOAD_PURPOSES, default: 'post' },
  },
  { collection: 'files', timestamps: { createdAt: true, updatedAt: false } },
)

FileSchema.index({ status: 1, createdAt: 1 })
FileSchema.index({ ownerId: 1, createdAt: -1 })
FileSchema.index({ purpose: 1, createdAt: -1 })
