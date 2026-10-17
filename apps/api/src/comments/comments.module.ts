import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { NotificationsModule } from '../notifications/notifications.module'
import { PostsModule } from '../posts/posts.module'
import { UsersModule } from '../users/users.module'
import { COMMENT_MODEL, CommentSchema } from './comment.schema'
import { CommentsController } from './comments.controller'
import { CommentsService } from './comments.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: COMMENT_MODEL, schema: CommentSchema }]), NotificationsModule, PostsModule, UsersModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [MongooseModule],
})
export class CommentsModule {}
