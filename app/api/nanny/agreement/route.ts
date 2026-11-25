import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { applicationAcceptance, ownNannyApplication } from '@/lib/nanny-onboarding'
import { validateAgreement } from '@/lib/nanny-agreement-rules'
import { limitRoute } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Sign in again to accept your agreement.' }, { status: 401 })
  try {
    const body = await request.json(), db = createServerClient()
    const blocked=await limitRoute(request,db,'agreement',{email:profile.email})
    if(blocked)return blocked
    const app = await ownNannyApplication(db, profile)
    if (!app) return NextResponse.json({ error: 'Complete your nanny application first.' }, { status: 404 })
    if(app.legacy_nanny_id&&!app.legacy_completed_at)return NextResponse.json({error:'Complete your existing nanny onboarding, documents and references before recording agreement acceptance.'},{status:409})
    if (!app.national_id_number || !app.phone || !app.email) return NextResponse.json({ error: 'Your identity and contact details must be completed before acceptance. Contact our team.' }, { status: 409 })
    const errors = validateAgreement(body, app.full_name)
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 })
    const acceptance = applicationAcceptance({ ...body, fullName: app.full_name, nationalIdNumber: app.national_id_number, email: app.email, phone: app.phone, countryCode: app.country_code })
    const saved = await db.rpc('accept_nanny_agreement', { p_application: app.id, p_actor: profile.id, p_acceptance: acceptance })
    if (saved.error) return NextResponse.json({ error: 'Your agreement could not be recorded. Please retry or contact our team.' }, { status: 409 })
    const linked = await db.rpc('claim_nanny_applications', { p_actor: profile.id, p_verified_email: profile.email })
    if (linked.error) throw new Error('Could not link application')
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Could not save your acceptance. Your details remain on this page; please retry.' }, { status: 503 })
  }
}

export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return new NextResponse('Sign in to view your agreement.', { status: 401 })
  try {
    const db = createServerClient(), app = await ownNannyApplication(db, profile)
    const path = app?.agreement_signed_path || app?.agreement_submitted_path
    if (!path) return new NextResponse('No signed agreement has been submitted yet.', { status: 404 })
    const file = await db.storage.from('nanny-documents').download(path)
    if (file.error || !file.data) throw new Error('Download failed')
    return new NextResponse(file.data, { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="my-vacaynanny-agreement.pdf"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } })
  } catch { return new NextResponse('Your agreement could not be loaded. Please retry.', { status: 503 }) }
}
