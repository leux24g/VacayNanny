'use client'

import {clientFetch} from '@/lib/client-request'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import NannyAgreementFields from './NannyAgreementFields'
import { EMPTY_AGREEMENT, NANNY_AGREEMENT_PDF, type AgreementFields } from '@/lib/nanny-agreement-rules'
import type { AgreementSummary } from '@/lib/nanny-onboarding'
import { documentKindLabel } from '@/lib/application-docs'
import type { DocumentKind } from '@/lib/types'
import styles from './Portal.module.css'
import NannyDocumentUpload from './NannyDocumentUpload'

export type ApplicantView = {
  id: string; fullName: string; status: string; email: string; phone: string
  identityLast4: string; tier: string; submittedAt: string; interviewAt: string | null
  signedSubmitted: boolean; agreementReviewedAt: string | null; active: boolean
  needsCompleteApplication?: boolean
}
export default function NannyOnboardingPanel({ application, acceptance, documents }: {
  application: ApplicantView | null
  acceptance: AgreementSummary | null
  documents: Array<{ id:string; kind:DocumentKind; file_name:string | null }>
}) {
  const router = useRouter(), [agreement,setAgreement] = useState<AgreementFields>({ ...EMPTY_AGREEMENT })
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [saved,setSaved] = useState('')
  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSaved('')
    try {
      const response = await clientFetch('/api/nanny/agreement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(agreement)})
      const body = await response.json().catch(()=>({}))
      if (!response.ok) throw new Error(body.error || 'Could not save your acceptance.')
      setSaved('Your acceptance is recorded.'); router.refresh()
    } catch(error) { setError(error instanceof Error ? error.message : 'Could not connect. Please retry.') }
    finally { setBusy(false) }
  }
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaved('')
    const form = new FormData(event.currentTarget), file = form.get('agreement')
    if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024) { setError('Choose a signed PDF up to 4 MB.'); return }
    setBusy(true)
    try {
      const response = await clientFetch('/api/nanny/agreement/signed',{method:'POST',body:form}), body = await response.json().catch(()=>({}))
      if (!response.ok) throw new Error(body.error || 'Could not submit your PDF.')
      setSaved('Your signed agreement is submitted for review. Your profile will be activated only after our team confirms it.'); router.refresh()
    } catch(error) { setError(error instanceof Error ? error.message : 'Could not connect. Please keep your PDF and retry.') }
    finally { setBusy(false) }
  }
  if (!application) return <div className={styles.record}><h3>Start your nanny application</h3><p>Provide your required details, read the agreement and confirm acceptance before receiving a nanny account. You can follow review and activation here after email verification.</p><Link className="btn-coral" href="/become-a-nanny">Apply to join VacayNanny</Link></div>
  return <>
    <div className={styles.record}>
      <h3>Your application &amp; activation</h3>
      <dl><dt>Status</dt><dd>{application.active ? 'Active — available for approved bookings' : application.status}</dd><dt>Legal name</dt><dd>{application.fullName}</dd><dt>Application email</dt><dd>{application.email}</dd><dt>Phone</dt><dd>{application.phone}</dd><dt>Identity number</dt><dd>{application.identityLast4 ? `•••• ${application.identityLast4}` : 'Needs completion'}</dd><dt>Tier</dt><dd>{application.status === 'approved' ? 'Approved: ' : 'Estimated: '}{application.tier}</dd><dt>Submitted</dt><dd>{new Date(application.submittedAt).toLocaleDateString('en-GB',{timeZone:'Africa/Nairobi'})}</dd>{application.interviewAt && <><dt>Interview</dt><dd>{new Date(application.interviewAt).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})} EAT</dd></>}</dl>
      <ol className={styles.steps}><li>Application received and agreement accepted {acceptance?.current ? '✓' : '— acceptance needed'}</li><li>Identity, police clearance, references, qualifications and interview {application.status === 'approved' ? 'verified ✓' : 'under review'}</li><li>Signed and witnessed PDF {application.agreementReviewedAt ? 'reviewed ✓' : application.signedSubmitted ? 'submitted — awaiting review' : 'needed after application approval'}</li><li>Written marketplace activation {application.active ? 'confirmed ✓' : 'pending'}</li></ol>
      <p className="field-hint">Application approval and an account do not make a profile bookable. Contact the team to correct identity details or request a decision review.</p>
    </div>
    <div className={styles.record}>
      <h3>Your agreement</h3>
      {application.needsCompleteApplication ? <><p>Your existing profile is linked to an onboarding record. Complete your legal details, references, documents and agreement acceptance using your current account.</p><Link href="/nanny/onboarding" className="btn-coral">Complete my existing nanny onboarding</Link></> : acceptance?.current ? <>
        <p>You confirmed that you read, understood and accepted the agreement.</p>
        <dl><dt>Accepted by</dt><dd>{acceptance.signer_name}</dd><dt>Version</dt><dd>{acceptance.version}</dd><dt>Accepted on</dt><dd>{new Date(acceptance.accepted_at).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})} EAT</dd><dt>Payout method</dt><dd>{acceptance.payout.method === 'mpesa' ? 'M-Pesa' : acceptance.payout.bankName || 'Bank account'} · {acceptance.payout.maskedNumber}</dd><dt>Account holder</dt><dd>{acceptance.payout.accountName}</dd></dl>
        <p className="field-hint">Payout details remain subject to verification. Contact our team to change them; agreement acceptance is kept as a dated record.</p>
      </> : <form onSubmit={accept}><NannyAgreementFields value={agreement} onChange={setAgreement} legalName={application.fullName} /><button type="submit" className="btn-coral" disabled={busy}>{busy ? 'Recording…' : 'Record my agreement acceptance'}</button></form>}
      <div className="booking-actions"><Link href="/nanny-agreement" className="btn-ghost">Read the full agreement</Link><a href={NANNY_AGREEMENT_PDF} download className="btn-ghost">Download blank PDF</a>{(application.signedSubmitted || application.agreementReviewedAt) && <a href="/api/nanny/agreement" className="btn-ghost">Download my signed copy</a>}</div>
      {application.status === 'approved' && acceptance?.current && !application.agreementReviewedAt && <form onSubmit={upload} className="agreement-form"><h4>Return your signed agreement</h4><p>Complete your personal details, signature, date and witness details in the PDF. Our team completes its representative and activation fields.</p><label>Signed agreement (PDF, up to 4 MB)<input type="file" name="agreement" accept="application/pdf" required disabled={busy} /></label><label className="agreement-consent"><input type="checkbox" name="signed" value="true" required disabled={busy} /><span>I confirm that the required nanny and witness details and signatures are completed, and this is a genuine signed copy.</span></label><button type="submit" className="btn-coral" disabled={busy}>{busy ? 'Submitting…' : application.signedSubmitted ? 'Replace pending signed PDF' : 'Submit signed agreement'}</button></form>}
      {error && <p className="field-error-msg" role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
    </div>
    <div className={styles.record}><h3>Your submitted documents</h3><p className="field-hint">Only you and the authorised operations team can access these onboarding files.</p>{!documents.length ? <p>No documents could be listed for this application.</p> : <ul className={styles.documentList}>{documents.map(doc=><li key={doc.id}><a href={`/api/nanny/documents/${doc.id}`}>{documentKindLabel(doc.kind)} · {doc.file_name || 'Download file'}</a></li>)}</ul>}{!['approved','rejected'].includes(application.status)&&<NannyDocumentUpload/>}</div>
  </>
}
