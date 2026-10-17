import type { FileKind } from './enums'

export const ALLOWED_FILE_TYPES: ReadonlyArray<{ ext: string; mime: string; kind: FileKind }> = [
  { ext: 'png', mime: 'image/png', kind: 'image' },
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image' },
  { ext: 'webp', mime: 'image/webp', kind: 'image' },
  { ext: 'gif', mime: 'image/gif', kind: 'image' },
  { ext: 'mp4', mime: 'video/mp4', kind: 'video' },
  { ext: 'webm', mime: 'video/webm', kind: 'video' },
  { ext: 'mp3', mime: 'audio/mpeg', kind: 'audio' },
  { ext: 'wav', mime: 'audio/wav', kind: 'audio' },
  { ext: 'ogg', mime: 'audio/ogg', kind: 'audio' },
  { ext: 'psd', mime: 'image/vnd.adobe.photoshop', kind: 'source' },
  { ext: 'clip', mime: 'application/octet-stream', kind: 'source' },
  { ext: 'zip', mime: 'application/zip', kind: 'archive' },
]

/** Match on mime; `application/octet-stream` is only accepted together with the `clip` extension. */
export function kindForMime(mime: string, ext: string): FileKind | null {
  const m = mime.toLowerCase()
  const e = ext.toLowerCase().replace(/^\./, '')
  const entry = ALLOWED_FILE_TYPES.find(
    (t) => t.mime === m && (t.mime !== 'application/octet-stream' || t.ext === e),
  )
  return entry ? entry.kind : null
}
