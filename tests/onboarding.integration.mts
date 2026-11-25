import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'
import {localCredentials} from '../scripts/local-database.mjs'
import {smtpFixture} from './smtp-fixture'
import {requestAuthOtp,consumeAuthOtp,establishOtpSession} from '../lib/auth-otp'
import {applicationAcceptance,loadAgreementSummary} from '../lib/nanny-onboarding'
import {completeApplication} from './fixtures/application'
import {NANNY_AGREEMENT_VERSION} from '../lib/nanny-agreement-rules'
let db:SupabaseClient,auth:SupabaseClient,smtp:Awaited<ReturnType<typeof smtpFixture>>
const savedEnv={...process.env},address=`agreement-${randomUUID()}@example.test`,appId=randomUUID(),users:string[]=[],jobs:string[]=[]
before(async()=>{
 const local=await localCredentials();db=createClient(local.url,local.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});auth=createClient(local.url,local.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});smtp=await smtpFixture()
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:local.url,NEXT_PUBLIC_SUPABASE_ANON_KEY:local.anonKey,SUPABASE_SERVICE_ROLE_KEY:local.serviceKey,NOTIFICATION_ENCRYPTION_KEY:'onboarding-integration-only',EMAIL_PROVIDER:'smtp',EMAIL_DELIVERY_MODE:'send',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.port),SMTP_USER:'local@example.test',SMTP_PASSWORD:'synthetic-only'})
})
after(async()=>{
 await db.from('ops_tasks').delete().eq('dedupe_key',`document-review:${appId}`)
 const documentJobs=await db.from('workflow_jobs').select('id').like('dedupe_key',`nanny-document:nanny-documents/${appId}/%`);jobs.push(...(documentJobs.data||[]).map(r=>r.id))
 await db.from('nanny_documents').delete().eq('application_id',appId);await db.from('nanny_references').delete().eq('application_id',appId);await db.from('workflow_audit').delete().eq('entity_id',appId);await db.from('nanny_applications').delete().eq('id',appId)
 if(jobs.length)await db.from('workflow_jobs').delete().in('id',jobs)
 for(const id of users)await db.auth.admin.deleteUser(id)
 await smtp.close();process.env=savedEnv
})
test('nanny signup without accepted onboarding creates no Auth account and sends no code',async()=>{
 await assert.rejects(requestAuthOtp(db,address,'signup','Agreement Test Nanny','nanny','Strong-new-password-123!'),/accept the current agreement/)
 assert.equal((await db.rpc('otp_email_user',{p_email:address})).data,null);assert.equal(smtp.messages.length,0)
})
test('complete application acceptance is atomic, immutable on replay, and private to server code',async()=>{
 const body={...completeApplication,fullName:'Agreement Test Nanny',agreementSignerName:'Agreement Test Nanny',email:address}
 const row={id:appId,submission_key:randomUUID(),full_name:body.fullName,email:address,date_of_birth:body.dateOfBirth,national_id_number:body.nationalIdNumber,phone:body.phone,languages:body.languages,age_groups:body.ageGroups,services:body.services,certifications:[],available_days:body.availableDays,preferred_locations:[],estimated_tier:'bronze',consent_background:true,consent_terms:true,consent_accuracy:true}
 const docs=['photo','id_front','id_back','selfie'].map(kind=>({kind,storage_path:`local-tests/${appId}/${kind}.jpg`}))
 const refs=[{full_name:'Reference One',sort_order:1},{full_name:'Reference Two',sort_order:2}]
 const rejected=await db.rpc('save_complete_application',{p_row:row,p_references:refs,p_documents:docs});assert.ok(rejected.error);assert.equal((await db.from('nanny_applications').select('id').eq('id',appId)).data!.length,0)
 const accepted=await db.rpc('save_complete_application',{p_row:{...row,agreement_acceptance:applicationAcceptance(body)},p_references:refs,p_documents:docs});assert.ifError(accepted.error)
 const summary=await loadAgreementSummary(db,appId);assert.equal(summary!.version,NANNY_AGREEMENT_VERSION);assert.equal(summary!.signer_name,body.fullName);assert.ok(summary!.accepted_at);assert.equal(summary!.payout.maskedNumber,'•••• 5678')
 const replay=await db.rpc('save_complete_application',{p_row:{...row,agreement_acceptance:applicationAcceptance({...body,payoutAccountNumber:'+254711111111'})},p_references:refs,p_documents:docs});assert.ifError(replay.error);assert.equal((await loadAgreementSummary(db,appId))!.payout.maskedNumber,'•••• 5678')
 assert.ok((await auth.from('nanny_agreement_acceptances').select('*')).error)
 assert.ok((await auth.rpc('nanny_signup_application',{p_email:address})).error)
 assert.ok((await auth.rpc('accept_nanny_agreement',{p_application:appId,p_actor:randomUUID(),p_acceptance:applicationAcceptance(body)})).error)
})
test('email verification precedes Auth account creation and only accepted applications receive the nanny role',async()=>{
 const challenge=await requestAuthOtp(db,address,'signup','Agreement Test Nanny','nanny','Strong-new-password-123!')
 assert.equal((await db.rpc('otp_email_user',{p_email:address})).data,null,'No account exists before email verification.')
 const code=smtp.messages.at(-1)!.code!;assert.ok(code)
 const payload=await consumeAuthOtp(db,challenge,'signup',code);assert.ok(payload)
 const user=await establishOtpSession(db,auth,payload,'Strong-new-password-123!');assert.ok(user);users.push(user.id)
 const claimed=await db.rpc('claim_nanny_applications',{p_actor:user.id,p_verified_email:address});assert.ifError(claimed.error);assert.equal(claimed.data,1)
 assert.equal((await db.from('profiles').select('role').eq('id',user.id).single()).data!.role,'nanny')
 assert.equal((await db.from('nanny_applications').select('user_id').eq('id',appId).single()).data!.user_id,user.id)
 assert.ok((await auth.from('nanny_agreement_acceptances').select('*')).error,'Even the owner uses the authorised server view.')
 assert.ok((await auth.rpc('workflow_queue_health')).error,'Queue internals remain private.')
 const queued=await db.from('workflow_jobs').select('id').eq('dedupe_key',`application-received:${appId}`);jobs.push(...queued.data!.map(r=>r.id))
})
test('supplemental documents reset vetting, create review work atomically and cannot change a decided application',async()=>{
 const actor=users[0];assert.ok(actor)
 assert.ifError((await db.rpc('accept_nanny_agreement',{p_application:appId,p_actor:actor,p_acceptance:applicationAcceptance({...completeApplication,fullName:'Agreement Test Nanny',agreementSignerName:'Agreement Test Nanny',email:address})})).error)
 const document={kind:'certificate',storage_path:`nanny-documents/${appId}/supplemental/${randomUUID()}`,file_name:'training.pdf',mime_type:'application/pdf'}
 assert.ifError((await db.from('nanny_applications').update({vetting_checks:{qualifications:true}}).eq('id',appId)).error)
 assert.ok((await db.rpc('add_nanny_document',{p_application:appId,p_actor:randomUUID(),p_document:document})).error)
 assert.ifError((await db.rpc('add_nanny_document',{p_application:appId,p_actor:actor,p_document:document})).error)
 assert.equal((await db.from('nanny_applications').select('vetting_checks').eq('id',appId).single()).data!.vetting_checks.qualifications,false)
 assert.equal((await db.from('ops_tasks').select('id').eq('dedupe_key',`document-review:${appId}`)).data!.length,1)
 assert.equal((await db.from('workflow_jobs').select('id').eq('dedupe_key',`nanny-document:${document.storage_path}`)).data!.length,1)
 assert.ifError((await db.from('nanny_applications').update({status:'rejected'}).eq('id',appId)).error)
 assert.ok((await db.rpc('add_nanny_document',{p_application:appId,p_actor:actor,p_document:{...document,storage_path:`nanny-documents/${appId}/supplemental/${randomUUID()}`}})).error)
 assert.equal((await db.from('nanny_documents').select('id').eq('storage_path',document.storage_path)).data!.length,1)
})

test('existing nanny onboarding links one existing account and profile, requires owner acceptance, and rejects replay changes',async()=>{
 const c=await localCredentials(),admin=await db.auth.admin.createUser({email:`legacy-admin-${randomUUID()}@example.test`,password:randomUUID(),email_confirm:true}),owner=await db.auth.admin.createUser({email:`legacy-owner-${randomUUID()}@example.test`,password:randomUUID(),email_confirm:true});assert.ifError(admin.error);assert.ifError(owner.error)
 const operator=admin.data.user!.id,identity=owner.data.user!,nannyId=randomUUID();let application:string|undefined
 try{
  await db.from('profiles').update({role:'admin'}).eq('id',operator);await db.from('profiles').update({role:'nanny'}).eq('id',identity.id)
  assert.ifError((await db.from('nannies').insert({id:nannyId,user_id:identity.id,slug:`legacy-${nannyId}`,display_name:'Existing Test Nanny',tier:'bronze',is_active:false})).error)
  assert.ok((await db.rpc('begin_existing_onboarding',{p_nanny:nannyId,p_actor:identity.id,p_email:identity.email})).error)
  const linked=await db.rpc('begin_existing_onboarding',{p_nanny:nannyId,p_actor:operator,p_email:identity.email});assert.ifError(linked.error);application=linked.data
  assert.equal((await db.rpc('begin_existing_onboarding',{p_nanny:nannyId,p_actor:operator,p_email:identity.email})).data,application)
  assert.equal((await db.from('nannies').select('application_id').eq('id',nannyId).single()).data!.application_id,application)
  const body={...completeApplication,fullName:'Existing Test Nanny',agreementSignerName:'Existing Test Nanny',email:identity.email},row={full_name:body.fullName,email:identity.email,national_id_number:body.nationalIdNumber,phone:body.phone,date_of_birth:body.dateOfBirth,consent_background:true,consent_terms:true,consent_accuracy:true,submission_key:randomUUID(),agreement_acceptance:applicationAcceptance(body)},refs=[{full_name:'Reference One',sort_order:1},{full_name:'Reference Two',sort_order:2}],docs=['photo','id_front','id_back','selfie'].map(kind=>({kind,storage_path:`nanny-documents/${application}/synthetic-${kind}.jpg`}))
  assert.ok((await db.rpc('complete_existing_application',{p_id:application,p_actor:operator,p_row:row,p_references:refs,p_documents:docs})).error,'Administrator cannot accept on the nanny’s behalf.')
  assert.ok((await db.rpc('complete_existing_application',{p_id:application,p_actor:identity.id,p_row:{...row,agreement_acceptance:null},p_references:refs,p_documents:docs})).error)
  assert.ifError((await db.rpc('complete_existing_application',{p_id:application,p_actor:identity.id,p_row:row,p_references:refs,p_documents:docs})).error)
  assert.ifError((await db.rpc('complete_existing_application',{p_id:application,p_actor:identity.id,p_row:row,p_references:refs,p_documents:docs})).error)
  const changed=await db.rpc('complete_existing_application',{p_id:application,p_actor:identity.id,p_row:{...row,submission_key:randomUUID()},p_references:refs,p_documents:docs});assert.ok(changed.error)
  assert.equal((await db.from('nannies').select('id').eq('user_id',identity.id)).data!.length,1);assert.ok((await loadAgreementSummary(db,application!))!.current)
  assert.ok((await createClient(c.url,c.anonKey).rpc('operations_health')).error)
 }finally{
  if(application){await db.from('workflow_jobs').delete().eq('dedupe_key',`existing-application-received:${application}`);await db.from('workflow_audit').delete().eq('entity_id',application);await db.from('nanny_documents').delete().eq('application_id',application);await db.from('nanny_references').delete().eq('application_id',application)}
  await db.from('ops_tasks').delete().eq('dedupe_key',`legacy-onboarding:${nannyId}`);if(application)await db.from('nanny_applications').update({legacy_nanny_id:null}).eq('id',application);await db.from('nannies').delete().eq('id',nannyId);if(application)await db.from('nanny_applications').delete().eq('id',application);await db.auth.admin.deleteUser(identity.id);await db.auth.admin.deleteUser(operator)
 }
})
