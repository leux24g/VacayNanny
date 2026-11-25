// An isolated Supabase fixture: browser tests never read or mutate production data.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createCipheriv,createHash,randomBytes,randomUUID } from 'node:crypto'
import { NANNY_AGREEMENT_SHA256,NANNY_AGREEMENT_VERSION } from '../lib/nanny-agreement-rules'
import { smtpFixture } from './smtp-fixture'
import { demoCatalog } from '../lib/catalog-data'

async function main() {
  const smtp = await smtpFixture()
  const verifiedSessions = new Set<string>()
  const otpChallenges = new Map<string, Record<string, unknown>>()
  const fixtureKey='portal-fixture-synthetic-key'
  function sealed(value:unknown) { const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(fixtureKey).digest(),iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')} }
  const reviewMode = process.argv.includes('--review')
  const adminId = '33333333-3333-4333-8333-333333333333'
  const parentId = '44444444-4444-4444-8444-444444444444'
  const nannyUserId = '55555555-5555-4555-8555-555555555555'
  const applicationId = '66666666-6666-4666-8666-666666666666'
  const ownApplicationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const nannyId = '22222222-2222-4222-8222-222222222222'
  const bookingId = '11111111-1111-4111-8111-111111111111'
  const careBookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
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
  const users = [
    user,
    {
      ...user,
      id: parentId,
      email: 'family@example.test',
      user_metadata: { full_name: 'Test Family' },
    },
    {
      ...user,
      id: nannyUserId,
      email: 'nanny@example.test',
      user_metadata: { full_name: 'Test Nanny' },
    },
  ]
  const nanny = {
    id: nannyId,
    slug: 'test-nanny',
    display_name: 'Test Nanny',
    user_id: nannyUserId,
    application_id: ownApplicationId,
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
    available_days: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    rating_avg: 0,
    review_count: 0,
    safeguarding_completed_at: null,
    willing_to_travel: 'local',
    created_at: created,
  }
  const booking = {
    id: bookingId,
    parent_id: parentId,
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
    guest_access_token_hash: createHash('sha256').update('a'.repeat(64)).digest('hex'),
    created_at: created,
    nannies: nanny,
  }
  const tables: Record<string, unknown[]> = {
    profiles: users.map((identity, index) => ({
      id: identity.id,
      role: ['admin', 'parent', 'nanny'][index],
      full_name: identity.user_metadata.full_name,
      email: index === 1 ? 'unrelated@example.test' : identity.email,
      phone: null,
      avatar_url: null,
      created_at: created,
    })),
    nannies: [nanny],
    bookings: [
      {
        ...booking,
        booking_assignments: [
          { slot: 1, nanny_id: nannyId, response: 'accepted', nannies: nanny },
        ],
      },
      {
        ...booking,
        id: careBookingId,
        parent_name: 'Completion Test Family',
        destination: 'Nairobi',
        status: 'in_progress',
        payment_status: 'not_required',
        booking_assignments: [
          { slot: 1, nanny_id: nannyId, response: 'accepted', nannies: nanny },
        ],
      },
    ],
    booking_assignments: [
      {
        booking_id: bookingId,
        slot: 1,
        nanny_id: nannyId,
        response: 'accepted',
        nannies: nanny,
      },
      {
        booking_id: careBookingId,
        slot: 1,
        nanny_id: nannyId,
        response: 'accepted',
        nannies: nanny,
      },
    ],
    booking_care_slots: [],
    workflow_jobs: [],
    ops_tasks: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'replacement_overdue',
        summary: 'Synthetic replacement deadline follow-up.',
        status: 'open',
        assigned_to: null,
        created_at: created,
        booking_id: bookingId,
      },
    ],
    nanny_applications: [
      {
        id: applicationId,
        user_id: null,
        full_name: 'Test Applicant',
        email: 'applicant.with.a.long.address.for.layout.review@example.test',
        phone: '+254700000000',
        country_code: '+254',
        date_of_birth: '1990-01-01',
        gender: 'Female',
        county: 'Kwale',
        town: 'Diani',
        national_id_number: 'SYNTHETIC-ID-1234',
        kra_pin: null,
        cogc_status: 'yes',
        cogc_date: null,
        experience_years: '4',
        languages: ['English', 'Swahili'],
        age_groups: ['3–5'],
        services: ['Daytime care'],
        bio: 'Synthetic application for local layout review only.',
        certifications: ['First Aid'],
        swimming: 'Yes',
        cooking: 'Yes',
        tutoring: null,
        driving: null,
        special_needs: null,
        available_days: ['Monday', 'Tuesday'],
        earliest_start: '08:00',
        latest_end: '17:00',
        willing_to_travel: 'kenya',
        preferred_locations: ['Diani'],
        comfortable_pets: 'Yes',
        comfortable_multiple: 'Yes',
        status: 'reviewing',
        estimated_tier: 'silver',
        admin_notes: '',
        interview_at: null,
        consent_background: true,
        consent_terms: true,
        consent_accuracy: true,
        agreement_signed_path: null,
        agreement_reviewed_at: null,
        agreement_reviewed_by: null,
        approval_email_sent_at: null,
        created_at: created,
      },
    ],
    nanny_references: [
      {
        id: 'reference-test',
        application_id: applicationId,
        full_name: 'Test Reference',
        relationship: 'Former employer',
        phone: '+254700000000',
        email: 'reference@example.test',
        country_code: '+254',
        permission_to_contact: 'Yes',
        sort_order: 1,
      },
    ],
    nanny_documents: [],
    booking_messages: [
      {
        id: 'message-test',
        booking_id: bookingId,
        sender_id: parentId,
        sender_role: 'parent',
        body: 'Looking forward to our trip. Here are our arrival details for the family booking.',
        created_at: created,
      },
    ],
    reviews: [],
    contact_messages: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        name: 'Other Family',
        email: 'unrelated@example.test',
        family_id: null,
        subject: 'Private care',
        message: 'OTHER FAMILY PRIVATE CARE PLAN',
        care_service: 'Adult & Elderly Care',
        care_status: 'quoted',
        quote_summary: 'OTHER FAMILY PRIVATE CARE PLAN',
        quote_amount_kes: 9000,
        quote_expires_at: `${future(7)}T20:59:59Z`,
        quote_version: 1,
        guest_access_token_hash: createHash('sha256')
          .update('e'.repeat(64))
          .digest('hex'),
        created_at: created,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Specialist Test Family',
        email: 'family@example.test',
        family_id: parentId,
        subject: 'Specialist care quote',
        message: 'Synthetic specialist care enquiry.',
        care_service: 'Professional Nursing Care',
        care_status: 'quoted',
        assigned_to: adminId,
        assessment_notes: 'PRIVATE ASSESSMENT MUST NEVER APPEAR TO FAMILY',
        provider_details: 'PRIVATE PROVIDER VERIFICATION RECORD',
        quote_summary: 'Qualified nursing support with an agreed daytime care schedule.',
        quote_amount_kes: 6000,
        quote_expires_at: `${future(7)}T20:59:59Z`,
        service_start: future(14),
        service_end: future(15),
        quote_version: 1,
        guest_access_token_hash: createHash('sha256')
          .update('d'.repeat(64))
          .digest('hex'),
        created_at: created,
      },
      {
        id: 'contact-test',
        name: 'Test Enquiry',
        email: 'family.with.a.long.address.for.layout.review@example.test',
        subject: 'A family trip with additional childcare requirements',
        message: 'Synthetic enquiry for local layout review only.',
        created_at: created,
      },
    ],
    waitlist: [
      {
        id: 'waitlist-test',
        email: 'waitlist@example.test',
        region: 'Zanzibar',
        created_at: created,
      },
    ],
    payment_attempts: [
      {
        id: 'payment-test',
        booking_id: bookingId,
        reference: 'VN-77777777-7777-4777-8777-777777777777',
        amount_subunit: 440000,
        currency: 'KES',
        status: 'pending',
        channel: null,
        authorization_url: null,
        created_at: created,
      },
    ],
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
  const originalApplication=tables.nanny_applications[0] as Record<string,unknown>
  const photoObjects=new Map<string,{bytes:Buffer;type:string}>()
  tables.nanny_applications.push({...originalApplication,id:ownApplicationId,user_id:nannyUserId,email:'nanny@example.test',full_name:'Test Nanny',status:'approved',agreement_signed_path:`${ownApplicationId}/agreements/reviewed.pdf`,agreement_reviewed_at:created,agreement_reviewed_by:adminId})
  tables.nanny_agreement_acceptances=[{application_id:applicationId,version:NANNY_AGREEMENT_VERSION,document_sha256:NANNY_AGREEMENT_SHA256,signer_name:'Test Applicant',accepted_at:created,details:sealed({fullName:'Test Applicant',nationalIdNumber:'SYNTHETIC-ID-1234',email:originalApplication.email,phone:'+254700000000',payoutMethod:'mpesa',payoutAccountName:'Test Applicant',payoutAccountNumber:'+254712345678',payoutBankName:''})},{application_id:ownApplicationId,version:NANNY_AGREEMENT_VERSION,document_sha256:NANNY_AGREEMENT_SHA256,signer_name:'Test Nanny',accepted_at:created,details:sealed({fullName:'Test Nanny',nationalIdNumber:'SYNTHETIC-ID-1234',email:'nanny@example.test',phone:'+254700000000',payoutMethod:'mpesa',payoutAccountName:'Test Nanny',payoutAccountNumber:'+254712345678',payoutBankName:''})}]
  tables.nanny_documents=[{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',application_id:ownApplicationId,kind:'id_front',storage_path:`nanny-documents/${ownApplicationId}/synthetic-id.pdf`,file_name:'synthetic-id.pdf',mime_type:'application/pdf'},{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',application_id:applicationId,kind:'cogc',storage_path:`nanny-documents/${applicationId}/synthetic-police.pdf`,file_name:'synthetic-police.pdf',mime_type:'application/pdf'}]
  const paidBookingId='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  tables.bookings.push({...booking,id:paidBookingId,destination:'Watamu',status:'completed',payment_status:'paid',paid_at:created,booking_assignments:[]})
  tables.payment_attempts.push({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',booking_id:paidBookingId,reference:'VN-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',amount_subunit:440000,currency:'KES',status:'success',authorization_url:'https://checkout.paystack.com/SENSITIVE-DO-NOT-EXPOSE',channel:'mobile_money',created_at:created,paid_at:created})
  function fixtureSession(identity = user, sessionId: string = randomUUID()) {
    const payload = {
      sub: identity.id,
      session_id: sessionId,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const token = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      Buffer.from('synthetic-fixture-signature-bytes').toString('base64url'),
    ].join('.')
    return {
      access_token: token,
      refresh_token: `fixture-refresh-${sessionId}:${identity.id}`,
      expires_at: payload.exp,
      expires_in: 3600,
      token_type: 'bearer',
      user: identity,
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
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const [sessionId, id] = String(credentials.refresh_token || '')
          .replace('fixture-refresh-', '')
          .split(':')
        const identity = users.find((u) => u.id === id)
        res.end(JSON.stringify(fixtureSession(identity || user, sessionId)))
        return
      }
      const identity = users.find((candidate) => candidate.email === credentials.email)
      if (!identity || credentials.password !== 'local-review') {
        res.statusCode = 400
        res.end(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Invalid login credentials',
          }),
        )
        return
      }
      res.end(JSON.stringify(fixtureSession(identity)))
      return
    }
    if (url.pathname === '/__otp') {
      res.end(
        JSON.stringify({
          code: smtp.messages.filter((m) => m.to === url.searchParams.get('email')).at(-1)
            ?.code,
        }),
      )
      return
    }
    if (
      url.pathname === '/auth/v1/admin/generate_link' ||
      url.pathname === '/auth/v1/verify' ||
      /^\/auth\/v1\/admin\/users\//.test(url.pathname)
    ) {
      let raw = ''
      for await (const chunk of req) raw += chunk.toString()
      const body = raw ? JSON.parse(raw) : {}
      const identity = users.find(
        (u) =>
          u.email === body.email ||
          `fixture-${u.id}` === body.token_hash ||
          url.pathname.endsWith('/' + u.id),
      )
      if (!identity) {
        res.statusCode = 400
        res.end('{}')
        return
      }
      res.end(
        JSON.stringify(
          url.pathname.endsWith('generate_link')
            ? {
                ...identity,
                action_link: 'https://example.test',
                hashed_token: `fixture-${identity.id}`,
                email_otp: 'unused-provider-code',
                verification_type: 'magiclink',
              }
            : url.pathname.endsWith('/verify')
              ? fixtureSession(identity)
              : identity,
        ),
      )
      return
    }
    if (
      [
        '/rest/v1/rpc/otp_email_user',
        '/rest/v1/rpc/issue_otp_challenge',
        '/rest/v1/rpc/consume_otp_challenge',
        '/rest/v1/otp_challenges',
      ].includes(url.pathname)
    ) {
      let raw = ''
      for await (const chunk of req) raw += chunk.toString()
      const b = raw ? JSON.parse(raw) : {}
      if (url.pathname.endsWith('otp_email_user'))
        res.end(JSON.stringify(users.find((u) => u.email === b.p_email)?.id || null))
      else if (url.pathname.endsWith('issue_otp_challenge')) {
        otpChallenges.set(b.p_id, { ...b, payload: b.p_payload })
        res.end(JSON.stringify(b.p_id))
      } else if (url.pathname.endsWith('consume_otp_challenge')) {
        const c = otpChallenges.get(b.p_id)
        if (c && c.p_purpose === b.p_purpose && c.p_hash === b.p_hash && !c.consumed_at) {
          c.consumed_at = true
          res.end(JSON.stringify({ ok: true, payload: c.payload }))
        } else res.end(JSON.stringify({ ok: false }))
      } else {
        const c = otpChallenges.get(url.searchParams.get('id')?.slice(3) || '')
        if (c) Object.assign(c, b)
        res.end('null')
      }
      return
    }
    if (url.pathname === '/auth/v1/user') {
      try {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '')
        const claims = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64url').toString(),
        )
        const identity = users.find((candidate) => candidate.id === claims.sub)
        if (!identity) throw new Error('Unknown local fixture user')
        res.end(JSON.stringify(identity))
      } catch {
        res.statusCode = 401
        res.end(JSON.stringify({ message: 'No fixture session' }))
      }
      return
    }
    if (url.pathname === '/auth/v1/admin/users') {
      res.end(JSON.stringify({ users, aud: 'authenticated' }))
      return
    }
    if (url.pathname === '/rest/v1/rpc/record_email_otp_session') {
      let raw = ''
      for await (const chunk of req) raw += chunk.toString()
      const body = JSON.parse(raw)
      verifiedSessions.add(body.p_session)
      res.end('true')
      return
    }
    if (url.pathname === '/rest/v1/rpc/has_email_otp_session') {
      try {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '')
        const claims = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64url').toString(),
        )
        res.end(JSON.stringify(verifiedSessions.has(claims.session_id)))
      } catch {
        res.end('false')
      }
      return
    }
    if(url.pathname==='/__legacy-fixture') {
      const app=(tables.nanny_applications as Array<Record<string,unknown>>).find(a=>a.id===ownApplicationId)!
      app.legacy_nanny_id=url.searchParams.get('enabled')==='1'?nannyId:null
      app.legacy_completed_at=null
      res.end('{}');return
    }
    if(url.pathname==='/rest/v1/rpc/operations_health') {
      res.end(JSON.stringify({database:true,workerObserved:true,queue:{ready:0,scheduled:0,processing:0,stale:0,failed:0,oldestReadyAt:null,lastSuccessAt:new Date().toISOString(),lastRun:{status:'completed'}}}));return
    }
    if(url.pathname==='/__tier-fixtures') {
      const list=tables.nannies as Array<Record<string,unknown>>
      tables.nannies=list.filter(n=>!String(n.slug).startsWith('qualification-fixture-'))
      if(url.searchParams.get('enabled')==='1')for(const tier of ['silver','gold'])tables.nannies.push({...nanny,id:tier==='silver'?'12345678-1234-4123-8123-123456789012':'12345678-1234-4123-8123-123456789013',slug:`qualification-fixture-${tier}`,display_name:`Qualified ${tier}`,tier,daily_rate_kes:tier==='silver'?3200:4200,safeguarding_completed_at:tier==='gold'?created:null,user_id:null})
      res.end('{}');return
    }
    if(url.pathname==='/rest/v1/rpc/enqueue_workflow_job'){for await(const chunk of req)void chunk;res.end(JSON.stringify(randomUUID()));return}
    if(req.method==='POST'&&url.pathname.startsWith('/storage/v1/object/nanny-photos/')){
      const pieces:Buffer[]=[];for await(const chunk of req)pieces.push(Buffer.from(chunk));const path=url.pathname.slice('/storage/v1/object/nanny-photos/'.length)
      photoObjects.set(path,{bytes:Buffer.concat(pieces),type:String(req.headers['content-type']||'image/jpeg')});res.end(JSON.stringify({Id:randomUUID(),Key:`nanny-photos/${path}`}));return
    }
    if(req.method==='GET'&&url.pathname.startsWith('/storage/v1/object/public/nanny-photos/')){
      const photo=photoObjects.get(url.pathname.slice('/storage/v1/object/public/nanny-photos/'.length));if(!photo){res.statusCode=404;res.end('{}');return}res.setHeader('Content-Type',photo.type);res.end(photo.bytes);return
    }
    if(url.pathname==='/rest/v1/rpc/update_nanny_photo'){
      let raw='';for await(const chunk of req)raw+=chunk.toString();const body=JSON.parse(raw),row=(tables.nannies as Array<Record<string,unknown>>).find(n=>n.id===body.p_nanny)
      if(!row||(!users.some(u=>u.id===body.p_actor&&u.id===adminId)&&row.user_id!==body.p_actor)){res.statusCode=403;res.end(JSON.stringify({message:'Forbidden'}));return}
      row.photo_url=body.p_photo_url;res.end(JSON.stringify(row.photo_url));return
    }
    if (url.pathname === '/rest/v1/rpc/consume_rate_limit') {
      res.end('true')
      return
    }
    if(['/rest/v1/rpc/nanny_signup_application','/rest/v1/rpc/nanny_agreement_is_current','/rest/v1/rpc/claim_nanny_applications','/rest/v1/rpc/workflow_queue_health'].includes(url.pathname)) {
      let raw='';for await(const chunk of req)raw+=chunk.toString();const body=raw?JSON.parse(raw):{}
      const apps=tables.nanny_applications as Array<Record<string,unknown>>,accepted=tables.nanny_agreement_acceptances as Array<Record<string,unknown>>
      if(url.pathname.endsWith('workflow_queue_health'))res.end(JSON.stringify({ready:0,scheduled:0,processing:0,stale:0,failed:0,oldestReadyAt:null,lastSuccessAt:created,workerStale:false,lastRun:{status:'completed',startedAt:created,finishedAt:created,processed:0,failed:0,error:null}}))
      else if(url.pathname.endsWith('nanny_signup_application'))res.end(JSON.stringify(apps.find(a=>String(a.email).toLowerCase()===String(body.p_email).toLowerCase() && accepted.some(c=>c.application_id===a.id))?.id || null))
      else if(url.pathname.endsWith('nanny_agreement_is_current'))res.end(JSON.stringify(accepted.some(c=>c.application_id===body.p_application)))
      else res.end(JSON.stringify(apps.filter(a=>String(a.email).toLowerCase()===String(body.p_verified_email).toLowerCase() && (a.user_id===null || a.user_id===body.p_actor) && accepted.some(c=>c.application_id===a.id)).length))
      return
    }
    if(req.method==='GET' && url.pathname.startsWith('/storage/v1/object/')) {res.setHeader('Content-Type','application/pdf');res.end('%PDF-1.4\nSYNTHETIC LOCAL TEST DOCUMENT ONLY\n%%EOF');return}
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
          (row) => String((row as Record<string, unknown>)[key]) === value.slice(3),
        )
      if (value === 'is.null')
        rows = rows.filter((row) => (row as Record<string, unknown>)[key] == null)
      if (value === 'not.is.null')
        rows = rows.filter((row) => (row as Record<string, unknown>)[key] != null)
      if (value.startsWith('ilike.')) {
        // The app uses ilike for exact, escaped email matching.
        const expected = value
          .slice(6)
          .replace(/\\([\\%_])/g, '$1')
          .toLowerCase()
        rows = rows.filter(
          (row) =>
            String((row as Record<string, unknown>)[key] ?? '').toLowerCase() ===
            expected,
        )
      }
      if (value.startsWith('in.'))
        rows = rows.filter((row) =>
          value
            .slice(4, -1)
            .split(',')
            .includes(String((row as Record<string, unknown>)[key])),
        )
    }
    res.setHeader('Content-Range', `0-${Math.max(rows.length - 1, 0)}/${rows.length}`)
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
          PAYSTACK_MODE: 'uat',
          PAYSTACK_WEBHOOK_SECRET: '',
          RESEND_API_KEY: '',
          EMAIL_DELIVERY_MODE: 'send',
          EMAIL_PROVIDER: 'smtp',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: String(smtp.port),
          SMTP_USER: 'local-fixture@example.test',
          SMTP_PASSWORD: 'synthetic-only',
          CRON_SECRET: '',
          NOTIFICATION_ENCRYPTION_KEY:fixtureKey,
          VACAYNANNY_TEST_DIST: '.next-tests',
        },
      },
    )
    if (reviewMode) {
      console.log('Isolated UI review: http://localhost:3101')
      console.log('Operations: http://localhost:3101/login?next=/admin')
      console.log(
        'Fixture login: operator@example.test; read its code at http://127.0.0.1:4748/__otp?email=operator@example.test',
      )
      console.log(
        'Uses local sample data. Database writes, email and payments are disabled.',
      )
    }
    const close = () => {
      void smtp.close()
      child.kill('SIGTERM')
      server.close()
      setTimeout(() => process.exit(), 1000).unref()
    }
    process.on('SIGTERM', close)
    process.on('SIGINT', close)
    child.on('exit', () => {
      void smtp.close()
      server.close()
      process.exit()
    })
  })
}
main().catch(() => {
  console.error('Local review server failed to start.')
  process.exitCode = 1
})
