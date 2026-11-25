import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
import {clientFetch} from '../lib/client-request'
import {assessOperations} from '../lib/operations-health'
import {encryptBackup,decryptBackup,type BackupArchive} from '../scripts/backup-core.mjs'
import {shouldNotify} from '../scripts/operations-watch.mjs'
test('browser requests preserve AbortSignals and turn transport failures into retryable messages',async()=>{
 const fetch=mock.method(globalThis,'fetch',async(_input:unknown,init?:RequestInit)=>{assert.ok(init?.signal);throw new TypeError('private transport details')})
 try{await assert.rejects(clientFetch('https://example.test'),/Could not connect/)}finally{fetch.mock.restore()}
 const controller=new AbortController();controller.abort()
 const aborted=mock.method(globalThis,'fetch',async(_input:unknown,init?:RequestInit)=>{assert.equal(init!.signal!.aborted,true);throw new DOMException('aborted','AbortError')})
 try{await assert.rejects(clientFetch('https://example.test',{signal:controller.signal}),/check whether it saved/)}finally{aborted.mock.restore()}
})
test('health checks fail for absent heartbeats, failed jobs and excessive queue age',()=>{
 const now=Date.now(),snapshot={database:true,workerObserved:true,queue:{ready:0,stale:0,failed:0,lastSuccessAt:new Date(now).toISOString(),oldestReadyAt:null,lastRun:{status:'completed'}}}
 assert.equal(assessOperations(snapshot,now).ok,true)
 assert.equal(assessOperations({...snapshot,workerObserved:false},now).ok,false)
 for(const queue of [{...snapshot.queue,lastSuccessAt:new Date(now-240000).toISOString()},{...snapshot.queue,failed:1},{...snapshot.queue,stale:1},{...snapshot.queue,oldestReadyAt:new Date(now-660000).toISOString()}])assert.equal(assessOperations({...snapshot,queue},now).ok,false)
})
test('complete backup archives authenticate contents and reject wrong keys or tampering',()=>{
 const archive={version:1,project:'test',capturedAt:new Date().toISOString(),schema:'CREATE TABLE test(id int);',data:'PRIVATE-CREDENTIAL-HASH',roles:'CREATE ROLE example;',tables:[],files:[],settings:{},recoverySecrets:{key:'PRIVATE-WORKFLOW-KEY'},migrationHistory:[]} as BackupArchive,key='ab'.repeat(32),encrypted=encryptBackup(archive,key)
 assert.equal(encrypted.includes(Buffer.from('PRIVATE-CREDENTIAL-HASH')),false);assert.deepEqual(decryptBackup(encrypted,key),archive);assert.throws(()=>decryptBackup(encrypted,'cd'.repeat(32)))
 const changed=JSON.parse(encrypted.toString());changed.data=changed.data.slice(0,-4)+'AAAA';assert.throws(()=>decryptBackup(Buffer.from(JSON.stringify(changed)),key))
})
test('the independent monitor sends incident and recovery notices with repeat alerts capped at one per hour',()=>{
 assert.equal(shouldNotify({},true,'ok',1000),false);assert.equal(shouldNotify({},false,'failed',1000),true)
 assert.equal(shouldNotify({ok:false,signature:'failed',lastAlert:1000},false,'failed',2000),false)
 assert.equal(shouldNotify({ok:false,signature:'failed',lastAlert:1000},false,'failed',3602000),true)
 assert.equal(shouldNotify({ok:false,signature:'failed',lastAlert:1000},true,'ok',2000),true)
})
