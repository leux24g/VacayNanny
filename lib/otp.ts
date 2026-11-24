import 'server-only'
import { createHmac, randomInt, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverEmail } from './email-delivery'
import { emailSettings } from './email-settings'
export const OTP_SECONDS = 600
export const OTP_RESEND_SECONDS = 60
export function otpDigest(scope: string, value: string) {
  const key =
    process.env.NOTIFICATION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Verification is not configured.')
  return createHmac('sha256', key).update(`otp:${scope}:${value}`).digest('hex')
}
export function newOtp() {
  return { id: randomUUID(), code: String(randomInt(0, 1000000)).padStart(6, '0') }
}
export function emailReady() {
  const s = emailSettings()
  return (
    s.mode === 'send' &&
    (s.provider === 'smtp' ? Boolean(s.smtp.user && s.smtp.password) : Boolean(s.apiKey))
  )
}
export async function sendOtp(
  email: string,
  code: string,
  id: string,
  purpose: 'login' | 'signup' | 'reset' | 'care',
  detail = '',
) {
  if (!emailReady()) throw new Error('Email delivery is not configured.')
  const subject =
    purpose === 'reset'
      ? 'Reset your VacayNanny password'
      : purpose === 'care'
        ? 'Confirm your VacayNanny care is complete'
        : purpose === 'signup'
          ? 'Verify your VacayNanny email'
          : 'Your VacayNanny sign-in code'
  const introduction =
    purpose === 'care'
      ? `${detail}\nShare this code with the named nanny only after their agreed care is complete. Each nanny has a separate code.`
      : 'Enter this code on VacayNanny to continue. Do not share this sign-in code with anyone.'
  const text = `${introduction}\n\n${code}\n\nThis code expires in 10 minutes and can be used once. If you did not request it, you can ignore this email.\n\nThe VacayNanny Team`
  const escaped = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  await deliverEmail(
    {
      to: email,
      subject,
      text,
      html: `<div style="font-family:Arial,sans-serif;color:#17324d;max-width:520px;padding:28px;background:#fff8ef"><h2>${subject}</h2><p style="line-height:1.7">${escaped(introduction).replaceAll('\n', '<br>')}</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>Expires in 10 minutes. This code can be used once.</p><p>If you did not request this, ignore this email.</p><p>The VacayNanny Team</p></div>`,
    },
    `otp:${id}`,
  )
}
/** Authentication verification must fail closed if the shared limiter is unavailable. */
export async function limitOtp(
  db: SupabaseClient,
  email: string,
  address: string,
  verify = false,
) {
  for (const [value, limit] of [
    [`ip:${address}`, verify ? 60 : 30],
    [`email:${email}`, verify ? 20 : 8],
  ] as const) {
    const { data, error } = await db.rpc('consume_rate_limit', {
      p_bucket: `otp:${verify ? 'verify' : 'request'}:${otpDigest('rate', value)}`,
      p_limit: limit,
      p_window_seconds: 3600,
    })
    if (error)
      throw new Error('Verification is temporarily unavailable. Please retry shortly.')
    if (!data) return false
  }
  return true
}
