'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { completionReportErrors, type CompletionReport } from '@/lib/completion-report'
import CompletionReportView from './CompletionReportView'
export default function CareCompletion({
  bookingId,
  completedAt,
  savedReport,
}: {
  bookingId: string
  completedAt?: string | null
  savedReport?: CompletionReport | null
}) {
  const router = useRouter(),
    [challenge, setChallenge] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [resendAt, setResendAt] = useState(0),
    [verified, setVerified] = useState(false)
  const [hours,setHours]=useState(savedReport ? String(savedReport.hoursWorked) : ''),[summary,setSummary]=useState(savedReport?.summary || ''),[additionalServices,setAdditionalServices]=useState(savedReport?.additionalServices || ''),[expenses,setExpenses]=useState(savedReport?.expenses || ''),[accuracy,setAccuracy]=useState(Boolean(savedReport))
  const report:CompletionReport={hoursWorked:Number(hours),summary,additionalServices,expenses,accuracy}
  async function submit(verify = false) {
    if(!verify){const errors=completionReportErrors(report);if(errors.length){setError(errors[0]);return}}
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/booking/${bookingId}/completion`, {
        method: verify ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verify ? { challengeId: challenge, code } : {report}),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Could not verify completion.')
        return
      }
      if (verify) {
        setVerified(true)
        setNotice(
          data.completed
            ? 'Care completion confirmed.'
            : 'Your work is confirmed. Waiting for the other nanny confirmations.',
        )
        setChallenge('')
        router.refresh()
      } else {
        setChallenge(data.challengeId)
        setCode('')
        setResendAt(Date.now() + data.resendAfter * 1000)
        setNotice(
          'Code sent to the family. Ask them to share it after your agreed care is complete.',
        )
      }
    } catch {
      setError('Could not connect. Please retry.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="care-completion" aria-label="Confirm care completion">
      <h4>Finish your care</h4>
      {completedAt || verified ? (
        <><p>Your work has been confirmed by the family.</p>{(savedReport || verified)&&<CompletionReportView report={savedReport || report} name="Your placement" confirmedAt={completedAt} />}</>
      ) : (
        <>
          <p>
            The family receives a code by email. Enter it here after completing your
            agreed care.
          </p>
          {!challenge ? (
            <form className="completion-report-form" onSubmit={event=>{event.preventDefault();void submit()}}>
              <h4>Booking completion &amp; payout report</h4>
              <label htmlFor={`hours-${bookingId}`}>Actual hours worked<input id={`hours-${bookingId}`} type="number" min="0.25" step="0.25" max="8784" value={hours} onChange={event=>{setHours(event.target.value);setAccuracy(false)}} required /></label>
              <label htmlFor={`summary-${bookingId}`}>Work completed and handover<textarea id={`summary-${bookingId}`} minLength={10} maxLength={2000} value={summary} onChange={event=>{setSummary(event.target.value);setAccuracy(false)}} required /></label>
              <label htmlFor={`extras-${bookingId}`}>Additional services already agreed (optional)<textarea id={`extras-${bookingId}`} maxLength={1000} value={additionalServices} onChange={event=>{setAdditionalServices(event.target.value);setAccuracy(false)}} /></label>
              <label htmlFor={`expenses-${bookingId}`}>Approved expense notes (optional)<textarea id={`expenses-${bookingId}`} maxLength={1000} value={expenses} onChange={event=>{setExpenses(event.target.value);setAccuracy(false)}} /></label>
              <label className="agreement-consent"><input type="checkbox" checked={accuracy} onChange={event=>setAccuracy(event.target.checked)} required /><span>I confirm that this report is accurate. I will obtain the family’s own completion confirmation and will not sign or confirm on their behalf.</span></label>
              <p className="field-hint">The family receives your report with its code. New charges or changes to agreed care need approval through VacayNanny; reporting an extra does not charge the family automatically.</p>
            <button type="submit" className="btn-coral" disabled={busy}>
              {busy ? 'Sending…' : 'Send completion code to family'}
            </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submit(true)
              }}
            >
              <label htmlFor={`complete-${bookingId}`}>Family completion code</label>
              <input
                id={`complete-${bookingId}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
              <div className="booking-actions">
                <button className="btn-coral" disabled={busy || code.length !== 6}>
                  {busy ? 'Verifying…' : 'Confirm work complete'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    if (Date.now() < resendAt) {
                      setError('Please wait one minute before requesting another code.')
                      return
                    }
                    void submit()
                  }}
                >
                  Send a new code
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={()=>{setChallenge('');setCode('');setNotice('');setAccuracy(false)}}>Edit completion report</button>
              </div>
            </form>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="field-error-msg">
          {error}
        </p>
      )}
    </section>
  )
}
