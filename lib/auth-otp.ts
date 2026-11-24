import 'server-only'
import { randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { newOtp, otpDigest, sendOtp } from './otp'
import { sealWorkflow, openWorkflow } from './workflow-secrets'
import { acceptedSignupApplication } from './nanny-onboarding'
import { requestSignal } from './worker-context'
export type AuthPurpose = 'login' | 'signup' | 'reset'
export type AuthOtpPayload = {
  version: 2
  intent: AuthPurpose
  email: string
  role: 'parent' | 'nanny'
  tokenHash?: string
  setupPassword?: boolean
  session?: { access_token: string; refresh_token: string }
  newAccount?: { fullName: string }
  applicationId?: string
}
export class AuthOtpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}
function detachedAuth() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global:{fetch:(input,init)=>fetch(input,{...init,signal:requestSignal(10000,init?.signal)})},
    },
  )
}
export async function requestAuthOtp(
  db: SupabaseClient,
  email: string,
  purpose: AuthPurpose,
  name: string,
  role: 'parent' | 'nanny',
  password: string,
) {
  const applicationId = purpose === 'signup' && role === 'nanny'
    ? await acceptedSignupApplication(db, email)
    : null
  if (purpose === 'signup' && role === 'nanny' && !applicationId)
    throw new AuthOtpError('Complete your nanny application and accept the current agreement using this email before creating a nanny account.', 409)
  const { data: userId, error: lookupError } = await db.rpc('otp_email_user', {
    p_email: email,
  })
  if (lookupError)
    throw new AuthOtpError('Account verification is temporarily unavailable.', 503)
  let identity = null
  if (userId) {
    const result = await db.auth.admin.getUserById(userId)
    if (result.error)
      throw new AuthOtpError('Account verification is temporarily unavailable.', 503)
    identity = result.data.user
  }
  let session: AuthOtpPayload['session']
  const setupPassword = purpose === 'signup' && !identity?.email_confirmed_at
  // This client never writes browser cookies. Password-only tokens stay server-side.
  if (purpose === 'login' || (purpose === 'signup' && !setupPassword)) {
    const result = await detachedAuth().auth.signInWithPassword({ email, password })
    if (result.error || !result.data.session)
      throw new AuthOtpError('The email or password is incorrect. Please try again.', 401)
    session = {
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
    }
  }
  const otp = newOtp()
  const { error } = await db.rpc('issue_otp_challenge', {
    p_id: otp.id,
    p_purpose: purpose === 'reset' ? 'signup' : purpose,
    p_subject: otpDigest('auth-subject', email),
    p_hash: otpDigest(otp.id, otp.code),
    p_payload: {},
  })
  if (error)
    throw new AuthOtpError(
      error.code === 'P0001'
        ? error.message
        : 'Could not prepare verification. Please retry.',
      error.code === 'P0001' ? 429 : 503,
    )
  if (purpose === 'reset' && !userId) return otp.id
  try {
    let tokenHash: string | undefined
    const newAccount = purpose === 'signup' && !identity ? { fullName: name } : undefined
    if (!session && !newAccount) {
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
      tokenHash = generated.data.properties.hashed_token
    }
    const sealed = sealWorkflow({
      version: 2,
      intent: purpose,
      email,
      role,
      session,
      tokenHash,
      setupPassword,
      newAccount,
      applicationId: applicationId || undefined,
    } satisfies AuthOtpPayload)
    const saved = await db
      .from('otp_challenges')
      .update({ payload: sealed })
      .eq('id', otp.id)
    if (saved.error) throw new Error('Could not save verification')
    await sendOtp(email, otp.code, otp.id, purpose === 'reset' ? 'reset' : purpose)
  } catch {
    await db
      .from('otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id)
    throw new AuthOtpError('We could not send the code. Please try again shortly.', 503)
  }
  return otp.id
}
export async function consumeAuthOtp(
  db: SupabaseClient,
  id: string,
  purpose: AuthPurpose,
  code: string,
) {
  const { data, error } = await db.rpc('consume_otp_challenge', {
    p_id: id,
    p_purpose: purpose === 'reset' ? 'signup' : purpose,
    p_hash: otpDigest(id, code),
  })
  if (error || !data?.ok) return null
  const payload = openWorkflow<AuthOtpPayload>(data.payload)
  return payload.version === 2 && payload.intent === purpose ? payload : null
}
export async function establishOtpSession(
  db: SupabaseClient,
  auth: SupabaseClient,
  payload: AuthOtpPayload,
  password = '',
) {
  if (payload.intent === 'signup' && payload.role === 'nanny') {
    const application = await acceptedSignupApplication(db, payload.email)
    if (!application || application !== payload.applicationId)
      throw new AuthOtpError('Review and accept the current nanny agreement before creating your account.', 409)
  }
  const detached = detachedAuth()
  let session = payload.session
  if (payload.newAccount) {
    if (payload.intent !== 'signup' || password.length < 12 || password.length > 256)
      throw new AuthOtpError('Use a password of 12 to 256 characters.')
    // No Auth account is created until the application's own email code is verified.
    const created = await db.auth.admin.createUser({
      email: payload.email, password, email_confirm: true,
      user_metadata: { full_name: payload.newAccount.fullName },
    })
    if (created.error || !created.data.user)
      throw new AuthOtpError('Could not create your account. If you already registered, sign in or reset your password.', 409)
    const signed = await detached.auth.signInWithPassword({ email: payload.email, password })
    if (signed.error || !signed.data.session) throw new Error('Could not finish verification. Please sign in.')
    session = { access_token: signed.data.session.access_token, refresh_token: signed.data.session.refresh_token }
  }
  if (!session) {
    const verified = await detached.auth.verifyOtp({
      token_hash: payload.tokenHash!,
      type: 'email',
    })
    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.email?.toLowerCase() !== payload.email
    )
      throw new Error('This verification session expired. Request a new code.')
    if (!payload.setupPassword && payload.intent !== 'reset')
      throw new Error('Password verification is required.')
    if (password.length < 12 || password.length > 256)
      throw new AuthOtpError('Use a password of 12 to 256 characters.')
    const update = await db.auth.admin.updateUserById(verified.data.user.id, { password })
    if (update.error)
      throw new Error('Could not save the password. Request another code.')
    if (payload.intent === 'reset') return null
    const signed = await detached.auth.signInWithPassword({
      email: payload.email,
      password,
    })
    if (signed.error || !signed.data.session)
      throw new Error('Could not finish verification.')
    session = {
      access_token: signed.data.session.access_token,
      refresh_token: signed.data.session.refresh_token,
    }
  }
  const identity = await detached.auth.getUser(session.access_token)
  if (
    identity.error ||
    !identity.data.user ||
    identity.data.user.email?.toLowerCase() !== payload.email
  )
    throw new Error('This sign-in session expired. Request a new code.')
  const user = identity.data.user
  const sessionId = JSON.parse(
    Buffer.from(session.access_token.split('.')[1], 'base64url').toString(),
  ).session_id
  const confirmed = await db.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, email_otp_verified: payload.email },
  })
  if (confirmed.error) throw new Error('Could not finish verification.')
  const proof = await db.rpc('record_email_otp_session', {
    p_session: sessionId,
    p_user: user.id,
  })
  if (proof.error || !proof.data)
    throw new Error('Could not verify this sign-in session.')
  const established = await auth.auth.setSession(session)
  if (established.error || !established.data.session) {
    await db.from('otp_verified_sessions').delete().eq('session_id', sessionId)
    await auth.auth.signOut({ scope: 'local' })
    throw new Error('Could not finish verification.')
  }
  return confirmed.data.user!
}
