import Nav from '@/components/Nav'
import AuthVisual from '@/components/AuthVisual'
import EmailOtpForm from '@/components/EmailOtpForm'
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams
  return (
    <>
      <Nav />
      <main className="login-stage" id="main-content">
        <AuthVisual />
        <div className="login-panel">
          <EmailOtpForm purpose="signup" initialRole={role === 'nanny' ? 'nanny' : 'parent'} />
        </div>
      </main>
    </>
  )
}
