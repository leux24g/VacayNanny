import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { ownNannyApplication } from '@/lib/nanny-onboarding'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) return new NextResponse('Sign in to view your documents.', { status: 401 })
  try {
    const { id } = await params, db = createServerClient()
    const result = await db.from('nanny_documents').select('application_id,storage_path,file_name,mime_type').eq('id', id).maybeSingle()
    if (result.error || !result.data?.application_id) return new NextResponse('Document not found.', { status: 404 })
    const doc = result.data, app = await ownNannyApplication(db, profile, doc.application_id)
    if (!app) return new NextResponse('Document not found.', { status: 404 })
    const [bucket, ...segments] = doc.storage_path.split('/')
    if (bucket !== 'nanny-documents' || !segments.length) return new NextResponse('Document not found.', { status: 404 })
    const downloaded = await db.storage.from(bucket).download(segments.join('/'))
    if (downloaded.error || !downloaded.data) throw new Error('Download failed')
    return new NextResponse(downloaded.data, { headers: {
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${String(doc.file_name || 'my-document').replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } })
  } catch { return new NextResponse('Your document could not be loaded. Please retry.', { status: 503 }) }
}
