import CareEnquiryView from '@/components/CareEnquiryView'
import { FAMILY_CARE_COLUMNS, type FamilyCareEnquiry } from '@/lib/care-enquiries'
import { requireProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import PageShell from '@/components/PageShell'
import Link from 'next/link'
import type { Booking, BookingStatus, Review } from '@/lib/types'
import SignOutButton from '@/components/SignOutButton'
import ClientBookings from '@/components/ClientBookings'
import ClientPayments, { type ClientPayment } from '@/components/ClientPayments'
import PortalNavigation from '@/components/PortalNavigation'
import PortalLoadError from '@/components/PortalLoadError'
import portal from '@/components/Portal.module.css'
import AccountProfileForm from '@/components/AccountProfileForm'
import MediaImage from '@/components/MediaImage'
import { advanceDueBookings } from '@/lib/booking-ops'

export const metadata = { title: 'Client portal — VacayNanny' }

function escapeIlikeExact(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

const OPEN_STATUSES: BookingStatus[] = ['pending', 'matched', 'confirmed', 'in_progress']

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'YN'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function memberSince(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function tripWhen(booking: Booking) {
  const [year, month, day] = booking.check_in.split('-').map(Number)
  if (!year || !month || !day) return booking.check_in
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function AccountPage() {
  const profile = await requireProfile(['parent', 'admin', 'nanny'])
  let bookings: Booking[] = []
  let careEnquiries: FamilyCareEnquiry[] = []
  let payments: ClientPayment[] = []
  let dataError: string | null = null
  try {
    const supabase = createServerClient()
    await advanceDueBookings(supabase)
    const columns =
      '*, nannies!bookings_nanny_id_fkey(id, display_name, slug, photo_url, tier, daily_rate_kes),booking_assignments(slot,nanny_id,response,completed_at,completion_report,report_submitted_at,nannies(id,display_name,slug,photo_url,tier))'
    const queries = [
      supabase.from('bookings').select(columns).eq('parent_id', profile.id),
    ]
    if (profile.emailConfirmed && profile.email) {
      queries.push(
        supabase
          .from('bookings')
          .select(columns)
          .ilike('email', escapeIlikeExact(profile.email))
          .is('parent_id', null),
      )
    }
    const results = await Promise.all(queries)
    if (results.some(result => result.error)) throw new Error('Booking lookup failed')
    const merged = new Map<string, Booking>()
    for (const result of results) {
      for (const row of (result.data || []) as Booking[]) merged.set(row.id, row)
    }
    bookings = [...merged.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )
    const careQueries = [
      supabase
        .from('contact_messages')
        .select<string, FamilyCareEnquiry>(FAMILY_CARE_COLUMNS)
        .eq('family_id', profile.id)
        .not('care_service', 'is', null),
    ]
    if (profile.emailConfirmed && profile.email)
      careQueries.push(
        supabase
          .from('contact_messages')
          .select<string, FamilyCareEnquiry>(FAMILY_CARE_COLUMNS)
          .is('family_id', null)
          .ilike('email', escapeIlikeExact(profile.email))
          .not('care_service', 'is', null),
      )
    const careRows = await Promise.all(careQueries)
    if (careRows.some(result => result.error)) throw new Error('Care enquiry lookup failed')
    careEnquiries = [
      ...new Map(
        careRows
          .flatMap((result) => (result.data || []) as unknown as FamilyCareEnquiry[])
          .map((row) => [row.id, row]),
      ).values(),
    ]
    const bookingIds = bookings.map((b) => b.id)
    if (bookingIds.length) {
      const { data: reviewRows, error: reviewError } = await supabase
        .from('reviews')
        .select('id, booking_id, rating, body, trip_label, is_published, created_at')
        .in('booking_id', bookingIds)
      if (reviewError) throw new Error('Reviews could not be loaded')
      const paymentRows = await supabase.from('payment_attempts')
        .select('id,booking_id,reference,amount_subunit,currency,status,channel,paid_at,created_at')
        .in('booking_id', bookingIds).order('created_at', { ascending: false })
      if (paymentRows.error) throw new Error('Payment records could not be loaded')
      payments = (paymentRows.data || []).map(p=>({id:p.id,booking_id:p.booking_id,reference:p.reference,amount_subunit:p.amount_subunit,currency:p.currency,status:p.status,channel:p.channel,paid_at:p.paid_at,created_at:p.created_at})) as ClientPayment[]
      const byBooking = new Map(
        (
          (reviewRows || []) as Pick<
            Review,
            | 'id'
            | 'booking_id'
            | 'rating'
            | 'body'
            | 'trip_label'
            | 'is_published'
            | 'created_at'
          >[]
        )
          .filter((r) => r.booking_id)
          .map((r) => [r.booking_id as string, r]),
      )
      bookings = bookings.map((b) => ({ ...b, review: byBooking.get(b.id) ?? null }))
    }
  } catch {
    dataError = 'Your booking, quote or payment records could not all be loaded. Refresh before relying on these details or making changes.'
  }

  const name = profile.full_name?.trim() || 'there'
  const since = memberSince(profile.created_at)
  const openTrips = bookings.filter((booking) => OPEN_STATUSES.includes(booking.status))
  const waitingOnYou = openTrips.filter(
    (booking) =>
      booking.status === 'matched' && booking.nanny_id && !booking.parent_confirmed_at,
  )
  const completed = bookings.filter((booking) => booking.status === 'completed').length
  const now = new Date()
  const today = now.toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'})
  const nextTrip =
    [...openTrips]
      .sort((a, b) => a.check_in.localeCompare(b.check_in))
      .find((booking) => booking.check_in >= today) ??
    [...openTrips].sort((a, b) => a.check_in.localeCompare(b.check_in))[0]

  return (
    <PageShell>
      <div className="account-page">
        <header className="account-hero">
          <div className="account-identity">
            <div className="account-avatar">
              {profile.avatar_url ? (
                <MediaImage
                  className="account-avatar-img"
                  src={profile.avatar_url}
                  alt=""
                  fill
                  sizes="84px"
                />
              ) : (
                <span>{initials(profile.full_name || '')}</span>
              )}
            </div>
            <div>
              <p className="account-kicker">Client portal</p>
              <h1>
                Hello, <em>{name}</em>
              </h1>
              <p className="account-meta">
                {profile.email || 'Signed in'}
                {profile.phone ? ` · ${profile.phone}` : ''}
                {since ? ` · Member since ${since}` : ''}
              </p>
            </div>
          </div>
          <div className="account-hero-actions">
            <Link href="/nannies" className="btn-coral">
              Book a nanny
            </Link>
            <SignOutButton />
          </div>
        </header>
        <PortalNavigation label="Client portal" items={[
          { id:'client-overview', label:'Overview' }, { id:'client-bookings', label:'Bookings & messages' },
          { id:'client-payments', label:'Payments' }, { id:'client-care', label:'Specialist care' },
          { id:'client-profile', label:'Your details' }, { id:'client-support', label:'Support & security' },
        ]} />
        {dataError && <PortalLoadError message={dataError} />}

        <section id="client-overview" className="account-stats" aria-label="Booking summary">
          <article>
            <span>{openTrips.length}</span>
            <small>{openTrips.length === 1 ? 'Open trip' : 'Open trips'}</small>
          </article>
          <article className={waitingOnYou.length ? 'is-attention' : undefined}>
            <span>{waitingOnYou.length}</span>
            <small>
              {waitingOnYou.length === 1 ? 'Match to confirm' : 'Matches to confirm'}
            </small>
          </article>
          <article>
            <span>{completed}</span>
            <small>{completed === 1 ? 'Completed trip' : 'Completed trips'}</small>
          </article>
        </section>

        {nextTrip && (
          <p className="account-next">
            Next trip · <strong>{nextTrip.destination}</strong> · {tripWhen(nextTrip)}
            {nextTrip.nannies?.display_name
              ? ` · ${nextTrip.nannies.display_name}`
              : ' · Awaiting a nanny'}
          </p>
        )}

        <div className="account-layout">
          <div className="account-trips">
          <section id="client-bookings" className={portal.section} aria-labelledby="account-trips-title">
            <div className="account-section-head">
              <h2 id="account-trips-title">Your trips</h2>
              <p>
                Confirm matches, message your nanny, reschedule, or review a completed
                stay.
              </p>
            </div>
            {!dataError && <ClientBookings bookings={bookings} />}
          </section>
          <section id="client-payments" className={portal.section} aria-labelledby="client-payment-title">
            <h2 id="client-payment-title">Your payments</h2>
            {!dataError && <ClientPayments payments={payments} bookings={bookings} />}
          </section>
          <section id="client-care" className={portal.section} aria-labelledby="client-care-title">
            <h2 id="client-care-title">Specialist care requests</h2>
            <p>Review care plans, quotes and expiry dates, accept an agreed scope, and follow its status here.</p>
            {!dataError && !careEnquiries.length && <div className={portal.record}><h3>No specialist requests yet</h3><p>For additional childcare needs, adult support or nursing care, request an assessment before arranging care.</p><Link className="btn-ghost" href="/contact?service=Specialised%20Childcare">Request specialist care</Link></div>}
            {!dataError && careEnquiries.map((enquiry) => (
              <CareEnquiryView key={enquiry.id} enquiry={enquiry} />
            ))}
          </section>
          <section id="client-support" className={portal.section} aria-labelledby="client-support-title">
            <h2 id="client-support-title">Support &amp; account security</h2>
            <div className={portal.record}><p>Messages about an accepted booking stay with that booking. For assistance with an unconfirmed request, payments, cancellation or your personal details, contact our team and include the booking reference.</p><div className="booking-actions"><Link className="btn-ghost" href="/contact">Contact VacayNanny</Link><Link className="btn-ghost" href="/forgot-password">Change your password</Link><Link className="btn-ghost" href="/privacy">Privacy &amp; data requests</Link></div><p className="field-hint">Sign-in requires your password and an emailed code. Share a care completion code with the assigned nanny only after their agreed care is complete.</p></div>
          </section>
          </div>
          <section id="client-profile" className={portal.section} aria-label="Your account details"><AccountProfileForm profile={profile} /></section>
        </div>
      </div>
    </PageShell>
  )
}
