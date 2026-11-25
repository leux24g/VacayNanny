import {readFile,mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {decryptBackup,runPrivate} from './backup-core.mjs'
import {assertLocalWorkspace,localCredentials} from './local-database.mjs'

export async function verifyRestore(file:string,key:string){
 await assertLocalWorkspace();const local=await localCredentials(),archive=decryptBackup(await readFile(file),key)
 const database='vacaynanny_restore_'+randomUUID().replace(/-/g,''),temporary=await mkdtemp(join(tmpdir(),'vacaynanny-restore-'))
 const psql=(sql:string,db='postgres')=>runPrivate('docker',['exec','-i','supabase_db_vacaynanny-local','psql','-U','supabase_admin','-d',db,'-tA','-v','ON_ERROR_STOP=1'],sql)
 const storage=createClient(local.url,local.serviceKey,{auth:{persistSession:false}}),bucket='restore-check-'+randomUUID(),uploaded:string[]=[]
 let created=false,bucketCreated=false
 try{
  await psql(`create database ${database};`);created=true
  await psql('create schema if not exists extensions;create extension if not exists pgcrypto with schema extensions;create extension if not exists "uuid-ossp" with schema extensions;',database)
  await psql(archive.schema,database)
  // The isolated database has no Auth/worker services. Trigger execution is disabled
  // only in this restore session; cron jobs and production Vault secrets are not enabled.
  await psql('set session_replication_role=replica;\n'+archive.data,database)
  let restored=0
  for(const table of archive.tables){if(!/^[a-zA-Z0-9_]+$/.test(table.name)||!['public','auth','storage','supabase_migrations'].includes(table.schema))throw new Error('Invalid archived table name.');const count=Number((await psql(`select count(*) from "${table.schema}"."${table.name}";`,database)).trim());if(count!==table.count)throw new Error(`Restore count mismatch for ${table.schema}.${table.name}`);restored++}
  if(archive.files.length){const result=await storage.storage.createBucket(bucket,{public:false});if(result.error)throw new Error('Could not create private restore-check storage.');bucketCreated=true}
  for(const [i,f]of archive.files.entries()){const bytes=Buffer.from(f.data,'base64');if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('An archived Storage checksum failed.');const path=String(i);const saved=await storage.storage.from(bucket).upload(path,bytes,{contentType:f.type,upsert:false});if(saved.error)throw new Error('Could not restore a file into private test storage.');uploaded.push(path);const downloaded=await storage.storage.from(bucket).download(path);if(downloaded.error||createHash('sha256').update(Buffer.from(await downloaded.data.arrayBuffer())).digest('hex')!==f.sha256)throw new Error('Restored Storage bytes differ from the archive.')}
  const result={project:archive.project,restoredTables:restored,verifiedStorageFiles:archive.files.length,isolatedDatabase:true,productionJobsEnabled:false}
  await mkdir('artifacts/restore-checks',{recursive:true,mode:0o700});await writeFile(join('artifacts/restore-checks',Date.now()+'.json'),JSON.stringify(result,null,2),{mode:0o600});return result
 }catch(error){await writeFile(join('artifacts/operations-release','restore-private-error.log'),String(error instanceof Error?error.cause||error:error),{mode:0o600});throw new Error('The isolated restore check failed. Review its private diagnostic log.')}
 finally{if(uploaded.length)await storage.storage.from(bucket).remove(uploaded);if(bucketCreated)await storage.storage.deleteBucket(bucket);if(created)await psql(`drop database ${database} with (force);`);await rm(temporary,{recursive:true,force:true})}
}
if(process.argv[1]?.endsWith('restore-check.mts')){
 const file=process.argv.find(a=>a.startsWith('--archive='))?.slice('--archive='.length)
 if(!file||!process.argv.includes('--local'))throw new Error('Pass --archive=<encrypted file> --local; production restoration is deliberately not performed by this verification tool.')
 let key=process.env.BACKUP_ENCRYPTION_KEY||'';if(!key)key=(await readFile('/home/alex/.local/share/vacaynanny/backup-recovery-key','utf8')).trim()
 verifyRestore(file,key).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1})
}
