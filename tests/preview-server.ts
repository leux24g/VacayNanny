// An isolated Supabase fixture: browser tests never read or mutate production data.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { demoCatalog } from '../lib/catalog-data'

const reviewMode = process.argv.includes('--review')
const adminId = '33333333-3333-4333-8333-333333333333'
const nannyId = '22222222-2222-4222-8222-222222222222'
const bookingId = '11111111-1111-4111-8111-111111111111'
const catalog = demoCatalog()
const created = new Date().toISOString()
const future = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const user = {
  id: adminId,
  email: 'operator@example.test',
  role: 'authenticated',
  aud: 'authenticated',
  created_at: created,
  email_confirmed_at: created,
  confirmation_sent_at: created,
  app_metadata: { provider: 'email' },
  user_metadata: { full_name: 'Test Operator' },
}
const nanny = {
  id: nannyId,
  slug: 'test-nanny',
  display_name: 'Test Nanny',
  user_id: null,
  application_id: null,
  tier: 'bronze',
  daily_rate_kes: 2200,
  is_active: true,
  photo_url: null,
  bio: 'An experienced childcare professional.',
  county: 'Kwale',
  town: 'Diani',
  destinations: ['Diani'],
  languages: ['English', 'Swahili'],
  tags: ['Creative play'],
  age_groups: ['3–5'],
  services: [],
  certifications: [],
  available_days: [],
  rating_avg: 0,
  review_count: 0,
  safeguarding_completed_at: null,
  willing_to_travel: 'local',
  created_at: created,
}
const booking = {
  id: bookingId,
  parent_id: null,
  parent_name: 'Test Family',
  email: 'family@example.test',
  phone: '+254700000000',
  nanny_id: nannyId,
  destination: 'Diani',
  check_in: future(28),
  check_out: future(30),
  children_count: '1',
  youngest_age: '3–5 years',
  nannies_needed: '1',
  tier: 'bronze',
  status: 'confirmed',
  care_type: 'standard',
  total_amount_kes: 4400,
  parent_confirmed_at: created,
  nanny_response: 'accepted',
  payment_status: 'unpaid',
  guest_access_token_hash: createHash('sha256')
    .update('a'.repeat(64))
    .digest('hex'),
  created_at: created,
  nannies: nanny,
}
const tables: Record<string, unknown[]> = {
  profiles: [
    {
      id: adminId,
      role: 'admin',
      full_name: 'Test Operator',
      email: user.email,
      phone: null,
      created_at: created,
    },
  ],
  nannies: [nanny],
  bookings: [booking],
  nanny_applications: [],
  reviews: [],
  contact_messages: [],
  waitlist: [],
  payment_attempts: [],
  destinations: [
    {
      id: 'diani',
      slug: 'diani',
      name: 'Diani',
      country: 'Kenya',
      is_active: true,
      sort_order: 0,
      image_url: null,
    },
  ],
  pricing_tiers: catalog.tiers.map((t) => ({
    code: t.code,
    label: t.label,
    card_title: t.cardTitle,
    badge: t.badge,
    description: t.description,
    period: t.period,
    daily_rate_kes: t.dailyRateKes,
    features: t.features,
    cta: t.cta,
    sort_order: t.sortOrder,
    is_active: true,
  })),
  care_offerings: catalog.care.map((c) => ({
    code: c.code,
    label: c.label,
    hours: c.hours,
    multiplier: c.multiplier,
    hint: c.hint,
    sort_order: c.sortOrder,
    is_active: true,
  })),
  pricing_addons: catalog.addons.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    description: a.description,
    pricing_mode: a.pricingMode,
    amount_kes: a.amountKes,
    is_active: true,
  })),
  business_policies: [
    {
      id: 1,
      standard_shift_hours: 8,
      replacement_sla_hours: 2,
      max_nannies: 4,
    },
  ],
  faqs: catalog.faqs.map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    is_active: true,
    sort_order: f.sortOrder,
  })),
  homepage_steps: [],
}
function fixtureSession() {
  const payload = {
    sub: adminId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  const token = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'fixture-signature',
  ].join('.')
  return {
    access_token: token,
    refresh_token: 'fixture-refresh-token',
    expires_at: payload.exp,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1:4748')
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') {
    res.end()
    return
  }
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk.toString()
    let credentials
    try {
      credentials = JSON.parse(body)
    } catch {
      res.statusCode = 400
      res.end('{}')
      return
    }
    if (
      credentials.email !== user.email ||
      credentials.password !== 'local-review'
    ) {
      res.statusCode = 400
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
        }),
      )
      return
    }
    res.end(JSON.stringify(fixtureSession()))
    return
  }
  if (url.pathname === '/auth/v1/user') {
    res.end(JSON.stringify(user))
    return
  }
  if (url.pathname === '/auth/v1/admin/users') {
    res.end(JSON.stringify({ users: [user], aud: 'authenticated' }))
    return
  }
  if (url.pathname === '/rest/v1/rpc/consume_rate_limit') {
    res.end('true')
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end(
      JSON.stringify({
        message: 'Writes are disabled in browser test fixtures.',
      }),
    )
    return
  }
  const table = url.pathname.split('/').at(-1) || ''
  let rows = tables[table] || []
  for (const [key, value] of url.searchParams) {
    if (value.startsWith('eq.'))
      rows = rows.filter(
        (row) =>
          String((row as Record<string, unknown>)[key]) === value.slice(3),
      )
    if (value.startsWith('in.'))
      rows = rows.filter((row) =>
        value
          .slice(4, -1)
          .split(',')
          .includes(String((row as Record<string, unknown>)[key])),
      )
  }
  res.setHeader(
    'Content-Range',
    `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
  )
  res.end(
    JSON.stringify(
      req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null : rows,
    ),
  )
})
server.listen(4748, '127.0.0.1', () => {
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3101',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4748',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        NEXT_PUBLIC_SITE_URL: 'http://localhost:3101',
        PAYSTACK_SECRET_KEY: '',
        PAYSTACK_WEBHOOK_SECRET: '',
        RESEND_API_KEY: '',
        EMAIL_DELIVERY_MODE: 'disabled',
        CRON_SECRET: '',
        VACAYNANNY_TEST_DIST: '.next-tests',
      },
    },
  )
  if (reviewMode) {
    console.log('Isolated UI review: http://localhost:3101')
    console.log('Operations: http://localhost:3101/login?next=/admin')
    console.log('Fixture login: operator@example.test / local-review')
    console.log(
      'Uses local sample data. Database writes, email and payments are disabled.',
    )
  }
  const close = () => {
    child.kill('SIGTERM')
    server.close()
    setTimeout(() => process.exit(), 1000).unref()
  }
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
  child.on('exit', () => {
    server.close()
    process.exit()
  })
})
