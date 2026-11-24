export type EmailSettings = {
  mode: 'send' | 'disabled'
  provider: 'smtp' | 'resend'
  from: string
  replyTo: string
  apiKey: string | undefined
  smtp: { host: string; port: number; secure: boolean; user: string; password: string }
}
export function emailSettings(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): EmailSettings {
  const isPreview = Boolean(env.VERCEL_ENV && env.VERCEL_ENV !== 'production')
  const defaultMode = env.NODE_ENV === 'production' && !isPreview ? 'send' : 'disabled'
  const user = (env.SMTP_USER || env.EMAIL || '').trim()
  const provider =
    env.EMAIL_PROVIDER === 'resend'
      ? 'resend'
      : env.EMAIL_PROVIDER === 'smtp' || user
        ? 'smtp'
        : 'resend'
  const host = env.SMTP_HOST?.trim() || 'smtp.gmail.com'
  const port = Number(env.SMTP_PORT || 465)
  const password = env.SMTP_PASSWORD || env.EMAIL_APP_PASSWORD || ''
  return {
    mode: (env.EMAIL_DELIVERY_MODE || defaultMode) === 'send' ? 'send' : 'disabled',
    provider,
    from:
      provider === 'smtp'
        ? `VacayNanny <${user}>`
        : env.RESEND_FROM_EMAIL?.trim() || 'VacayNanny <noreply@vacaynanny.net>',
    replyTo:
      env.EMAIL_REPLY_TO?.trim() ||
      env.RESEND_REPLY_TO_EMAIL?.trim() ||
      user ||
      'hello@vacaynanny.net',
    apiKey: env.RESEND_API_KEY?.trim() || undefined,
    smtp: {
      host,
      port,
      secure: port === 465,
      user,
      password: host === 'smtp.gmail.com' ? password.replace(/\s/g, '') : password,
    },
  }
}
