'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import AuthVisual from '@/components/AuthVisual'
import EmailOtpForm from '@/components/EmailOtpForm'
function LoginForm() {
  const params = useSearchParams()
  return (
    <>
      <Nav />
      <main className="login-stage" id="main-content">
        <AuthVisual />
        <div className="login-panel">
          <EmailOtpForm
            purpose="login"
            next={params.get('next') || '/account'}
            initialMessage={
              params.get('password') === 'reset'
                ? 'Your password has been updated. Sign in with your new password.'
                : params.get('message') || ''
            }
          />
        </div>
      </main>
    </>
  )
}
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
