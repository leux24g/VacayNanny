import { requireProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import PageShell from '@/components/PageShell'
import SignOutButton from '@/components/SignOutButton'
import Link from 'next/link'
import { getDestinations } from '@/lib/data'
import { destinationNames } from '@/lib/destinations'
import type { Booking, Nanny, Review } from '@/lib/types'
import NannyPlacements from '@/components/NannyPlacements'
import NannyProfileEditor from '@/components/NannyProfileEditor'
import NannyEarnings from '@/components/NannyEarnings'
import NannyOnboardingPanel, { type ApplicantView } from '@/components/NannyOnboardingPanel'
import PortalNavigation from '@/components/PortalNavigation'
import PortalLoadError from '@/components/PortalLoadError'
import AccountProfileForm from '@/components/AccountProfileForm'
import { advanceDueBookings } from '@/lib/booking-ops'
import { needsSafeguardingModule } from '@/lib/safeguarding'
import { ownNannyApplication, loadAgreementSummary, type AgreementSummary } from '@/lib/nanny-onboarding'
import type { DocumentKind } from '@/lib/types'
import portal from '@/components/Portal.module.css'

export const metadata = { title: 'Nanny portal | VacayNanny' }

export default async function NannyDash() {
  const profile = await requireProfile(['parent', 'nanny', 'admin'])
  let nanny: Nanny | null = null, bookings: Booking[] = [], reviews: Review[] = []
  let application: ApplicantView | null = null, acceptance: AgreementSummary | null = null
  let documents: Array<{id:string;kind:DocumentKind;file_name:string|null}> = []
  let dataError: string | null = null
  const destinationCatalog = destinationNames(await getDestinations())
  try {
    const db = createServerClient()
    await advanceDueBookings(db)
    const result = await db.from('nannies').select('*').eq('user_id',profile.id).maybeSingle()
    if (result.error) throw new Error('Profile lookup failed')
    nanny = result.data as Nanny | null
    const app = await ownNannyApplication(db,profile,nanny?.application_id || undefined)
    if (app) {
      acceptance = await loadAgreementSummary(db,app.id)
      const docs = await db.from('nanny_documents').select('id,kind,file_name').eq('application_id',app.id)
      if (docs.error) throw new Error('Document lookup failed')
      documents = docs.data || []
      application = {
        id:app.id,fullName:app.full_name,status:app.status,email:app.email,
        phone:[app.country_code,app.phone].filter(Boolean).join(' '),identityLast4:app.national_id_number?.slice(-4) || '',
        tier:app.estimated_tier,submittedAt:app.created_at,interviewAt:app.interview_at,
        signedSubmitted:Boolean(app.agreement_submitted_path),agreementReviewedAt:app.agreement_reviewed_at || null,
        active:Boolean(nanny?.is_active && !nanny?.is_suspended),
        needsCompleteApplication:Boolean(app.legacy_nanny_id&&!app.legacy_completed_at),
      }
    }
    if (nanny) {
      const assignments = await db.from('booking_assignments').select('booking_id,response,completed_at,completion_report').eq('nanny_id',nanny.id)
      if (assignments.error) throw new Error('Assignments lookup failed')
      if (assignments.data?.length) {
        const rows = await db.from('bookings').select('*,booking_assignments(slot,nanny_id,response,completed_at,completion_report,report_submitted_at,nannies(id,display_name,slug,photo_url,tier))').in('id',assignments.data.map(a=>a.booking_id)).order('check_in')
        if (rows.error) throw new Error('Bookings lookup failed')
        bookings = ((rows.data || []) as Booking[]).map(b=>({ ...b,my_response:assignments.data!.find(a=>a.booking_id===b.id)?.response,my_completed_at:assignments.data!.find(a=>a.booking_id===b.id)?.completed_at,my_completion_report:assignments.data!.find(a=>a.booking_id===b.id)?.completion_report,booking_assignments:b.booking_assignments?.map(a=>a.nanny_id===nanny!.id?a:{slot:a.slot,nanny_id:a.nanny_id,response:a.response,nannies:a.nannies}) }))
      }
      const feedback = await db.from('reviews').select('id,nanny_id,parent_name,trip_label,rating,body,is_published,created_at').eq('nanny_id',nanny.id).eq('is_published',true).order('created_at',{ascending:false})
      if (feedback.error) throw new Error('Feedback lookup failed')
      reviews = (feedback.data || []) as Review[]
    }
  } catch { dataError = 'Your profile, application or placement records could not all be loaded. Refresh your portal before making changes.' }
  return <PageShell>
    <section className="page-hero"><div className="eyebrow">Nanny portal</div><h1>Your work, <em>in one place</em></h1><p>Follow onboarding, manage your profile and availability, respond to placements, communicate with families and track completion and payouts.</p></section>
    <div className="sec-inner dash-page">
      <div className="dash-toolbar">{nanny && <a href="#nanny-profile" className="btn-coral">Update my profile photo</a>}{nanny?.is_active && <Link href={`/nannies/${nanny.slug}`} className="btn-ghost">View public profile</Link>}<Link href="/account" className="btn-ghost">My client portal</Link>{profile.role === 'admin' && <Link href="/admin" className="btn-ghost">Admin workspace</Link>}<SignOutButton /></div>
      <PortalNavigation label="Nanny portal" items={[{id:'nanny-overview',label:'Overview'},{id:'nanny-onboarding',label:'Application & agreement'},{id:'nanny-profile',label:'Profile & availability'},{id:'nanny-placements',label:'Placements & messages'},{id:'nanny-payouts',label:'Payouts'},{id:'nanny-feedback',label:'Feedback'},{id:'nanny-account',label:'Account & support'}]} />
      {dataError ? <PortalLoadError message={dataError} /> : <>
        <section id="nanny-overview" className={portal.section} aria-label="Your nanny overview"><div className={portal.actions}>
          <a href="#nanny-onboarding" className={portal.action}><strong>{application?.active ? 'Your profile is active' : application ? 'Onboarding in progress' : 'Start your application'}</strong><span>Agreement, checks and activation status</span></a>
          <a href="#nanny-placements" className={portal.action}><strong>{bookings.filter(b=>b.my_response==='pending' && ['matched','pending'].includes(b.status)).length} offers to review</strong><span>Accept or decline individual placements</span></a>
          <a href="#nanny-placements" className={portal.action}><strong>{bookings.filter(b=>b.status==='in_progress').length} placements in progress</strong><span>Messages, handovers and completion confirmation</span></a>
        </div></section>
        <section id="nanny-onboarding" className={portal.section} aria-labelledby="nanny-onboarding-title"><h2 id="nanny-onboarding-title">Application &amp; agreement</h2><NannyOnboardingPanel application={application} acceptance={acceptance} documents={documents} /></section>
        <section id="nanny-profile" className={portal.section} aria-labelledby="nanny-profile-title"><h2 id="nanny-profile-title">Profile &amp; availability</h2>
          {nanny ? <>{needsSafeguardingModule(nanny) && <div className={portal.notice}><h3>Elite safeguarding required</h3><p>Your approved tier is Gold. Complete the module before your profile is shown at Elite level.</p><Link href="/nanny/safeguarding" className="btn-coral">Complete safeguarding</Link></div>}
            {nanny.is_suspended ? <div className={portal.notice}><h3>Profile suspended</h3><p>Contact VacayNanny for a review before accepting new placements. Your existing placement records remain available below.</p></div> : <NannyProfileEditor nanny={nanny} destinationCatalog={destinationCatalog} />}</> : <div className={portal.record}><p>Your public profile and availability editor become available after the team completes verification and confirms activation.</p></div>}
        </section>
        <section id="nanny-placements" className={portal.section} aria-labelledby="nanny-placements-title"><h2 id="nanny-placements-title">Placements &amp; messages</h2><NannyPlacements bookings={bookings} /></section>
        <section id="nanny-payouts" className={portal.section} aria-labelledby="nanny-payouts-title"><h2 id="nanny-payouts-title">Payouts</h2><NannyEarnings bookings={bookings} /></section>
        <section id="nanny-feedback" className={portal.section} aria-labelledby="nanny-feedback-title"><h2 id="nanny-feedback-title">Your client feedback</h2>{reviews.length ? reviews.map(review=><article className={portal.record} key={review.id}><h3>{review.rating} / 5 · {review.parent_name}</h3><p>{review.body}</p><small>{review.trip_label}</small></article>) : <p>No published client feedback yet.</p>}</section>
      </>}
      <section id="nanny-account" className={portal.section} aria-labelledby="nanny-account-title"><h2 id="nanny-account-title">Account &amp; support</h2><div className={portal.grid}><AccountProfileForm profile={profile} /><div className={portal.record}><h3>Help with your work</h3><p>Contact the team about onboarding, safeguarding, placement concerns, payout statements, payment-detail changes or a decision review. In an emergency, seek urgent assistance first and then use the booking contacts.</p><div className="booking-actions"><Link href="/contact" className="btn-ghost">Contact our team</Link><Link href="/forgot-password" className="btn-ghost">Change password</Link><Link href="/nanny-agreement" className="btn-ghost">Read your agreement</Link>{nanny && <Link href="/nanny/safeguarding" className="btn-ghost">Safeguarding module</Link>}</div></div></div></section>
    </div>
  </PageShell>
}
