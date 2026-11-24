import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'
import {localCredentials} from '../scripts/local-database.mjs'
let db:SupabaseClient,anon:SupabaseClient,operator:string
const ids:string[]=[]
before(async()=>{const c=await localCredentials();db=createClient(c.url,c.serviceKey,{auth:{persistSession:false}});anon=createClient(c.url,c.anonKey,{auth:{persistSession:false}});const u=await db.auth.admin.createUser({email:`queue-${randomUUID()}@example.test`,password:randomUUID(),email_confirm:true});assert.ifError(u.error);operator=u.data.user!.id;assert.ifError((await db.from('profiles').update({role:'admin'}).eq('id',operator)).error)})
after(async()=>{if(ids.length){await db.from('ops_tasks').delete().in('dedupe_key',ids.map(id=>`notification:${id}`));await db.from('workflow_audit').delete().in('entity_id',ids);await db.from('workflow_jobs').delete().in('id',ids)}await db.from('workflow_audit').delete().eq('actor_id',operator);await db.auth.admin.deleteUser(operator)})
async function queued(kind= `queue-test-${randomUUID()}`){const r=await db.rpc('enqueue_workflow_job',{p_kind:kind,p_payload:{},p_key:randomUUID()});assert.ifError(r.error);ids.push(r.data);return {id:r.data as string,kind}}
async function claim(kind:string){const r=await db.rpc('claim_workflow_jobs',{p_limit:1,p_kinds:[kind]});assert.ifError(r.error);return r.data![0]}

test('transient failures back off and eight attempts surface one actionable failed job',async()=>{
 const j=await queued()
 for(let attempt=1;attempt<=8;attempt++){
  const job=await claim(j.kind);assert.equal(job.id,j.id);assert.equal(job.attempts,attempt)
  assert.ifError((await db.rpc('finish_workflow_job',{p_id:j.id,p_lease:job.lease_token,p_error:'Synthetic provider failure'})).error)
  const saved=await db.from('workflow_jobs').select('*').eq('id',j.id).single();assert.ifError(saved.error)
  assert.equal(saved.data!.status,attempt===8?'failed':'pending')
  if(attempt<8){assert.ok(Date.parse(saved.data!.available_at)>Date.now());assert.equal(await claim(j.kind),undefined);await db.from('workflow_jobs').update({available_at:new Date(0).toISOString()}).eq('id',j.id)}
 }
 const tasks=await db.from('ops_tasks').select('id').eq('dedupe_key',`notification:${j.id}`);assert.equal(tasks.data!.length,1)
})
test('a worker that repeatedly disappears is exhausted into review rather than reclaimed forever',async()=>{
 const j=await queued();await db.from('workflow_jobs').update({status:'processing',attempts:8,locked_at:new Date(Date.now()-4*60000).toISOString(),lease_token:randomUUID()}).eq('id',j.id)
 assert.equal(await claim(j.kind),undefined)
 assert.equal((await db.from('workflow_jobs').select('status').eq('id',j.id).single()).data!.status,'failed')
 assert.equal((await db.from('ops_tasks').select('id').eq('dedupe_key',`notification:${j.id}`)).data!.length,1)
})
test('the delivery journal survives a lost lease, requires review for uncertainty and resumes accepted delivery without sending again',async()=>{
 const j=await queued('email')
 await db.from('workflow_jobs').update({status:'processing',attempts:1,locked_at:new Date().toISOString(),lease_token:randomUUID()}).eq('id',j.id)
 const own=(await db.from('workflow_jobs').select('*').eq('id',j.id).single()).data!
 assert.ok((await db.rpc('begin_workflow_email_delivery',{p_id:j.id,p_lease:randomUUID()})).error)
 assert.equal((await db.rpc('begin_workflow_email_delivery',{p_id:j.id,p_lease:own.lease_token})).data,true)
 // Simulate a new lease after a worker dies; the existing lease-claim suite checks actual recovery.
 await db.from('workflow_jobs').update({attempts:2,locked_at:new Date().toISOString(),lease_token:randomUUID()}).eq('id',j.id)
 const next=(await db.from('workflow_jobs').select('*').eq('id',j.id).single()).data!
 assert.notEqual(next.lease_token,own.lease_token);assert.ok(next.delivery_started_at)
 assert.ok((await db.rpc('confirm_workflow_email_delivery',{p_id:j.id,p_lease:own.lease_token})).error)
 assert.ifError((await db.rpc('finish_workflow_job',{p_id:j.id,p_lease:next.lease_token,p_error:'Manual delivery check required: synthetic interruption'})).error)
 assert.ok((await db.rpc('retry_workflow_job',{p_id:j.id,p_actor:operator})).error)
 assert.ifError((await db.rpc('retry_workflow_job',{p_id:j.id,p_actor:operator,p_confirmed_not_delivered:true})).error)
 await db.from('workflow_jobs').update({status:'processing',attempts:1,locked_at:new Date().toISOString(),lease_token:randomUUID()}).eq('id',j.id)
 const retry=(await db.from('workflow_jobs').select('*').eq('id',j.id).single()).data!
 assert.equal(retry.delivery_started_at,null)
 assert.equal((await db.rpc('begin_workflow_email_delivery',{p_id:j.id,p_lease:retry.lease_token})).data,true)
 assert.ifError((await db.rpc('confirm_workflow_email_delivery',{p_id:j.id,p_lease:retry.lease_token})).error)
 assert.equal((await db.rpc('begin_workflow_email_delivery',{p_id:j.id,p_lease:retry.lease_token})).data,false,'Accepted delivery is not started again.')
 assert.ifError((await db.rpc('finish_workflow_job',{p_id:j.id,p_lease:retry.lease_token,p_error:null})).error)
 const row=(await db.from('workflow_jobs').select('*').eq('id',j.id).single()).data!;assert.ok(row.delivery_accepted_at);assert.equal(row.status,'completed')
 assert.ok((await anon.from('workflow_worker_runs').select('*')).error);assert.ok((await anon.rpc('begin_workflow_email_delivery',{p_id:j.id,p_lease:retry.lease_token})).error)
})
