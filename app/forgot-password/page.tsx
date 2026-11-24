'use client'
import Nav from '@/components/Nav'
import AuthVisual from '@/components/AuthVisual'
import EmailOtpForm from '@/components/EmailOtpForm'
export default function ForgotPasswordPage() {
  return (
    <>
      <Nav />
      <main className="login-stage" id="main-content">
        <AuthVisual />
        <div className="login-panel">
          <EmailOtpForm purpose="reset" />
        </div>
      </main>
    </>
  )
}
