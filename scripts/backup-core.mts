import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {spawn} from 'node:child_process'
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createClient} from '@supabase/supabase-js'
import {localCredentials,assertLocalWorkspace,workdir} from './local-database.mjs'

export type BackupArchive={version:1;project:string;capturedAt:string;schema:string;data:string;roles:string;tables:Array<{schema:string;name:string;count:number}>;files:Array<{bucket:string;path:string;type:string;sha256:string;data:string}>;settings:unknown;recoverySecrets:Record<string,string>;migrationHistory:unknown}
function keyBytes(value:string){if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('BACKUP_ENCRYPTION_KEY must contain 64 hexadecimal characters.');return Buffer.from(value,'hex')}
export function encryptBackup(archive:BackupArchive,key:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv),bytes=gzipSync(Buffer.from(JSON.stringify(archive)));return Buffer.from(JSON.stringify({version:1,iv:iv.toString('base64'),tag:'',data:Buffer.concat([cipher.update(bytes),cipher.final()]).toString('base64'),authTag:cipher.getAuthTag().toString('base64')}))}
export function decryptBackup(bytes:Buffer,key:string):BackupArchive {const envelope=JSON.parse(bytes.toString());if(envelope.version!==1)throw new Error('Unsupported backup format.');const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.authTag,'base64'));const data=JSON.parse(gunzipSync(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()])).toString());if(data.version!==1||!data.schema||!data.data||!Array.isArray(data.files)||!Array.isArray(data.tables))throw new Error('Backup contents are invalid.');return data}
export function runPrivate(binary:string,args:string[],input?:string|Buffer):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(binary,args,{env:process.env,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let errors='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('The backup command exceeded its time limit.'))},10*60*1000);child.stdout.on('data',d=>chunks.push(Buffer.from(d)));child.stderr.on('data',d=>errors+=d.toString());child.on('error',()=>{clearTimeout(timer);reject(new Error('A required backup command could not start.'))});child.on('close',code=>{clearTimeout(timer);if(code!==0){void errors;reject(new Error('A backup database command failed. No complete archive was published.',{cause:errors}))}else resolve(Buffer.concat(chunks).toString())});if(input)child.stdin.end(input);else child.stdin.end()})}
async function managed(project:string,path:string,body?:unknown){const response=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Backup metadata request failed (${response.status}).`);return response.json()}
export async function makeCompleteBackup(project:string,outputDir:string,local=false){
 process.umask(0o077);const key=process.env.BACKUP_ENCRYPTION_KEY||'';keyBytes(key)
 if(local){await assertLocalWorkspace();if(project!=='vacaynanny-local')throw new Error('Local backup project mismatch.')}
 else if(!/^[a-z]{20}$/.test(project)||!process.env.SUPABASE_ACCESS_TOKEN||!process.env.BACKUP_APP_ENCRYPTION_KEY)throw new Error('Explicit hosted project and management access are required.')
 const credentials=local?await localCredentials():{url:process.env.NEXT_PUBLIC_SUPABASE_URL||'',serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY||''}
 if(!local&&new URL(credentials.url).hostname!==`${project}.supabase.co`)throw new Error('The project URL does not match the requested backup.')
 const db=createClient(credentials.url,credentials.serviceKey,{auth:{persistSession:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})}})
 const temporary=await mkdtemp(join(tmpdir(),'vacaynanny-backup-'))
 async function sql(query:string){return local?JSON.parse(await runPrivate('docker',['exec','-i','supabase_db_vacaynanny-local','psql','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1'],query)):managed(project,'/database/query',{query,read_only:false})}
 async function objectList(){const query="select coalesce(json_agg(json_build_object('bucket',bucket_id,'path',name,'updatedAt',updated_at,'size',metadata->>'size') order by bucket_id,name),'[]') as objects from storage.objects";const r=await sql(query);return local?r:r[0].objects}
 try {
  const objects=await objectList(),dumpArgs=local?['--workdir',workdir]:[`--remote=${project}`]
  for(const [file,flags]of [['schema.sql',['--schema','public,auth,storage,supabase_migrations']],['data.sql',['--schema','public,auth,storage,supabase_migrations','--data-only','--use-copy']],['roles.sql',['--role-only']]] as const){const path=join(temporary,file);await writeFile(path,'',{mode:0o600});await runPrivate('node_modules/.bin/supabase',['db','dump',...dumpArgs,...flags,'--file',path])}
  const [schema,data,roles]=await Promise.all(['schema.sql','data.sql','roles.sql'].map(f=>readFile(join(temporary,f),'utf8')))
  if(!schema.includes('CREATE TABLE')||!data.replaceAll('\"','').includes('COPY auth.users')||!data.replaceAll('\"','').includes('COPY public.profiles'))throw new Error('Required application or Auth data was missing from the dump.')
  const countsQuery="select coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname,'count',0) order by n.nspname,c.relname),'[]') as tables from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','auth','storage','supabase_migrations')",tableResult=await sql(countsQuery),tables=(local?tableResult:tableResult[0].tables) as BackupArchive['tables']
  // Count records from the consistent pg_dump COPY snapshot, including empty tables.
  const snapshotCounts=new Map<string,number>();let copying:string|null=null
  for(const line of data.split('\n')){if(copying){if(line==='\\.'){copying=null}else snapshotCounts.set(copying,(snapshotCounts.get(copying)||0)+1)}else{const match=line.match(/^COPY ([^ ]+) \(.+\) FROM stdin;$/);if(match){copying=match[1].replaceAll('"','');snapshotCounts.set(copying,0)}}}
  for(const table of tables)table.count=snapshotCounts.get(`${table.schema}.${table.name}`)||0
  const files:BackupArchive['files']=[]
  for(const item of objects){const response=await db.storage.from(item.bucket).download(item.path);if(response.error||!response.data)throw new Error('A Storage object could not be backed up.');const bytes=Buffer.from(await response.data.arrayBuffer());files.push({bucket:item.bucket,path:item.path,type:response.data.type,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')})}
  if(JSON.stringify(objects)!==JSON.stringify(await objectList()))throw new Error('Storage changed during backup. Repeat the backup to obtain a consistent file inventory.')
  const settings=local?{local:true}:await managed(project,'/config/auth'),migrationHistory=local?null:await managed(project,'/database/migrations')
  const recoverySecrets:Record<string,string>={};if(process.env.BACKUP_APP_ENCRYPTION_KEY)recoverySecrets.NOTIFICATION_ENCRYPTION_KEY=process.env.BACKUP_APP_ENCRYPTION_KEY
  if(!local){const vault=await sql("select name,decrypted_secret from vault.decrypted_secrets where name in('vacaynanny_site_url','vacaynanny_cron_secret')");for(const r of vault)recoverySecrets[r.name]=r.decrypted_secret}
  const archive:BackupArchive={version:1,project,capturedAt:new Date().toISOString(),schema,data,roles,tables,files,settings,recoverySecrets,migrationHistory}
  const encrypted=encryptBackup(archive,key),verified=decryptBackup(encrypted,key);if(verified.files.length!==files.length)throw new Error('Archive verification failed.')
  await mkdir(outputDir,{recursive:true,mode:0o700});const name=`vacaynanny-${project}-${archive.capturedAt.replace(/[:.]/g,'-')}.vnbak`,path=join(outputDir,name);await writeFile(path,encrypted,{mode:0o600});await writeFile(path+'.sha256',createHash('sha256').update(encrypted).digest('hex')+'\n',{mode:0o600})
  return {path,name,tables:tables.length,files:files.length,bytes:encrypted.length}
 }finally{await rm(temporary,{recursive:true,force:true})}
}
