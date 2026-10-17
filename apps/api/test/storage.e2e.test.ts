import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { StorageService } from '../src/storage/storage.service'
import { createTestHarness, type Harness, postMultipart, testConfig } from './harness'

describe('storage', () => {
  let h: Harness
  let storage: StorageService
  const bucket = testConfig().minio.bucketOriginals
  beforeAll(async () => {
    h = await createTestHarness()
    storage = h.app.get(StorageService)
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  it('presigned POST rejects body over limit', async () => {
    const { url, fields } = await storage.presignPost(bucket, 'k', 10, 'image/png')
    const res = await postMultipart(url, fields, Buffer.alloc(11))
    expect(res.status).toBe(400)
  })

  it('presigned POST accepts body within limit and stat sees it', async () => {
    const { url, fields } = await storage.presignPost(bucket, 'k', 10, 'image/png')
    const res = await postMultipart(url, fields, Buffer.alloc(10, 1))
    expect(res.status).toBe(204)
    expect(await storage.stat(bucket, 'k')).toEqual({ size: 10 })
  })

  it('stat of missing object is null', async () => expect(await storage.stat(bucket, 'nope')).toBeNull())

  it('put, getBuffer, readHead, copy, remove', async () => {
    await storage.put(bucket, 'a/b', Buffer.from('hello world'), 'text/plain')
    expect((await storage.getBuffer(bucket, 'a/b')).toString()).toBe('hello world')
    expect((await storage.readHead(bucket, 'a/b', 5)).toString()).toBe('hello')
    await storage.copy(bucket, 'a/b', bucket, 'c/d')
    expect(await storage.stat(bucket, 'c/d')).toEqual({ size: 11 })
    await storage.remove(bucket, 'a/b')
    expect(await storage.stat(bucket, 'a/b')).toBeNull()
    await expect(storage.remove(bucket, 'a/b')).resolves.toBeUndefined()
  })

  it('presignGet serves the object with download name', async () => {
    await storage.put(bucket, 'g', Buffer.from('xyz'), 'text/plain')
    const url = await storage.presignGet(bucket, 'g', { downloadName: 'my art.png' })
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''my%20art.png")
    expect(await res.text()).toBe('xyz')
  })

  it('getToFile writes the object to disk', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    await storage.put(bucket, 'f', Buffer.from('file!'), 'text/plain')
    const p = join(await mkdtemp(join(tmpdir(), 'cuka-')), 'out')
    await storage.getToFile(bucket, 'f', p)
    expect((await readFile(p)).toString()).toBe('file!')
  })

  it('key and url helpers', () => {
    expect(storage.objectKey('u', 'f', 'original', 'png')).toBe('u/f/original.png')
    expect(storage.publicUrl('u/f/x.webp')).toBe(`${testConfig().minio.publicUrl}/test-cuka-public/u/f/x.webp`)
  })
})
