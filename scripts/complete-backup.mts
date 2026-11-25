import nextEnv from '@next/env'
import {makeCompleteBackup} from './backup-core.mjs'
nextEnv.loadEnvConfig(process.cwd())
const project=process.argv.find(a=>a.startsWith('--project-ref='))?.split('=')[1]
if(!project)throw new Error('Pass the expected --project-ref explicitly.')
try{const result=await makeCompleteBackup(project,process.env.BACKUP_OUTPUT_DIR||'artifacts/complete-backups',process.argv.includes('--local'));console.log(JSON.stringify({encryptedBackup:result.name,tables:result.tables,storageFiles:result.files,bytes:result.bytes}))}catch{console.error('Complete backup failed. No successful backup should be recorded for this run.');process.exitCode=1}
