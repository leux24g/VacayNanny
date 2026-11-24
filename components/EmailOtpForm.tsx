'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
export default function EmailOtpForm({
  purpose,
  next = '/account',
  initialMessage = '',
  initialRole = 'parent',
}: {
  purpose: 'login' | 'signup' | 'reset'
  next?: string
  initialMessage?: string
  initialRole?: 'parent' | 'nanny'
}) {
  const signup = purpose === 'signup',
    reset = purpose === 'reset',
    router = useRouter()
  const [email, setEmail] = useState(''),
    [fullName, setFullName] = useState(''),
    [password, setPassword] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [role, setRole] = useState(initialRole),
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
        body: JSON.stringify({ purpose, email, fullName, role, password }),
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
        body: JSON.stringify({
          purpose,
          challengeId: challenge,
          code,
          next,
          password: signup || reset ? password : undefined,
        }),
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
          ) : reset ? (
            <>
              Reset your <em>password</em>
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
              ? 'Choose your password, then verify your email to create your account.'
              : reset
                ? 'Choose a new password and verify it with the code sent to your email.'
                : 'Enter your email and password. We’ll then email a verification code.'}
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
          <div className="field">
            <div className="login-label-row">
              <label htmlFor="auth-password">
                {signup || reset ? 'New password' : 'Password'}
              </label>
              {!signup && !reset && <Link href="/forgot-password">Forgot password?</Link>}
            </div>
            <div className="login-password">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup || reset ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={signup || reset ? 12 : 1}
                maxLength={256}
                required
              />
              <button
                type="button"
                className="login-reveal"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {(signup || reset) && (
              <p className="field-hint">Use at least 12 characters.</p>
            )}
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
                      onChange={() => setRole(r.value === 'nanny' ? 'nanny' : 'parent')}
                    />
                    <span>{r.label}</span>
                    <small>{r.hint}</small>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {signup && role === 'nanny' && <p className="field-hint">First <Link href="/become-a-nanny">complete your nanny application and accept the agreement</Link>, then register using that same email. Your application and activation status will appear in your nanny portal.</p>}
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
              : reset
                ? 'Send reset code'
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
        {signup || reset ? 'Already have an account?' : 'New here?'}{' '}
        <Link href={signup || reset ? '/login' : '/signup'}>
          {signup || reset ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  )
}
