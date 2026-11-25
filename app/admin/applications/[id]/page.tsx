import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { sortDocuments } from '@/lib/application-docs'
import PageShell from '@/components/PageShell'
import AdminApplicationReview from '@/components/AdminApplicationReview'
import type { NannyApplication, NannyDocument, NannyReference } from '@/lib/types'
import { loadAgreementSummary, type AgreementSummary } from '@/lib/nanny-onboarding'
import PortalLoadError from '@/components/PortalLoadError'

export const metadata = { title: 'Review application | VacayNanny' }

export default async function AdminApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireProfile(['admin'])
  const { id } = await params

  let application: NannyApplication | null = null
  let references: NannyReference[] = []
  let documents: NannyDocument[] = []
  let acceptance: AgreementSummary | null = null
  let dataError = false
  try {
    const supabase = createServerClient()
    const { data: app, error } = await supabase.from('nanny_applications').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error('Application lookup failed')
    application = (app as NannyApplication | null) ?? null
    if (application) {
      const [{ data: refs, error: refError }, { data: docs, error: docError }] = await Promise.all([
        supabase.from('nanny_references').select('*').eq('application_id', id).order('sort_order'),
        supabase.from('nanny_documents').select('*').eq('application_id', id),
      ])
      if (refError || docError) throw new Error('Evidence lookup failed')
      acceptance = await loadAgreementSummary(supabase,id)
      references = (refs || []) as NannyReference[]
      documents = sortDocuments((docs || []) as NannyDocument[])
    }
  } catch { dataError = true }

  if (dataError) return <PageShell><section className="page-hero"><h1>Application temporarily unavailable</h1></section><div className="sec-inner dash-page"><PortalLoadError message="The complete application and its evidence could not be loaded. Refresh before making a decision." /><Link href="/admin">Return to admin workspace</Link></div></PageShell>

  if (!application) notFound()

  return (
    <PageShell>
      <section className="page-hero">
        <Link href="/admin" className="nav-back" style={{ justifyContent: 'center', marginBottom: 16 }}>← All applications</Link>
        <div className="eyebrow">Vetting</div>
        <h1>{application.full_name}</h1>
        <p>{application.email} · {application.status} · {application.estimated_tier}</p>
      </section>
      <div className="sec-inner dash-page">
        <AdminApplicationReview
          application={application}
          references={references}
          documents={documents}
          acceptance={acceptance}
        />
      </div>
    </PageShell>
  )
}
