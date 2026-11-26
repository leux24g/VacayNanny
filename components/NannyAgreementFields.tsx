'use client'

import Link from 'next/link'
import { NANNY_AGREEMENT_PDF, TIER_COMMISSION, type AgreementFields } from '@/lib/nanny-agreement-rules'

export default function NannyAgreementFields({ value, onChange, legalName }: {
  value: AgreementFields
  onChange: (next: AgreementFields) => void
  legalName: string
}) {
  const field = (key: keyof AgreementFields, next: string | boolean) => onChange({ ...value, [key]: next })
  return (
    <fieldset className="agreement-fields">
      <legend>Nanny agreement &amp; payout details</legend>
      <p>Read the full agreement before accepting. Your legal name, identity number, phone and email come from this application. An account can be created only after your application and acceptance are saved.</p>
      <div className="booking-actions">
        <Link href="/nanny-agreement" target="_blank" rel="noopener noreferrer" className="btn-ghost">Read the full agreement</Link>
        <a href={NANNY_AGREEMENT_PDF} download className="btn-ghost">Download agreement PDF</a>
      </div>
      <details className="agreement-commercial padded-disclosure">
        <summary>Commission and payout terms</summary>
        <table><caption>Rates in the supplied agreement</caption><thead><tr><th scope="col">Approved tier</th><th scope="col">Platform commission</th><th scope="col">Nanny share</th></tr></thead><tbody>
          {Object.entries(TIER_COMMISSION).map(([tier, rate]) => <tr key={tier}><th scope="row">{tier[0].toUpperCase() + tier.slice(1)}</th><td>{rate.commission}</td><td>{rate.payout}</td></tr>)}
        </tbody></table>
        <p>These rates apply to agreed service charges and paid additions. Separately itemised approved expenses and taxes collected for remittance are excluded as described in the agreement. Payout is processed within three business days after the completion form and client sign-off are received and checked, subject to a documented dispute or legal restriction.</p>
      </details>
      <div className="field"><label htmlFor="agreement-signer">Full legal name to confirm acceptance</label><input id="agreement-signer" autoComplete="name" value={value.agreementSignerName} onChange={e => field('agreementSignerName', e.target.value)} maxLength={120} placeholder={legalName || 'Your full legal name'} required /></div>
      <div className="field"><label htmlFor="payout-method">Payout method</label><select id="payout-method" value={value.payoutMethod} onChange={e => onChange({ ...value, payoutMethod: e.target.value, payoutAccountNumber: '', payoutBankName: '' })} required><option value="">Choose a method</option><option value="mpesa">M-Pesa</option><option value="bank">Bank account</option></select></div>
      <div className="field"><label htmlFor="payout-name">Payout account holder name</label><input id="payout-name" value={value.payoutAccountName} onChange={e => field('payoutAccountName', e.target.value)} maxLength={120} required /></div>
      {value.payoutMethod === 'bank' && <div className="field"><label htmlFor="payout-bank">Bank name</label><input id="payout-bank" value={value.payoutBankName} onChange={e => field('payoutBankName', e.target.value)} maxLength={100} required /></div>}
      <div className="field"><label htmlFor="payout-number">{value.payoutMethod === 'bank' ? 'Bank account number' : 'M-Pesa number'}</label><input id="payout-number" type={value.payoutMethod === 'bank' ? 'text' : 'tel'} value={value.payoutAccountNumber} onChange={e => field('payoutAccountNumber', e.target.value)} maxLength={40} required aria-describedby="payout-privacy" /><p id="payout-privacy" className="field-hint">Stored privately for verification. Never enter a PIN, password or verification code.</p></div>
      <label className="agreement-consent"><input type="checkbox" checked={value.agreementAccepted} onChange={e => field('agreementAccepted', e.target.checked)} required /><span>I have read and understood the Nanny Code of Conduct &amp; Marketplace Participation Agreement, including the commission and payout terms, and I accept it. I confirm that my details are accurate and that I have had the opportunity to ask questions and keep a copy.</span></label>
      <p className="field-hint">Your acceptance is recorded with the agreement version and date. A completed, signed and witnessed PDF and administrator verification are still required before your profile is activated for family bookings. Approved tier, approval date and VacayNanny representative details are completed by our team.</p>
    </fieldset>
  )
}
