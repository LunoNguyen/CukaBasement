export const MAIL = Symbol('MAIL')

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface MailPort {
  send(msg: MailMessage): Promise<void>
}
