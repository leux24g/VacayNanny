'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
export default function CareCompletion({
  bookingId,
  completedAt,
}: {
  bookingId: string
  completedAt?: string | null
}) {
  const router = useRouter(),
    [challenge, setChallenge] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [resendAt, setResendAt] = useState(0),
    [verified, setVerified] = useState(false)
  async function submit(verify = false) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/booking/${bookingId}/completion`, {
        method: verify ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verify ? { challengeId: challenge, code } : {}),
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
        <p>Your work has been confirmed by the family.</p>
      ) : (
        <>
          <p>
            The family receives a code by email. Enter it here after completing your
            agreed care.
          </p>
          {!challenge ? (
            <button className="btn-coral" disabled={busy} onClick={() => submit()}>
              {busy ? 'Sending…' : 'Send completion code to family'}
            </button>
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
