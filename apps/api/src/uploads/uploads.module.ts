import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { FILE_MODEL, FileSchema } from './file.schema'
import { UploadsController } from './uploads.controller'
import { UploadsService } from './uploads.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: FILE_MODEL, schema: FileSchema }])],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService, MongooseModule],
})
export class UploadsModule {}
