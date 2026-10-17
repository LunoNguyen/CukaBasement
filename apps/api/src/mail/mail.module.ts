import { Global, Module } from '@nestjs/common'
import { MAIL } from './mail.port'
import { MailService } from './mail.service'

@Global()
@Module({
  providers: [{ provide: MAIL, useClass: MailService }],
  exports: [MAIL],
})
export class MailModule {}
