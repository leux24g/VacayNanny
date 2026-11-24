'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
export default function EmailOtpForm({
  purpose,
  next = '/account',
  initialMessage = '',
}: {
  purpose: 'login' | 'signup'
  next?: string
  initialMessage?: string
}) {
  const signup = purpose === 'signup',
    router = useRouter()
  const [email, setEmail] = useState(''),
    [fullName, setFullName] = useState(''),
    [role, setRole] = useState('parent'),
    [challenge, setChallenge] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialMessage),
    [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])
  async function requestCode() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, email, fullName, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not send your code.')
        return
      }
      setChallenge(data.challengeId)
      setCode('')
      setWait(data.resendAfter)
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  async function verify() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, challengeId: challenge, code, next }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not verify your code.')
        return
      }
      router.push(data.next)
      router.refresh()
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="auth-card"
      autoComplete="on"
      onSubmit={(e) => {
        e.preventDefault()
        void (challenge ? verify() : requestCode())
      }}
    >
      <div className="login-heading">
        <div className="eyebrow">Your account</div>
        <h1>
          {challenge ? (
            <>
              Check your <em>email</em>
            </>
          ) : signup ? (
            <>
              Create your <em>account</em>
            </>
          ) : (
            <>
              Sign <em>in</em>
            </>
          )}
        </h1>
        <p>
          {challenge
            ? `Enter the six-digit code sent to ${email}. It expires in 10 minutes.`
            : signup
              ? 'Create your account with an email verification code.'
              : 'Enter your email and we’ll send a code to sign you in.'}
        </p>
      </div>
      {!challenge ? (
        <>
          {signup && (
            <div className="field">
              <label htmlFor="auth-name">Full name</label>
              <input
                id="auth-name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={120}
                required
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          {signup && (
            <fieldset className="signup-roles">
              <legend>I am a</legend>
              <div className="signup-role-row">
                {[
                  { value: 'parent', label: 'Parent', hint: 'Booking childcare' },
                  { value: 'nanny', label: 'Nanny', hint: 'Applying to join' },
                ].map((r) => (
                  <label className="signup-role" key={r.value}>
                    <input
                      type="radio"
                      name="role"
                      checked={role === r.value}
                      onChange={() => setRole(r.value)}
                    />
                    <span>{r.label}</span>
                    <small>{r.hint}</small>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </>
      ) : (
        <div className="field">
          <label htmlFor="auth-code">Email verification code</label>
          <input
            className="otp-code"
            id="auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-describedby="otp-hint"
            required
            autoFocus
          />
          <p className="field-hint" id="otp-hint">
            Use the latest code. Keep your sign-in code private.
          </p>
        </div>
      )}
      {error && (
        <p className="field-error-msg" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn-submit"
        disabled={busy || Boolean(challenge && code.length !== 6)}
      >
        {busy
          ? 'Please wait…'
          : challenge
            ? 'Verify and continue'
            : signup
              ? 'Create account'
              : 'Send sign-in code'}
      </button>
      {challenge && (
        <div className="otp-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || wait > 0}
            onClick={() => requestCode()}
          >
            {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              setChallenge('')
              setError('')
            }}
          >
            Change email
          </button>
        </div>
      )}
      <p className="auth-switch">
        {signup ? 'Already have an account?' : 'New here?'}{' '}
        <Link href={signup ? '/login' : '/signup'}>
          {signup ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  )
}
