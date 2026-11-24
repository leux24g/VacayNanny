import nextEnv from '@next/env'
import { randomUUID, createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { localCredentials } from './local-database.mjs'
import { createGuestAccess } from '../lib/guest-access'
import { reconcilePayment } from '../lib/paystack'
import { POST as webhookRoute } from '../app/api/payments/webhook/[environment]/route'
import { NextRequest } from 'next/server'
import assert from 'node:assert/strict'
nextEnv.loadEnvConfig(process.cwd())
const key = process.env.PAYSTACK_SECRET_KEY || ''
if (!key.startsWith('sk_test_'))
  throw new Error(
    'This command requires a Paystack test secret. Live keys are never accepted.',
  )
const email = process.env.EMAIL?.trim()
if (!email)
  throw new Error('Configure the controlled EMAIL address for sandbox receipts.')
const local = await localCredentials()
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: local.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: local.serviceKey,
  EMAIL_DELIVERY_MODE: 'disabled',
  PAYSTACK_MODE: 'uat',
})
const db = createClient(local.url, local.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const webhook = (request: NextRequest) => webhookRoute(request, {
  params: Promise.resolve({ environment: 'uat' }),
})
const request = async (path: string, body?: unknown) => {
  const response = await fetch('https://api.paystack.co' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  })
  return { http: response.status, body: await response.json() }
}
const date = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const marker = randomUUID(),
  books: string[] = [],
  report: Array<Record<string, unknown>> = []
const keepReviewBooking = process.argv.includes('--keep-review-booking')
const signatureMode = process.env.PAYSTACK_WEBHOOK_SECRET ? 'timestamped' : 'legacy'
let operator: string | undefined, app: string | undefined, nanny: string | undefined
let manualBooking: string | undefined
try {
  const user = await db.auth.admin.createUser({
    email: `sandbox-operator-${marker}@example.test`,
    password: randomUUID(),
    email_confirm: true,
  })
  assert.ifError(user.error)
  operator = user.data.user!.id
  app = randomUUID()
  assert.ifError(
    (
      await db
        .from('nanny_applications')
        .insert({
          id: app,
          email: `sandbox-nanny-${marker}@example.test`,
          full_name: 'Sandbox care professional',
          status: 'approved',
          agreement_signed_path: 'sandbox/never-issued.pdf',
          agreement_reviewed_at: new Date().toISOString(),
          agreement_reviewed_by: operator,
          vetting_reviewed_at: new Date().toISOString(),
          vetting_reviewed_by: operator,
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
  const profile = await db
    .from('nannies')
    .insert({
      application_id: app,
      slug: `sandbox-${marker}`,
      display_name: 'Sandbox care professional',
      tier: 'bronze',
      daily_rate_kes: 2200,
      is_active: true,
      available_days: [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ],
      destinations: ['Diani'],
    })
    .select('id')
    .single()
  assert.ifError(profile.error)
  nanny = profile.data!.id
  async function booking(offset: number) {
    const guest = createGuestAccess(),
      id = randomUUID()
    books.push(id)
    const result = await db
      .from('bookings')
      .insert({
        id,
        parent_name: 'Sandbox payment check',
        email,
        nanny_id: nanny,
        destination: 'Diani',
        check_in: date(offset),
        check_out: date(offset + 1),
        children_count: '1',
        nannies_needed: '1',
        tier: 'bronze',
        care_type: 'standard',
        status: 'confirmed',
        parent_confirmed_at: new Date().toISOString(),
        nanny_response: 'accepted',
        total_amount_kes: 2200,
        payment_status: 'unpaid',
        guest_access_token_hash: guest.hash,
      })
      .select('id')
      .single()
    assert.ifError(result.error)
    return { id, token: guest.token }
  }
  for (const [kind, offset] of [
    ['mpesa', 180],
    ['card', 183],
    ['declined-card', 186],
  ] as const) {
    const b = await booking(offset),
      reference = `VN-${randomUUID()}`
    const created = await db.rpc('create_booking_payment', {
      p_booking_id: b.id,
      p_reference: reference,
    })
    assert.ifError(created.error)
    const method =
      kind === 'mpesa'
        ? { mobile_money: { phone: '+254710000000', provider: 'mpesa' } }
        : {
            card: {
              number: kind === 'card' ? '4084084084084081' : '4084080000005408',
              cvv: kind === 'card' ? '408' : '001',
              expiry_month: '11',
              expiry_year: String(new Date().getUTCFullYear() + 1),
            },
          }
    const charged = await request('/charge', {
      email,
      amount: 220000,
      currency: 'KES',
      reference,
      ...method,
      metadata: { sandbox_check: true },
    })
    if (kind === 'declined-card') {
      let status = 'unconfirmed'
      try {
        status = (await reconcilePayment(db, reference)).status
      } catch {}
      const row = await db
        .from('bookings')
        .select('payment_status')
        .eq('id', b.id)
        .single()
      assert.equal(row.data!.payment_status, 'unpaid')
      assert.notEqual(charged.body.data?.status, 'success')
      report.push({
        case: kind,
        providerHttp: charged.http,
        providerStatus: charged.body.data?.status || 'declined',
        applicationStatus: row.data!.payment_status,
        verification: status,
      })
      continue
    }
    assert.equal(charged.body.status, true)
    let settled: Awaited<ReturnType<typeof reconcilePayment>> | null = null
    for (let i = 0; i < 5; i++) {
      settled = await reconcilePayment(db, reference)
      if (settled.status === 'success') break
      await new Promise((r) => setTimeout(r, 2000))
    }
    assert.equal(settled?.status, 'success')
    const row = await db.from('bookings').select('payment_status').eq('id', b.id).single()
    assert.equal(row.data!.payment_status, 'paid')
    // Replay a correctly signed event locally; independent provider verification still runs.
    const raw = JSON.stringify({ event: 'charge.success', data: { reference } }),
      headers = new Headers({ 'Content-Type': 'application/json' })
    if (process.env.PAYSTACK_WEBHOOK_SECRET) {
      const t = Math.floor(Date.now() / 1000)
      headers.set(
        'Paystack-Signature',
        `t=${t},v1=whk_sandbox:${createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')}`,
      )
    } else
      headers.set(
        'x-paystack-signature',
        createHmac('sha512', key).update(raw).digest('hex'),
      )
    for (let n = 0; n < 2; n++)
      assert.equal(
        (
          await webhook(
            new NextRequest('http://localhost:3102/api/payments/webhook/uat', {
              method: 'POST',
              headers,
              body: raw,
            }),
          )
        ).status,
        200,
      )
    assert.equal(
      (
        await webhook(
          new NextRequest('http://localhost:3102/api/payments/webhook/uat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: raw,
          }),
        )
      ).status,
      401,
    )
    const ledger = await db.from('payment_attempts').select('id').eq('booking_id', b.id)
    assert.equal(ledger.data?.length, 1)
    report.push({
      case: kind,
      providerHttp: charged.http,
      providerStatus: charged.body.data?.status,
      applicationStatus: row.data!.payment_status,
      duplicateWebhooks: 'passed',
      invalidSignature: 'rejected',
    })
  }
  await mkdir('artifacts', { recursive: true })
  if (keepReviewBooking) {
    // Explicitly opt in to keeping a local booking for hosted checkout review.
    const manual = await booking(190)
    manualBooking = manual.id
    await writeFile(
      'artifacts/paystack-manual-booking.json',
      JSON.stringify({
        bookingId: manual.id,
        token: manual.token,
        nanny,
        application: app,
        operator,
        url: `http://localhost:3102/booking/${manual.id}?token=${manual.token}`,
      }),
      { mode: 0o600 },
    )
  }
  await writeFile(
    'artifacts/paystack-sandbox-results.json',
    JSON.stringify(
      {
        mode: 'test',
        localDatabase: true,
        signatureMode,
        report,
        hostedCheckout: 'requires browser verification',
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ mode: 'test', signatureMode, report, manualReviewReady: Boolean(manualBooking) }))
} finally {
  for (const id of books.filter((id) => id !== manualBooking)) {
    await db.from('payment_attempts').delete().eq('booking_id', id)
    await db.from('ops_tasks').delete().eq('booking_id', id)
    await db.from('workflow_audit').delete().eq('entity_id', id)
    await db.from('bookings').delete().eq('id', id)
  }
  if (!manualBooking) {
    if (nanny) {
      await db.from('workflow_jobs').delete().eq('dedupe_key', `activation:${nanny}`)
      await db.from('nannies').delete().eq('id', nanny)
    }
    if (app) await db.from('nanny_applications').delete().eq('id', app)
    if (operator) await db.auth.admin.deleteUser(operator)
  }
}
