import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { CONFIG, type Config } from '../config/config'

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({ uri: config.mongoUri }),
    }),
  ],
})
export class DatabaseModule {}
