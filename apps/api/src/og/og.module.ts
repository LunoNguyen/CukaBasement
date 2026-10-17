import { Module } from '@nestjs/common'
import { PostsModule } from '../posts/posts.module'
import { UploadsModule } from '../uploads/uploads.module'
import { OgController } from './og.controller'

@Module({
  imports: [PostsModule, UploadsModule],
  controllers: [OgController],
})
export class OgModule {}
