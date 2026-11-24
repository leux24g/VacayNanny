import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getCurrentProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { loadAgreementSummary, ownNannyApplication } from '@/lib/nanny-onboarding'
import { enqueueJob } from '@/lib/workflow-jobs'
import { limitRoute } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Sign in again to submit your signed agreement.' }, { status: 401 })
  try {
    if (Number(request.headers.get('content-length') || 0) > 4.2 * 1024 * 1024) return NextResponse.json({ error: 'Choose a PDF up to 4 MB.' }, { status: 413 })
    const form = await request.formData(), file = form.get('agreement')
    if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024 || form.get('signed') !== 'true')
      return NextResponse.json({ error: 'Choose a PDF up to 4 MB and confirm that you and your witness have signed it.' }, { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.subarray(0, 5).toString() !== '%PDF-') return NextResponse.json({ error: 'Upload a PDF file.' }, { status: 400 })
    const db = createServerClient(), app = await ownNannyApplication(db, profile)
    const blocked = await limitRoute(request,db,'agreement',{email:profile.email})
    if(blocked)return blocked
    if (!app || app.status !== 'approved') return NextResponse.json({ error: 'Your application needs approval before you return the signed agreement.' }, { status: 409 })
    if (!(await loadAgreementSummary(db, app.id))?.current) return NextResponse.json({ error: 'Read and accept the current agreement first.' }, { status: 409 })
    const path = `${app.id}/agreements/submitted-${randomUUID()}.pdf`
    await enqueueJob(db,'application_upload_cleanup',{entries:[{bucket:'nanny-documents',path}]},`agreement-upload-cleanup:${path}`)
    const uploaded = await db.storage.from('nanny-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
    if (uploaded.error) throw new Error('Upload failed')
    const saved = await db.rpc('submit_nanny_signed_agreement',{p_application:app.id,p_actor:profile.id,p_path:path})
    if (saved.error) {
      if(/^(23|P0001|42501)/.test(saved.error.code || ''))await db.storage.from('nanny-documents').remove([path])
      // An unknown response may have committed: cleanup checks ownership before deleting.
      throw new Error('Save failed')
    }
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Could not submit the signed agreement. Please keep your PDF and retry.' }, { status: 503 }) }
}
