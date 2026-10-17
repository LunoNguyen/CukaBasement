import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TAG_MODEL, TagSchema } from './tag.schema'
import { TagsController } from './tags.controller'
import { TagsService } from './tags.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: TAG_MODEL, schema: TagSchema }])],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
