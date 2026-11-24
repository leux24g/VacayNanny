import {NextRequest,NextResponse} from 'next/server'
import {randomUUID} from 'node:crypto'
import {getCurrentProfile} from '@/lib/auth'
import {createServerClient} from '@/lib/supabase/service'
import {ownNannyApplication} from '@/lib/nanny-onboarding'
import {prepareApplicationFiles} from '@/lib/application-files'
import {enqueueJob} from '@/lib/workflow-jobs'
import {limitRoute} from '@/lib/rate-limit'

export async function POST(request:NextRequest) {
 const profile=await getCurrentProfile()
 if(!profile)return NextResponse.json({error:'Sign in again to submit your document.'},{status:401})
 try{
  if(Number(request.headers.get('content-length')||0)>4.2*1024*1024)return NextResponse.json({error:'Choose a file up to 4 MB.'},{status:413})
  const db=createServerClient(),app=await ownNannyApplication(db,profile)
  if(!app)return NextResponse.json({error:'Submit your application first.'},{status:404})
  if(['approved','rejected'].includes(app.status))return NextResponse.json({error:'Contact the team to update documents after an application decision.'},{status:409})
  const blocked=await limitRoute(request,db,'agreement',{email:profile.email});if(blocked)return blocked
  const form=await request.formData(),file=form.get('document'),kind=String(form.get('kind')||'')
  if(!(file instanceof File)||!file.size||file.size>4*1024*1024||!['photo','id_front','id_back','selfie','cogc','passport','certificate'].includes(kind))return NextResponse.json({error:'Choose a document type and a file up to 4 MB.'},{status:400})
  const prepared=await prepareApplicationFiles(new Map([[kind,file]]))
  if('error'in prepared)return NextResponse.json({error:prepared.error},{status:400})
  const document=prepared.files[0],path=`${app.id}/supplemental/${randomUUID()}`
  await enqueueJob(db,'application_upload_cleanup',{entries:[{bucket:'nanny-documents',path}]},`supplemental-document:${path}`)
  const upload=await db.storage.from('nanny-documents').upload(path,document.buffer,{contentType:document.contentType,upsert:false})
  if(upload.error)throw new Error('Upload failed')
  const saved=await db.rpc('add_nanny_document',{p_application:app.id,p_actor:profile.id,p_document:{kind:document.kind,storage_path:`nanny-documents/${path}`,file_name:document.fileName,mime_type:document.contentType}})
  if(saved.error){if(/^(23|P0001|42501)/.test(saved.error.code||''))await db.storage.from('nanny-documents').remove([path]);return NextResponse.json({error:'The application may have changed. Refresh before retrying your document upload.'},{status:409})}
  return NextResponse.json({success:true},{headers:{'Cache-Control':'no-store'}})
 }catch{return NextResponse.json({error:'Could not submit your document. Keep your file and retry.'},{status:503})}
}
