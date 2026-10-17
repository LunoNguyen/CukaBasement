import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AUTH_TOKEN_MODEL, AuthTokenSchema } from '../auth/auth-token.schema'
import { MeController } from './me.controller'
import { UploadsModule } from '../uploads/uploads.module'
import { USER_MODEL, UserSchema } from './user.schema'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [
    UploadsModule,
    MongooseModule.forFeature([
      { name: USER_MODEL, schema: UserSchema },
      { name: AUTH_TOKEN_MODEL, schema: AuthTokenSchema },
    ]),
  ],
  controllers: [MeController, UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
