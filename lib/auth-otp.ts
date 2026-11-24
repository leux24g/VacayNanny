import 'server-only'
import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { newOtp, otpDigest, sendOtp } from './otp'
import { sealWorkflow, openWorkflow } from './workflow-secrets'
export type AuthOtpPayload = {
  email: string
  tokenHash: string
  role: 'parent' | 'nanny'
}
export async function requestAuthOtp(
  db: SupabaseClient,
  email: string,
  purpose: 'login' | 'signup',
  name: string,
  role: 'parent' | 'nanny',
) {
  const { data: userId, error: lookupError } = await db.rpc('otp_email_user', {
    p_email: email,
  })
  if (lookupError) throw new Error('Account verification is temporarily unavailable.')
  const otp = newOtp()
  const { error } = await db.rpc('issue_otp_challenge', {
    p_id: otp.id,
    p_purpose: purpose,
    p_subject: otpDigest('auth-subject', email),
    p_hash: otpDigest(otp.id, otp.code),
    p_payload: {},
  })
  if (error)
    throw new Error(
      error.code === 'P0001'
        ? error.message
        : 'Could not prepare verification. Please retry.',
    )
  // Unknown sign-in addresses use the same cooldown without creating an account.
  if (purpose === 'login' && !userId) return otp.id
  try {
    const generated = userId
      ? await db.auth.admin.generateLink({ type: 'magiclink', email })
      : await db.auth.admin.generateLink({
          type: 'signup',
          email,
          password: randomBytes(32).toString('base64url'),
          options: { data: { full_name: name, role } },
        })
    if (generated.error || !generated.data.properties?.hashed_token)
      throw new Error('Could not prepare verification')
    const sealed = sealWorkflow({
      email,
      role,
      tokenHash: generated.data.properties.hashed_token,
    } satisfies AuthOtpPayload)
    const saved = await db
      .from('otp_challenges')
      .update({ payload: sealed })
      .eq('id', otp.id)
    if (saved.error) throw new Error('Could not save verification')
    await sendOtp(email, otp.code, otp.id, purpose)
  } catch {
    await db
      .from('otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id)
    throw new Error('We could not send the code. Please try again shortly.')
  }
  return otp.id
}
export async function consumeAuthOtp(
  db: SupabaseClient,
  id: string,
  purpose: 'login' | 'signup',
  code: string,
) {
  const { data, error } = await db.rpc('consume_otp_challenge', {
    p_id: id,
    p_purpose: purpose,
    p_hash: otpDigest(id, code),
  })
  if (error || !data?.ok) return null
  return openWorkflow<AuthOtpPayload>(data.payload)
}

export async function establishOtpSession(
  db: SupabaseClient,
  auth: SupabaseClient,
  payload: AuthOtpPayload,
) {
  const { data, error } = await auth.auth.verifyOtp({
    token_hash: payload.tokenHash,
    type: 'email',
  })
  if (
    error ||
    !data.user ||
    !data.session ||
    data.user.email?.toLowerCase() !== payload.email
  ) {
    if (data.session) await auth.auth.signOut()
    throw new Error('This verification session expired. Request a new code.')
  }
  // A third party may have pre-registered this email with a known password.
  // Passwordless verification must never activate that pre-selected credential.
  const confirmed = await db.auth.admin.updateUserById(data.user.id, {
    password: randomBytes(32).toString('base64url'),
    app_metadata: { ...data.user.app_metadata, email_otp_verified: payload.email },
  })
  if (confirmed.error) {
    await auth.auth.signOut()
    throw new Error('Could not finish verification.')
  }
  // Password changes revoke refresh tokens. Mint the final session afterwards.
  const fresh = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: payload.email,
  })
  if (fresh.error || !fresh.data.properties?.hashed_token) {
    await auth.auth.signOut()
    throw new Error('Could not finish verification.')
  }
  const established = await auth.auth.verifyOtp({
    token_hash: fresh.data.properties.hashed_token,
    type: 'email',
  })
  if (established.error || !established.data.session || !established.data.user) {
    await auth.auth.signOut()
    throw new Error('Could not finish verification.')
  }
  return established.data.user
}
