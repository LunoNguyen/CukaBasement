import { describe, expect, it } from 'vitest'
import { kindForMime } from '../src'

describe('kindForMime', () => {
  it('maps image', () => expect(kindForMime('image/png', 'png')).toBe('image'))
  it('maps video/audio/archive', () => {
    expect(kindForMime('video/mp4', 'mp4')).toBe('video')
    expect(kindForMime('audio/mpeg', 'mp3')).toBe('audio')
    expect(kindForMime('application/zip', 'zip')).toBe('archive')
    expect(kindForMime('image/vnd.adobe.photoshop', 'psd')).toBe('source')
  })
  it('falls back to ext for clip', () =>
    expect(kindForMime('application/octet-stream', 'clip')).toBe('source'))
  it('rejects octet-stream with other ext', () =>
    expect(kindForMime('application/octet-stream', 'exe')).toBeNull())
  it('rejects unknown', () => expect(kindForMime('application/x-msdownload', 'exe')).toBeNull())
})
