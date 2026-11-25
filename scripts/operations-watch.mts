import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {deliverEmail} from '../lib/email-delivery'
import {smtpTransport} from '../lib/smtp'
import {withWorkerDeadline} from '../lib/worker-context'

export async function inspectHealth(url:string,secret:string){
 try{const response=await fetch(url,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(12000)}),body=await response.json();return {ok:response.ok&&body.ok===true,reasons:response.ok&&body.ok===true?[]:[...(body.checks?Object.entries(body.checks).filter(([,ready])=>ready!==true).map(([name])=>name):[]),`HTTP ${response.status}`]}}
 catch{return {ok:false,reasons:['Application health endpoint unreachable']}}
}
export function shouldNotify(previous:{ok?:boolean;signature?:string;lastAlert?:number},healthy:boolean,signature:string,now:number){return healthy?previous.ok===false:previous.ok!==false||previous.signature!==signature||now-(previous.lastAlert||0)>=3600000}
export async function runWatch(){
 const origin=process.env.OPERATIONS_SITE_URL||'https://www.vacaynanny.net',secret=process.env.MONITOR_SECRET
 if(!secret||!origin.startsWith('https://'))throw new Error('Independent monitor configuration is incomplete.')
 const statePath=process.env.OPERATIONS_STATE_PATH||'artifacts/watchdog-state.json';await mkdir('artifacts',{recursive:true})
 let previous:{ok?:boolean;signature?:string;lastAlert?:number}={};try{previous=JSON.parse(await readFile(statePath,'utf8'))}catch{}
 const status=await inspectHealth(origin+'/api/operations/health',secret)
 if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_TOKEN){
  try{const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts?per_page=100`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Artifact listing failed');const result=await response.json();const latest=result.artifacts.find((a:{name:string;expired:boolean})=>a.name.startsWith('vacaynanny-encrypted-backup-')&&!a.expired);if(!latest||Date.now()-Date.parse(latest.created_at)>27*3600000){status.ok=false;status.reasons.push('No current encrypted backup within 27 hours')}}catch{status.ok=false;status.reasons.push('Backup freshness could not be checked')}
 }
 const signature=createHash('sha256').update(status.reasons.sort().join('|')).digest('hex'),now=Date.now(),notify=shouldNotify(previous,status.ok,signature,now)
 let transportVerified=false
 if(process.env.VERIFY_ALERT_TRANSPORT==='true'){
  const smtp=smtpTransport();try{await smtp.verify();transportVerified=true}finally{smtp.close()}
 }
 const next={ok:status.ok,signature,lastAlert:notify?now:previous.lastAlert,checkedAt:new Date().toISOString()}
 await writeFile(statePath,JSON.stringify(next),{mode:0o600})
 if(notify){const subject=status.ok?'VacayNanny operations recovered':'VacayNanny operations need attention',text=status.ok?'The independent monitor reports healthy application, queue and backup checks.':`The independent monitor detected: ${status.reasons.join(', ')}. Check the operations portal and workflow logs. No customer data is included in this notice.`;await withWorkerDeadline(AbortSignal.timeout(20000),()=>deliverEmail({to:process.env.OPERATIONS_ALERT_EMAIL||'hello@vacaynanny.net',subject,text,html:`<p>${text}</p>`},`operations:${signature}:${Math.floor(now/3600000)}`))}
 console.log(JSON.stringify({healthy:status.ok,reasons:status.reasons,notificationAttempted:notify,alertTransportAuthenticated:transportVerified}));if(!status.ok)process.exitCode=1
}
if(process.argv[1]?.endsWith('operations-watch.mts'))runWatch().catch(()=>{console.error('The independent monitor could not finish. Check its configuration and Actions logs.');process.exitCode=1})
