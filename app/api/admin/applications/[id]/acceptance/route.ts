import { NextRequest, NextResponse } from 'next/server'
import { requireAdminProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { loadAgreementSummary, type AgreementDetails } from '@/lib/nanny-onboarding'
import { NANNY_AGREEMENT_VERSION } from '@/lib/nanny-agreement-rules'
import { openWorkflow } from '@/lib/workflow-secrets'

export async function GET(request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  if (!(await requireAdminProfile())) return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const {id}=await params,db=createServerClient(),acceptance=await loadAgreementSummary(db,id)
    if (!acceptance) return NextResponse.json({error:'No current acceptance is recorded.'},{status:404})
    let details: AgreementDetails | undefined
    if (request.nextUrl.searchParams.get('details') === 'full') {
      const row=await db.from('nanny_agreement_acceptances').select('details').eq('application_id',id).eq('version',NANNY_AGREEMENT_VERSION).single()
      if(row.error) throw new Error('Acceptance lookup failed')
      details=openWorkflow<AgreementDetails>(row.data.details)
    }
    return NextResponse.json({acceptance,details},{headers:{'Cache-Control':'private, no-store'}})
  } catch {return NextResponse.json({error:'Acceptance details could not be loaded. Please retry.'},{status:503})}
}
