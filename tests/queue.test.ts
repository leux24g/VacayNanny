import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {SupabaseClient} from '@supabase/supabase-js'
import {processWorkflowJobs} from '../lib/workflow-jobs'
import {sealWorkflow} from '../lib/workflow-secrets'
import {withWorkerDeadline} from '../lib/worker-context'
import {smtpFixture} from './smtp-fixture'
import {uploadPublicPhoto,ProfileImageError} from '../lib/profile-media'

test('photo cleanup removes abandoned uploads and retains a photo referenced by the site',async()=>{
 const env={...process.env};process.env.EMAIL_DELIVERY_MODE='disabled'
 try{
  const pending=[{id:'abandoned',kind:'public_photo_cleanup',payload:{path:'profiles/test/abandoned.png'},lease_token:'one'},{id:'referenced',kind:'public_photo_cleanup',payload:{url:'https://test.invalid/profiles/test/current.png'},lease_token:'two'}],removed:string[]=[],checked:string[]=[]
  const db={
   rpc:async(name:string)=>name==='claim_workflow_jobs'?{data:pending.length?[pending.shift()]:[],error:null}:{data:null,error:null},
   from:(table:string)=>({select:()=>({eq:(_column:string,url:string)=>({limit:async()=>{
    checked.push(table)
    return {data:table==='profiles'&&url.endsWith('/current.png')?[{id:'owner'}]:[],error:null}
   }})})}),
   storage:{from:()=>({getPublicUrl:(path:string)=>({data:{publicUrl:'https://test.invalid/'+path}}),remove:async(paths:string[])=>{removed.push(...paths);return {error:null}}})},
  } as unknown as SupabaseClient
  const result=await processWorkflowJobs(db,5);assert.equal(result.processed,2);assert.equal(result.failed,0);assert.deepEqual(removed,['profiles/test/abandoned.png']);assert.equal(checked.length,10)
 }finally{process.env=env}
})
test('a renamed HTML or SVG file cannot be published as a profile photo',async()=>{
 const db={rpc:async()=>{throw new Error('Invalid files must be rejected before storage or queue writes.')}} as unknown as SupabaseClient
 await assert.rejects(uploadPublicPhoto(db,'profiles/test',new File(['<svg onload="alert(1)"></svg>'],'fake.png',{type:'image/png'})),ProfileImageError)
})

test('the worker claims one job at a time, leaves unclaimed work available, and records each failure',async()=>{
 const env={...process.env};process.env.EMAIL_DELIVERY_MODE='send'
 try{
  const pending=[1,2,3].map(id=>({id:String(id),kind:'unsupported-test-job',payload:{},lease_token:'lease-'+id})),claimed:string[]=[],finished:string[]=[]
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{
   if(name==='claim_workflow_jobs'){assert.equal(args.p_limit,1);const job=pending.shift();if(job)claimed.push(job.id);return {data:job?[job]:[],error:null}}
   assert.equal(name,'finish_workflow_job');assert.ok(args.p_error);finished.push(String(args.p_id));return {data:null,error:null}
  }} as unknown as SupabaseClient
  const result=await processWorkflowJobs(db,2)
  assert.equal(result.failed,2);assert.deepEqual(claimed,['1','2']);assert.deepEqual(finished,claimed);assert.equal(pending.length,1)
  const before=claimed.length;await processWorkflowJobs(db,20,{budgetMs:0});assert.equal(claimed.length,before)
 }finally{process.env=env}
})
test('an ambiguous SMTP result stops at its deadline and is sent to manual delivery review instead of automatic resend',async()=>{
 const env={...process.env},smtp=await smtpFixture({holdAfterData:true})
 Object.assign(process.env,{EMAIL_DELIVERY_MODE:'send',EMAIL_PROVIDER:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.port),SMTP_USER:'fixture@example.test',SMTP_PASSWORD:'test-only',NOTIFICATION_ENCRYPTION_KEY:'queue-synthetic-key'})
 try{
  let claimed=false;const finishes:Array<Record<string,unknown>>=[]
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{
   if(name==='claim_workflow_jobs'){if(claimed)return {data:[],error:null};claimed=true;return {data:[{id:'synthetic-email',kind:'email',lease_token:'lease',payload:{sealed:sealWorkflow({to:'recipient@example.test',subject:'Test only',html:'<p>Local sink only</p>'})}}],error:null}}
   if(name==='begin_workflow_email_delivery')return {data:true,error:null}
   finishes.push(args);return {data:null,error:null}
  }} as unknown as SupabaseClient
  const start=Date.now()
  const result=await withWorkerDeadline(AbortSignal.timeout(500),()=>processWorkflowJobs(db,1))
  assert.ok(Date.now()-start<3000);assert.equal(smtp.messages.length,1)
  assert.equal(result.failed,1);assert.equal(finishes.length,1);assert.match(String(finishes[0].p_error),/^Manual delivery check required:/)
 }finally{await smtp.close();process.env=env}
})
test('a journaled SMTP acceptance resumes bookkeeping without calling the provider again',async()=>{
 const env={...process.env};Object.assign(process.env,{EMAIL_DELIVERY_MODE:'send',EMAIL_PROVIDER:'smtp',SMTP_USER:'',SMTP_PASSWORD:'',EMAIL:'',EMAIL_APP_PASSWORD:'',NOTIFICATION_ENCRYPTION_KEY:'journal-test-key'})
 try{
  let claimed=false;const names:string[]=[]
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{names.push(name);if(name==='claim_workflow_jobs'){if(claimed)return {data:[],error:null};claimed=true;return {data:[{id:'accepted-job',kind:'email',lease_token:'new-lease',delivery_started_at:new Date().toISOString(),delivery_accepted_at:new Date().toISOString(),payload:{sealed:sealWorkflow({to:'test@example.test',subject:'Already accepted',html:'<p>Do not send twice</p>'})}}],error:null}}assert.equal(name,'finish_workflow_job');assert.equal(args.p_error,null);return {data:null,error:null}}} as unknown as SupabaseClient
  const result=await processWorkflowJobs(db,1);assert.equal(result.processed,1);assert.equal(result.failed,0);assert.deepEqual(names,['claim_workflow_jobs','finish_workflow_job'])
 }finally{process.env=env}
})
