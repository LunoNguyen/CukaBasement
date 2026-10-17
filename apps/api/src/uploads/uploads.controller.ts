import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { createUploadSchema } from '@cuka/shared'
import { Auth, CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { ZodPipe } from '../common/zod.pipe'
import { type CreateUploadInput, UploadsService } from './uploads.service'

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @Auth({ verified: true, write: true })
  presign(@CurrentViewer() v: Viewer, @Body(new ZodPipe(createUploadSchema)) body: CreateUploadInput) {
    return this.uploads.presign(v.id, body)
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Auth({ verified: true, write: true })
  complete(@CurrentViewer() v: Viewer, @Param('id') id: string) {
    return this.uploads.complete(v.id, id)
  }
}
