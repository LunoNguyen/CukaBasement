import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import { CONFIG, type Config } from '../config/config'
import { USER_MODEL, UserSchema } from '../users/user.schema'
import { UsersService } from '../users/users.service'
import { AUTH_TOKEN_MODEL, AuthTokenSchema } from './auth-token.schema'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { TokensService } from './tokens'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: USER_MODEL, schema: UserSchema },
      { name: AUTH_TOKEN_MODEL, schema: AuthTokenSchema },
    ]),
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        secret: config.jwt.accessSecret,
        signOptions: { algorithm: 'HS256', expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersService, TokensService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, UsersService, TokensService, MongooseModule],
})
export class AuthModule {}
