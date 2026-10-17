import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { InteractionModelsModule } from '../interactions/interaction-models.module'
import { TagsModule } from '../tags/tags.module'
import { UploadsModule } from '../uploads/uploads.module'
import { UsersModule } from '../users/users.module'
import { PostEvents } from './post-events'
import { POST_MODEL, PostSchema } from './post.schema'
import { PostsController } from './posts.controller'
import { PostsService } from './posts.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: POST_MODEL, schema: PostSchema }]), UploadsModule, UsersModule, TagsModule, InteractionModelsModule],
  controllers: [PostsController],
  providers: [PostsService, PostEvents],
  exports: [PostsService, PostEvents, MongooseModule],
})
export class PostsModule {}
