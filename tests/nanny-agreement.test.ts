import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {validateAgreement,NANNY_AGREEMENT_SHA256,NANNY_AGREEMENT_PDF} from '../lib/nanny-agreement-rules'
import {completeApplication} from './fixtures/application'
import {completionReportErrors} from '../lib/completion-report'

test('the published agreement PDF is the exact user-supplied version referenced by acceptance',async()=>{
 const pdf=await readFile('public'+NANNY_AGREEMENT_PDF)
 assert.equal(createHash('sha256').update(pdf).digest('hex'),NANNY_AGREEMENT_SHA256)
 const migration=await readFile('supabase/migrations/20261124163614_nanny_agreement_acceptance.sql','utf8')
 assert.ok(migration.includes(NANNY_AGREEMENT_SHA256))
})
test('agreement acceptance rejects unchecked or string consent, stale versions, wrong legal name and incomplete payout details',()=>{
 assert.deepEqual(validateAgreement(completeApplication,completeApplication.fullName),[])
 for(const change of [{agreementAccepted:false},{agreementAccepted:'true'},{agreementVersion:'outdated'},{agreementSignerName:'Another Person'},{payoutMethod:'cash'},{payoutAccountName:''},{payoutAccountNumber:'1234'},{payoutMethod:'bank',payoutAccountNumber:'123456789',payoutBankName:''}])assert.ok(validateAgreement({...completeApplication,...change},completeApplication.fullName).length,JSON.stringify(change))
 assert.deepEqual(validateAgreement({...completeApplication,agreementSignerName:' synthetic   applicant '},completeApplication.fullName),[])
 assert.deepEqual(validateAgreement({...completeApplication,payoutMethod:'bank',payoutBankName:'Test Bank',payoutAccountNumber:'00123456789'},completeApplication.fullName),[])
})
test('a completion report requires bounded actual hours, a work summary and explicit accuracy confirmation',()=>{
 const report={hoursWorked:8.25,summary:'Completed agreed childcare and the family handover.',additionalServices:'',expenses:'',accuracy:true}
 assert.deepEqual(completionReportErrors(report),[])
 for(const change of [{hoursWorked:0},{hoursWorked:NaN},{hoursWorked:1.1},{hoursWorked:99999},{summary:''},{accuracy:'true'},{expenses:'x'.repeat(1001)}])assert.ok(completionReportErrors({...report,...change}).length)
})
