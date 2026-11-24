import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireAdminProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { enqueueJob } from '@/lib/workflow-jobs'

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const admin=await requireAdminProfile()
  if(!admin)return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    if(Number(request.headers.get('content-length')||0)>4.2*1024*1024)return NextResponse.json({error:'Choose a PDF up to 4 MB.'},{status:413})
    const {id}=await params,form=await request.formData(),file=form.get('agreement'),db=createServerClient()
    if(form.get('reviewed')!=='true')return NextResponse.json({error:'Confirm review of the required details and both nanny and witness signatures.'},{status:400})
    const app=await db.from('nanny_applications').select('status,agreement_submitted_path').eq('id',id).maybeSingle()
    if(app.error)throw new Error('Application lookup failed')
    if(app.data?.status!=='approved')return NextResponse.json({error:'Approve the application first.'},{status:409})
    let path:string|undefined, uploaded=false
    if(file instanceof File && file.size>0) {
      if(file.size>4*1024*1024)return NextResponse.json({error:'The signed PDF must be up to 4 MB.'},{status:400})
      const bytes=Buffer.from(await file.arrayBuffer())
      if(bytes.subarray(0,5).toString()!=='%PDF-')return NextResponse.json({error:'Upload a PDF file.'},{status:400})
      path=`${id}/agreements/${randomUUID()}.pdf`
      await enqueueJob(db,'application_upload_cleanup',{entries:[{bucket:'nanny-documents',path}]},`agreement-upload-cleanup:${path}`)
      const stored=await db.storage.from('nanny-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false})
      if(stored.error)throw new Error('Storage failed')
      uploaded=true
    } else if(form.get('useSubmitted')==='true')path=app.data.agreement_submitted_path || undefined
    if(!path)return NextResponse.json({error:'Choose the nanny’s submitted copy or upload the signed PDF.'},{status:400})
    const recorded=await db.rpc('record_nanny_agreement',{p_id:id,p_actor:admin.id,p_path:path})
    if(recorded.error) {
      if(uploaded && /^(23|P0001|42501)/.test(recorded.error.code||''))await db.storage.from('nanny-documents').remove([path])
      return NextResponse.json({error:'The agreement could not be reviewed. Check current acceptance, approval and whether the submitted file changed.'},{status:409})
    }
    return NextResponse.json({success:true})
  } catch {return NextResponse.json({error:'Could not record agreement review. Please refresh before retrying.'},{status:503})}
}

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  if(!(await requireAdminProfile()))return new NextResponse('Unauthorized',{status:401})
  try {
    const {id}=await params,db=createServerClient()
    const app=await db.from('nanny_applications').select('agreement_signed_path,agreement_submitted_path').eq('id',id).maybeSingle()
    if(app.error)throw new Error('Application lookup failed')
    const path=request.nextUrl.searchParams.get('submitted')==='true'?app.data?.agreement_submitted_path:app.data?.agreement_signed_path
    if(!path)return new NextResponse('Agreement not found.',{status:404})
    const file=await db.storage.from('nanny-documents').download(path)
    if(file.error||!file.data)throw new Error('Download failed')
    return new NextResponse(file.data,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="signed-vacaynanny-agreement.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
  } catch {return new NextResponse('Agreement download is temporarily unavailable.',{status:503})}
}
