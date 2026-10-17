import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BOOKMARK_MODEL, BookmarkSchema, FOLLOW_MODEL, FollowSchema, LIKE_MODEL, LikeSchema } from './interaction.schemas'

/** Registers the like/bookmark/follow models once so posts, users and feed can read them without importing the service. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LIKE_MODEL, schema: LikeSchema },
      { name: BOOKMARK_MODEL, schema: BookmarkSchema },
      { name: FOLLOW_MODEL, schema: FollowSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class InteractionModelsModule {}
