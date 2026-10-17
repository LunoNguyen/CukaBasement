import { Controller, Get, Inject, Param, Res } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { artistTag, type Credit, PLATFORM_LABELS } from '@cuka/shared'
import type { Response } from 'express'
import { type Model, Types } from 'mongoose'
import { CONFIG, type Config } from '../config/config'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { canViewPost } from '../posts/visibility'
import { StorageService } from '../storage/storage.service'
import { FILE_MODEL, type FileDoc } from '../uploads/file.schema'

const SITE_TITLE = 'CukaBasement'

/** "Art by @handle (Platform) — " for a repost (no "(…)" for platform `other`); empty for own work. */
function creditPrefix(credit: Credit | undefined): string {
  if (!credit || credit.isOwnWork) return ''
  const label = PLATFORM_LABELS[credit.platform] ?? ''
  return `Art by ${artistTag(credit)}${label ? ` (${label})` : ''} — `
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

@Controller('og')
export class OgController {
  constructor(
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectModel(FILE_MODEL) private readonly files: Model<FileDoc>,
    private readonly storage: StorageService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('posts/:id')
  async post(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const defaultImage = `${this.config.appUrl}/og-default.png`
    const post = Types.ObjectId.isValid(id) ? await this.posts.findById(id).lean() : null
    res.type('text/html; charset=utf-8')
    if (!post || !canViewPost(null, post)) {
      res.status(404).send(page({ title: SITE_TITLE, description: SITE_TITLE, image: defaultImage, url: this.config.appUrl }))
      return
    }
    let image = defaultImage
    if (post.review.status === 'approved' && post.visibility === 'public' && post.rating === 'all') {
      const cover = post.files.find((f) => f.isCover) ?? [...post.files].sort((a, b) => a.position - b.position)[0]
      const file = cover ? await this.files.findById(cover.fileId).lean() : null
      const variant = file?.status === 'ready' ? file.variants.find((v) => v.name === 'thumb_md') : undefined
      if (variant && variant.bucket === this.config.minio.bucketPublic) image = this.storage.publicUrl(variant.objectKey)
    }
    res.send(
      page({
        title: post.title,
        description: (creditPrefix(post.credit) + (post.description || post.title)).slice(0, 200),
        image,
        url: `${this.config.appUrl}/posts/${post._id.toString()}`,
      }),
    )
  }
}

function page(v: { title: string; description: string; image: string; url: string }): string {
  const [title, description, image, url] = [v.title, v.description, v.image, v.url].map(esc)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_TITLE}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${url}">
</head>
<body><a href="${url}">${title}</a></body>
</html>
`
}
