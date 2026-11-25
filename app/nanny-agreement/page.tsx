import PageShell from '@/components/PageShell'
import agreement from '@/lib/nanny-agreement-content.json'
import { NANNY_AGREEMENT_PDF, NANNY_AGREEMENT_VERSION } from '@/lib/nanny-agreement-rules'

export const metadata = { title: 'Nanny participation agreement | VacayNanny' }

export default function NannyAgreementPage() {
  return <PageShell><main className="agreement-page sec-inner">
    <p className="eyebrow">Nanny onboarding · {NANNY_AGREEMENT_VERSION}</p>
    <h1>Read your participation <em>agreement</em></h1>
    <p>The full text below accompanies the original PDF supplied by VacayNanny. Read all pages and keep a copy. Complete your personal and payout details and confirm acceptance in your application. Our team completes tier and activation details after verification.</p>
    <div className="booking-actions"><a className="btn-coral" href={NANNY_AGREEMENT_PDF} download>Download original PDF</a><a className="btn-ghost" href="/become-a-nanny">Return to your application</a></div>
    {agreement.pages.map((text, index) => <section className="agreement-page-text" key={index} aria-label={`Agreement page ${index + 1}`}><p className="eyebrow">Page {index + 1} of {agreement.pages.length}</p><pre>{text}</pre></section>)}
  </main></PageShell>
}
