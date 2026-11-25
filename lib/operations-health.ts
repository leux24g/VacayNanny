import 'server-only'
import {createServerClient} from './supabase/service'
import {emailSettings} from './email-settings'
export type OperationsSnapshot={database:boolean;workerObserved:boolean;queue:{ready:number;failed:number;stale:number;lastSuccessAt:string|null;oldestReadyAt:string|null;lastRun?:{status:string}|null}}
export function assessOperations(snapshot:OperationsSnapshot,now=Date.now()) {
 const q=snapshot.queue
 const checks={database:snapshot.database===true,worker:snapshot.workerObserved===true&&!!q.lastSuccessAt&&now-Date.parse(q.lastSuccessAt)<180000&&q.lastRun?.status!=='failed',queue:q.failed===0&&q.stale===0&&(!q.oldestReadyAt||now-Date.parse(q.oldestReadyAt)<600000)}
 return {ok:Object.values(checks).every(Boolean),checks}
}
export async function operationalHealth() {
 try {
  const db=createServerClient({timeoutMs:5000}),result=await db.rpc('operations_health')
  if(result.error||!result.data)throw new Error('Database health unavailable')
  const snapshot=result.data as OperationsSnapshot,assessed=assessOperations(snapshot),settings=emailSettings()
  const email=settings.mode==='send'&&(settings.provider==='smtp'?Boolean(settings.smtp.user&&settings.smtp.password):Boolean(settings.apiKey))
  return {...assessed,ok:assessed.ok&&email,checks:{...assessed.checks,emailConfiguration:email},queue:snapshot.queue,checkedAt:new Date().toISOString()}
 }catch{return {ok:false,checks:{database:false,worker:false,queue:false,emailConfiguration:false},queue:null,checkedAt:new Date().toISOString()}}
}
