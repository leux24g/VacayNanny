import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createServerClient } from './supabase/service'
import { emailSettings } from './email-settings'
import { sealWorkflow } from './workflow-secrets'
import { smtpTransport } from './smtp'
import { requestSignal } from './worker-context'

export class DeliveryUncertainError extends Error {}
export class DeliveryNotStartedError extends Error {}

export type EmailMessage = {
  from?: string
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: { filename: string; content: Buffer }[]
  applicationApprovalId?: string
  applicationStatus?: { id:string; status:'approved'|'rejected'; version?:number }
}
export type StoredEmail = Omit<EmailMessage, 'attachments'> & {
  attachments?: { filename: string; content: string }[]
}
const context = new AsyncLocalStorage<string>()
export function withNotificationContext<T>(key: string, operation: () => Promise<T>) {
  return context.run(key, operation)
}
export async function sendEmail(message: EmailMessage) {
  if (emailSettings().mode === 'disabled')
    return { data: null, error: null, skipped: true, queued: false }
  const payload: StoredEmail = {
    ...message,
    attachments: message.attachments?.map((file) => ({
      ...file,
      content: file.content.toString('base64'),
    })),
  }
  const key = createHash('sha256')
    .update(`${context.getStore() || randomUUID()}:${message.to}:${message.subject}`)
    .digest('hex')
  const { data, error } = await createServerClient().rpc('enqueue_workflow_job', {
    p_kind: 'email',
    p_payload: { sealed: sealWorkflow(payload) },
    p_key: `email:${key}`,
  })
  if (error) throw new Error('Could not queue the email notification.')
  return { data: { id: String(data) }, error: null, skipped: false, queued: true }
}
export async function deliverEmail(stored: StoredEmail, idempotencyKey: string) {
  const settings = emailSettings()
  if (settings.mode !== 'send' || (settings.provider === 'resend' && !settings.apiKey))
    throw new Error('Email delivery is not configured.')
  const { applicationApprovalId: _approval, applicationStatus:_status, ...message } = stored
  void _approval
  void _status
  if (settings.provider === 'smtp') {
    const transport = smtpTransport(), signal = requestSignal(20000)
    try {
      const options = {
        ...message,
        signal,
        from: settings.from,
        replyTo: message.replyTo || settings.replyTo,
        messageId: `<vacaynanny-${createHash('sha256').update(idempotencyKey).digest('hex')}@vacaynanny.net>`,
        attachments: message.attachments?.map((file) => ({
          ...file,
          content: Buffer.from(file.content, 'base64'),
        })),
      }
      const result = await transport.sendMail(options)
      if (!result.accepted?.length || result.rejected?.length)
        throw new DeliveryNotStartedError('SMTP provider did not accept the notification.')
      return
    } catch (error) {
      if (error instanceof DeliveryUncertainError) throw error
      if (error instanceof DeliveryNotStartedError) throw error
      const failure = error as { code?: string; command?: string; responseCode?:number }
      if(signal.aborted || failure.code === 'EABORT')throw new DeliveryUncertainError('SMTP delivery was interrupted; the provider may already have accepted it.')
      if (['CONN','AUTH','MAIL FROM','RCPT TO'].includes(failure.command || '') || failure.code === 'EAUTH' || failure.code === 'ECONNECTION' || (failure.responseCode && failure.responseCode >=400))
        throw new DeliveryNotStartedError('SMTP provider did not accept the notification.')
      throw new DeliveryUncertainError('SMTP delivery could not be confirmed. Check the provider delivery log.')
    } finally {
      transport.close()
    }
  }
  const { replyTo, ...body } = message
  const response = await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${settings.apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
    body:JSON.stringify({...body,from:settings.from,reply_to:replyTo || settings.replyTo}),signal:requestSignal(15000),
  })
  const data = await response.json().catch(()=>null)
  if (!response.ok || !data?.id) throw new Error('Email provider did not accept the notification.')
}
