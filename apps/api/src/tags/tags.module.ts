import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TAG_MODEL, TagSchema } from './tag.schema'
import { TagsService } from './tags.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: TAG_MODEL, schema: TagSchema }])],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
