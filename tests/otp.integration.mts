import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { localCredentials } from '../scripts/local-database.mjs'
import { smtpFixture } from './smtp-fixture'
import { requestAuthOtp, consumeAuthOtp, establishOtpSession } from '../lib/auth-otp'
import { otpDigest, newOtp, sendOtp } from '../lib/otp'
import { emailSettings } from '../lib/email-settings'
import { dueBookingStatus } from '../lib/booking'
let db: SupabaseClient,
  anon: SupabaseClient,
  smtp: Awaited<ReturnType<typeof smtpFixture>>
const users: string[] = [],
  apps: string[] = [],
  nannies: string[] = [],
  bookings: string[] = []
let family: string, nannyUser: string, secondUser: string, operator: string
const email = `otp-${randomUUID()}@example.test`,
  env = { ...process.env }
before(async () => {
  const config = await localCredentials()
  db = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  anon = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  smtp = await smtpFixture()
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: config.url,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
    NOTIFICATION_ENCRYPTION_KEY: 'otp-integration-synthetic-key',
    EMAIL_DELIVERY_MODE: 'send',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.port),
    SMTP_USER: 'synthetic@example.test',
    SMTP_PASSWORD: 'synthetic-only',
  })
  for (const role of ['parent', 'nanny', 'nanny', 'admin']) {
    const r = await db.auth.admin.createUser({
      email: `otp-${randomUUID()}@example.test`,
      password: randomUUID(),
      email_confirm: true,
    })
    assert.ifError(r.error)
    const id = r.data.user!.id
    users.push(id)
    if (!family) family = id
    else if (!nannyUser) nannyUser = id
    else if (!secondUser) secondUser = id
    else operator = id
    assert.ifError((await db.from('profiles').update({ role }).eq('id', id)).error)
  }
})
after(async () => {
  for (const id of bookings) {
    await db.from('otp_challenges').delete().eq('booking_id', id)
    await db.from('workflow_audit').delete().eq('entity_id', id)
    await db.from('bookings').delete().eq('id', id)
  }
  for (const id of nannies) await db.from('nannies').delete().eq('id', id)
  for (const id of apps) await db.from('nanny_applications').delete().eq('id', id)
  for (const id of users) {
    await db.from('workflow_audit').delete().eq('actor_id', id)
    await db.auth.admin.deleteUser(id)
  }
  await smtp?.close()
  process.env = { ...env }
})
test('SMTP settings select the supplied app-password account without requiring Resend', () => {
  const s = emailSettings({
    EMAIL: 'sender@gmail.com',
    EMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
    EMAIL_DELIVERY_MODE: 'send',
  })
  assert.equal(s.provider, 'smtp')
  assert.equal(s.smtp.host, 'smtp.gmail.com')
  assert.equal(s.smtp.password, 'abcdefghijklmnop')
  assert.equal(s.from, 'VacayNanny <sender@gmail.com>')
})
test('signup sends a private expiring code, blocks an early resend without invalidating it, and establishes a real Auth session once', async () => {
  const id = await requestAuthOtp(db, email, 'signup', 'OTP Test Applicant', 'parent')
  const mail = smtp.messages.at(-1)!
  assert.equal(mail.to, email)
  assert.ok(mail.code)
  await assert.rejects(
    requestAuthOtp(db, email, 'signup', 'OTP Test Applicant', 'parent'),
    /Wait one minute/,
  )
  const rows = await db
    .from('otp_challenges')
    .select('code_hash,payload,expires_at,created_at')
    .eq('id', id)
    .single()
  assert.ifError(rows.error)
  assert.equal(JSON.stringify(rows.data).includes(mail.code!), false)
  assert.equal(
    Math.round(
      (Date.parse(rows.data!.expires_at) - Date.parse(rows.data!.created_at)) / 1000,
    ),
    600,
  )
  const p = await consumeAuthOtp(db, id, 'signup', mail.code!)
  assert.ok(p)
  const user = await establishOtpSession(db, anon, p)
  assert.ok(user.email_confirmed_at)
  assert.equal(user.app_metadata.email_otp_verified, email)
  users.push(user.id)
  assert.equal(await consumeAuthOtp(db, id, 'signup', mail.code!), null)
})
test('unknown login never creates an account; a known account can sign in with a fresh emailed code', async () => {
  const unknown = `missing-${randomUUID()}@example.test`,
    before = smtp.messages.length
  await requestAuthOtp(db, unknown, 'login', '', 'parent')
  assert.equal(smtp.messages.length, before)
  assert.equal((await db.rpc('otp_email_user', { p_email: unknown })).data, null)
  const userId = (await db.rpc('otp_email_user', { p_email: email })).data
  assert.ifError(
    (await db.auth.admin.updateUserById(userId, { password: 'Old-known-password-123!' }))
      .error,
  )
  const id = await requestAuthOtp(db, email, 'login', '', 'parent'),
    code = smtp.messages.at(-1)!.code!
  const payload = await consumeAuthOtp(db, id, 'login', code)
  assert.ok(payload)
  await establishOtpSession(db, anon, payload)
  const oldPassword = await anon.auth.signInWithPassword({
    email,
    password: 'Old-known-password-123!',
  })
  assert.ok(oldPassword.error)
})
test('wrong OTP attempts persist under concurrency, lock after five guesses, reject expired codes, and are private to server code', async () => {
  const otp = newOtp()
  assert.ifError(
    (
      await db.rpc('issue_otp_challenge', {
        p_id: otp.id,
        p_purpose: 'login',
        p_subject: randomUUID(),
        p_hash: otpDigest(otp.id, otp.code),
        p_payload: {},
      })
    ).error,
  )
  await Promise.all(
    Array.from({ length: 5 }, () =>
      consumeAuthOtp(db, otp.id, 'login', otp.code === '000000' ? '999999' : '000000'),
    ),
  )
  assert.equal(
    (await db.from('otp_challenges').select('attempts').eq('id', otp.id).single()).data!
      .attempts,
    5,
  )
  assert.equal(await consumeAuthOtp(db, otp.id, 'login', otp.code), null)
  assert.ifError(
    (
      await db
        .from('otp_challenges')
        .update({ attempts: 0, expires_at: new Date(0).toISOString() })
        .eq('id', otp.id)
    ).error,
  )
  assert.equal(await consumeAuthOtp(db, otp.id, 'login', otp.code), null)
  const denied = await anon.rpc('consume_otp_challenge', {
    p_id: otp.id,
    p_purpose: 'login',
    p_hash: otpDigest(otp.id, otp.code),
  })
  assert.ok(denied.error)
  const read = await anon.from('otp_challenges').select('*')
  assert.ok(read.error || !read.data?.length)
})
async function newNanny(userId: string) {
  const id = randomUUID()
  apps.push(id)
  assert.ifError(
    (
      await db.from('nanny_applications').insert({
        id,
        user_id: userId,
        email: `nanny-${id}@example.test`,
        full_name: 'Completion Test',
        status: 'approved',
        agreement_signed_path: 'test/signed.pdf',
        agreement_reviewed_by: operator,
        agreement_reviewed_at: new Date().toISOString(),
        vetting_reviewed_by: operator,
        vetting_reviewed_at: new Date().toISOString(),
        vetting_checks: {
          identity: true,
          policeClearance: true,
          references: true,
          interview: true,
          qualifications: true,
        },
      })
    ).error,
  )
  const row = await db
    .from('nannies')
    .insert({
      user_id: userId,
      application_id: id,
      slug: `otp-${id}`,
      display_name: 'Completion Nanny',
      is_active: true,
    })
    .select('id')
    .single()
  assert.ifError(row.error)
  nannies.push(row.data!.id)
  return row.data!.id
}
test('care completion requires each assigned nanny’s family code, cannot be forced by dates/status, and completes atomically once', async () => {
  const first = await newNanny(nannyUser),
    second = await newNanny(secondUser),
    date = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const saved = await db
    .from('bookings')
    .insert({
      parent_id: family,
      parent_name: 'Completion Family',
      email: 'family@example.test',
      destination: 'Diani',
      nanny_id: first,
      nannies_needed: '2',
      children_count: '2',
      check_in: date(-2),
      check_out: date(-1),
      status: 'confirmed',
      nanny_response: 'accepted',
      parent_confirmed_at: new Date().toISOString(),
      payment_status: 'not_required',
    })
    .select('*')
    .single()
  assert.ifError(saved.error)
  const id = saved.data!.id
  bookings.push(id)
  assert.ifError(
    (
      await db
        .from('booking_assignments')
        .insert({ booking_id: id, slot: 2, nanny_id: second, response: 'accepted' })
    ).error,
  )
  assert.ifError(
    (await db.from('bookings').update({ status: 'in_progress' }).eq('id', id)).error,
  )
  assert.equal(dueBookingStatus({ ...saved.data!, status: 'in_progress' }), null)
  assert.ok(
    (await db.from('bookings').update({ status: 'completed' }).eq('id', id)).error,
  )
  const firstCode = newOtp(),
    secondCode = newOtp()
  for (const [otp, actor] of [
    [firstCode, nannyUser],
    [secondCode, secondUser],
  ] as const) {
    assert.ifError(
      (
        await db.rpc('issue_otp_challenge', {
          p_id: otp.id,
          p_purpose: 'care',
          p_subject: randomUUID(),
          p_hash: otpDigest(otp.id, otp.code),
          p_payload: {},
          p_actor: actor,
          p_booking: id,
        })
      ).error,
    )
    await sendOtp(
      'family@example.test',
      otp.code,
      otp.id,
      'care',
      'Your named nanny has finished care.',
    )
  }
  assert.equal(smtp.messages.at(-1)!.to, 'family@example.test')
  const attempt = (otp: ReturnType<typeof newOtp>, actor: string, code = otp.code) =>
    db.rpc('consume_otp_challenge', {
      p_id: otp.id,
      p_purpose: 'care',
      p_hash: otpDigest(otp.id, code),
      p_actor: actor,
      p_booking: id,
    })
  assert.ok((await attempt(firstCode, family)).error)
  const a = await attempt(firstCode, nannyUser)
  assert.ifError(a.error)
  assert.equal(a.data.completed, false)
  assert.equal(
    (await db.from('bookings').select('status').eq('id', id).single()).data!.status,
    'in_progress',
  )
  const b = await attempt(secondCode, secondUser)
  assert.ifError(b.error)
  assert.equal(b.data.completed, true)
  assert.equal(
    (await db.from('bookings').select('status').eq('id', id).single()).data!.status,
    'completed',
  )
  assert.equal((await attempt(secondCode, secondUser)).data.ok, false)
  const audit = await db
    .from('workflow_audit')
    .select('id')
    .eq('entity_id', id)
    .eq('action', 'care_completion_verified')
  assert.equal(audit.data?.length, 2)
})
