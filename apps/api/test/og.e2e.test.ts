import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { approve, createPost, createTestHarness, createUser, type Harness, testConfig } from './harness'

describe('GET /og/posts/:id', () => {
  let h: Harness
  const appUrl = testConfig().appUrl
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const og = (id: string) => h.http().get(`/og/posts/${id}`)

  it('approved all-ages post has og:image pointing at cuka-public thumb_md', async () => {
    const author = await createUser(h)
    const postId = await createPost(h, author, { title: 'Hello', description: 'A nice picture' })
    await approve(h, postId)
    const res = await og(postId)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    const publicUrl = testConfig().minio.publicUrl
    expect(res.text).toContain(`<meta property="og:image" content="${publicUrl}/test-cuka-public/`)
    expect(res.text).toMatch(/thumb_md\.webp"/)
    expect(res.text).toContain('<meta property="og:title" content="Hello">')
    expect(res.text).toContain('<meta property="og:description" content="A nice picture">')
    expect(res.text).toContain(`<meta property="og:url" content="${appUrl}/posts/${postId}">`)
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(res.text).toContain(`<meta http-equiv="refresh" content="0;url=${appUrl}/posts/${postId}">`)
  })

  it('r18 or pending post uses default og image', async () => {
    const author = await createUser(h)
    const pending = await createPost(h, author)
    const r18 = await createPost(h, author, { rating: 'r18' })
    await approve(h, r18)
    for (const id of [pending, r18]) {
      const res = await og(id)
      expect(res.status).toBe(200)
      expect(res.text).toContain(`<meta property="og:image" content="${appUrl}/og-default.png">`)
    }
  })

  it('title with <script> is escaped', async () => {
    const author = await createUser(h)
    const postId = await createPost(h, author, { title: `<script>alert("x")</script> & 'y'`, description: '' })
    await approve(h, postId)
    const res = await og(postId)
    expect(res.text).not.toContain('<script>')
    expect(res.text).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;')
    // empty description falls back to the title
    expect(res.text).toContain('<meta property="og:description" content="&lt;script&gt;')
  })

  it('description is truncated to 200 chars', async () => {
    const author = await createUser(h)
    const postId = await createPost(h, author, { description: 'a'.repeat(250) })
    const res = await og(postId)
    expect(res.text).toContain(`content="${'a'.repeat(200)}">`)
    expect(res.text).not.toContain('a'.repeat(201))
  })

  it('repost description is prefixed "Art by @handle (Platform) — "; own work is not', async () => {
    const author = await createUser(h)
    const credit = { isOwnWork: false, artistName: 'Ruri', artistHandle: '_rurisuisen', platform: 'x', sourceUrl: 'https://x.com/_rurisuisen/status/1', permissionNote: '' }
    const repost = await createPost(h, author, { description: 'Birthday art', credit })
    expect((await og(repost)).text).toContain('<meta property="og:description" content="Art by @_rurisuisen (X) — Birthday art">')
    const other = await createPost(h, author, { title: 'T', description: '', credit: { ...credit, artistHandle: '', platform: 'other' } })
    expect((await og(other)).text).toContain('<meta property="og:description" content="Art by Ruri — T">')
    const own = await createPost(h, author, { description: 'Mine' })
    expect((await og(own)).text).toContain('<meta property="og:description" content="Mine">')
  })

  it('approved repost shares its cover only once it carries the current credit', async () => {
    const author = await createUser(h)
    const credit = { isOwnWork: false, artistName: 'Ruri', artistHandle: '_rurisuisen', platform: 'x', sourceUrl: 'https://x.com/_rurisuisen/status/1', permissionNote: '' }
    const postId = await createPost(h, author, { credit })
    await approve(h, postId)
    expect((await og(postId)).text).toMatch(/thumb_md\.webp"/)
    await h.db.collection('files').updateMany({}, { $set: { watermarkedFor: '' } })
    expect((await og(postId)).text).toContain(`<meta property="og:image" content="${appUrl}/og-default.png">`)
  })

  it('unknown, invalid, hidden and deleted posts give 404 html with default image', async () => {
    const author = await createUser(h)
    const hidden = await createPost(h, author)
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(hidden) }, { $set: { 'review.status': 'hidden' } })
    const deleted = await createPost(h, author)
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(deleted) }, { $set: { deletedAt: new Date() } })
    for (const id of [new Types.ObjectId().toString(), 'not-an-id', hidden, deleted]) {
      const res = await og(id)
      expect(res.status).toBe(404)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(res.text).toContain('<meta property="og:title" content="CukaBasement">')
      expect(res.text).toContain(`<meta property="og:image" content="${appUrl}/og-default.png">`)
    }
  })
})
