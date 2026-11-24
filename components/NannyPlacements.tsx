'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CareCompletion from '@/components/CareCompletion'
import CompletionReportView from './CompletionReportView'
import BookingCalendar from '@/components/BookingCalendar'
import BookingThread from '@/components/BookingThread'
import {
  bookingHasThread,
  careTypeLabel,
  parseCareType,
  statusLabel,
} from '@/lib/booking'
import type { Booking } from '@/lib/types'

export default function NannyPlacements({ bookings }: { bookings: Booking[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function act(id: string, action: 'accept' | 'decline') {
    setBusy(id)
    setError('')
    try {
      const res = await fetch(`/api/booking/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Could not update this placement.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not connect. Your placement has not been changed; please retry.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="form-card">
        <h3>Availability calendar</h3>
        <p style={{ color: 'rgba(23,50,77,0.5)', marginBottom: 16, fontSize: '0.88rem' }}>
          Highlighted days are placements that block new assignments.
        </p>
        <BookingCalendar bookings={bookings} />
      </div>
      <div className="form-card">
        <h3>Assigned bookings</h3>
        {error && (
          <p role="alert" className="field-error-msg" style={{ marginBottom: 12 }}>
            {error}
          </p>
        )}
        {bookings.length === 0 && (
          <p style={{ color: 'rgba(23,50,77,0.5)' }}>No assignments yet.</p>
        )}
        {bookings.map((b) => {
          const awaiting =
            (b.my_response ?? b.nanny_response) !== 'accepted' &&
            (b.my_response ?? b.nanny_response) !== 'declined' &&
            (b.status === 'pending' || b.status === 'matched' || b.status === 'confirmed')
          return (
            <div
              key={b.id}
              style={{ padding: '12px 0', borderBottom: '1px solid rgba(23,50,77,0.06)' }}
            >
              <div className="review-row">
                <span className="review-key">
                  {b.destination} · {b.check_in} → {b.check_out}
                  <br />
                  <small>
                    {b.parent_name} · {statusLabel(b.status)} ·{' '}
                    {careTypeLabel(parseCareType(b.care_type))}
                  </small>
                </span>
                <span className="review-val">{b.children_count || ''} children</span>
              </div>
              {awaiting && (
                <div className="booking-actions">
                  <button
                    className="btn-coral"
                    disabled={busy === b.id}
                    onClick={() => act(b.id, 'accept')}
                  >
                    Accept
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={busy === b.id}
                    onClick={() => act(b.id, 'decline')}
                  >
                    Decline
                  </button>
                </div>
              )}
              {b.status === 'in_progress' && (
                <CareCompletion bookingId={b.id} completedAt={b.my_completed_at} savedReport={b.my_completion_report} />
              )}
              {b.status === 'completed' && b.my_completion_report && <CompletionReportView report={b.my_completion_report} name="Your placement" confirmedAt={b.my_completed_at} />}
              {bookingHasThread(b) && (
                <BookingThread
                  bookingId={b.id}
                  viewerRole="nanny"
                  counterpartName={b.parent_name}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
