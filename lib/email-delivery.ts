import 'server-only'
import { Resend } from 'resend'
import { emailSettings } from '@/lib/email-settings'

export type EmailMessage = {
  from?: string
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: { filename: string; content: Buffer }[]
}

/** Preview and local environments never send mail unless explicitly enabled. */
export async function sendEmail(message: EmailMessage) {
  const settings = emailSettings()
  if (settings.mode === 'disabled')
    return { data: null, error: null, skipped: true }
  if (!settings.apiKey) {
    return {
      data: null,
      error: { message: 'Email delivery is not configured.' },
      skipped: true,
    }
  }
  const result = await new Resend(settings.apiKey).emails.send({
    ...message,
    from: settings.from,
    replyTo: message.replyTo || settings.replyTo,
  })
  return { ...result, skipped: false }
}
