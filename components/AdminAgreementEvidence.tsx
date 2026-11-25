'use client'

import {clientFetch} from '@/lib/client-request'
import {useState} from 'react'
import type {AgreementSummary,AgreementDetails} from '@/lib/nanny-onboarding'

export default function AdminAgreementEvidence({acceptance,applicationId}:{acceptance:AgreementSummary|null;applicationId:string}) {
  const [details,setDetails]=useState<AgreementDetails|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function reveal() {
    if(details){setDetails(null);return}
    setBusy(true);setError('')
    try {
      const response=await clientFetch(`/api/admin/applications/${applicationId}/acceptance?details=full`,{cache:'no-store'}),body=await response.json()
      if(!response.ok)throw new Error(body.error || 'Could not load payout details.')
      setDetails(body.details)
    }catch(error){setError(error instanceof Error?error.message:'Could not connect. Please retry.')}finally{setBusy(false)}
  }
  return <div className="form-card"><h3>Agreement acceptance evidence</h3>{acceptance?.current?<>
    <p>Read, understood and accepted by <strong>{acceptance.signer_name}</strong>.</p><p>Version {acceptance.version} · {new Date(acceptance.accepted_at).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})} EAT</p>
    <details><summary>Document fingerprint</summary><code className="agreement-fingerprint">SHA-256: {acceptance.document_sha256}</code></details>
    <p>Payout destination: {acceptance.payout.method==='mpesa'?'M-Pesa':acceptance.payout.bankName} · {acceptance.payout.maskedNumber} · {acceptance.payout.accountName}</p>
    <button className="btn-ghost" type="button" onClick={reveal} disabled={busy}>{busy?'Loading…':details?'Hide private payout details':'View private payout details'}</button>
    {details&&<dl className="agreement-private-details"><dt>Account holder</dt><dd>{details.payoutAccountName}</dd><dt>Method / bank</dt><dd>{details.payoutMethod==='mpesa'?'M-Pesa':details.payoutBankName}</dd><dt>Number</dt><dd>{details.payoutAccountNumber}</dd></dl>}
  </>:<p role="status">The nanny must read and accept the current agreement before approval, account linking or activation. Do not accept a checkbox on their behalf.</p>}{error&&<p role="alert" className="field-error-msg">{error}</p>}</div>
}
