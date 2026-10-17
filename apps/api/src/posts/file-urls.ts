import type { FileKind, FileStatus, VariantName } from '@cuka/shared'
import { canSeeR18, type Viewer } from '../auth/viewer'
import type { StorageService } from '../storage/storage.service'
import type { FileDoc, FileVariant } from '../uploads/file.schema'
import type { Post } from './post.schema'
import { isStaff } from './visibility'

export interface PostMediaDto {
  fileId: string
  kind: FileKind
  position: number
  isCover: boolean
  status: FileStatus
  width?: number
  height?: number
  durationSec?: number
  thumbSmUrl: string | null
  thumbMdUrl: string | null
  previewUrl: string | null
  blurred: boolean
}

export interface MediaDeps {
  storage: StorageService
  publicBucket: string
}

/** Where media is shown: `mod` is the /mod endpoints, `default` everything else. */
export type MediaContext = 'default' | 'mod'

/**
 * Spec §5.3 / ruling R17: full r18 media needs `canSeeR18` (adult + showR18). On /mod endpoints adult staff
 * also get it, whatever their showR18, because they moderate r18 posts; underage staff never do.
 */
export function canSeeFullMedia(viewer: Viewer | null, context: MediaContext = 'default'): boolean {
  return canSeeR18(viewer) || (context === 'mod' && isStaff(viewer) && !!viewer?.isAdult)
}

/**
 * Media of `post` in position order (files missing from `files` are skipped).
 * `all`: public URLs (presigned while a variant still sits in the private bucket after a rating change).
 * `r18` for an ineligible viewer: only the presigned `blurred` variant, as both thumbnails.
 * `r18` for an eligible viewer: presigned URLs. Files not `ready` yet: null URLs.
 */
export async function buildMedia(
  post: Pick<Post, 'rating' | 'files'>,
  files: FileDoc[],
  viewer: Viewer | null,
  { storage, publicBucket }: MediaDeps,
  context: MediaContext = 'default',
): Promise<PostMediaDto[]> {
  const byId = new Map(files.map((f) => [f._id.toString(), f]))
  const blurred = post.rating === 'r18' && !canSeeFullMedia(viewer, context)
  const out: PostMediaDto[] = []
  for (const pf of [...post.files].sort((a, b) => a.position - b.position)) {
    const file = byId.get(pf.fileId.toString())
    if (!file) continue
    const ready = file.status === 'ready'
    const variant = (name: VariantName) => (ready ? file.variants.find((v) => v.name === name) : undefined)
    const url = async (v: FileVariant | undefined): Promise<string | null> => {
      if (!v) return null
      if (post.rating === 'all' && v.bucket === publicBucket) return storage.publicUrl(v.objectKey)
      return storage.presignGet(v.bucket, v.objectKey)
    }
    let urls: Pick<PostMediaDto, 'thumbSmUrl' | 'thumbMdUrl' | 'previewUrl'>
    if (blurred) {
      const b = await url(variant('blurred'))
      urls = { thumbSmUrl: b, thumbMdUrl: b, previewUrl: null }
    } else {
      urls = { thumbSmUrl: await url(variant('thumb_sm')), thumbMdUrl: await url(variant('thumb_md')), previewUrl: await url(variant('preview')) }
    }
    out.push({
      fileId: file._id.toString(),
      kind: file.kind,
      position: pf.position,
      isCover: pf.isCover,
      status: file.status === 'validating' ? 'uploading' : file.status,
      ...(file.width != null ? { width: file.width } : {}),
      ...(file.height != null ? { height: file.height } : {}),
      ...(file.durationSec != null ? { durationSec: file.durationSec } : {}),
      ...urls,
      blurred,
    })
  }
  return out
}
