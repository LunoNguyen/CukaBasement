import { Inject, Injectable, Logger } from '@nestjs/common'
import { createTransport, type Transporter } from 'nodemailer'
import { CONFIG, type Config } from '../config/config'
import type { MailMessage, MailPort } from './mail.port'

/** Sends through SMTP when `smtpUrl` is configured; otherwise logs the message (dev fallback). */
@Injectable()
export class MailService implements MailPort {
  private readonly logger = new Logger('MailService')
  private readonly transport: Transporter | null

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.transport = config.smtpUrl ? createTransport(config.smtpUrl) : null
  }

  async send(msg: MailMessage): Promise<void> {
    if (!this.transport) {
      this.logger.log(`To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}`)
      return
    }
    await this.transport.sendMail({ from: this.config.mailFrom, to: msg.to, subject: msg.subject, text: msg.text })
  }
}
