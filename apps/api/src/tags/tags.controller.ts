import { Controller, Get, Query } from '@nestjs/common'
import { TagsService } from './tags.service'

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get('suggest')
  suggest(@Query('q') q?: string) {
    return this.tags.suggest(typeof q === 'string' ? q : '')
  }

  @Get('featured')
  featured() {
    return this.tags.featured()
  }
}
