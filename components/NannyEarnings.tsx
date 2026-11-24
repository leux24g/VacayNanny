import { formatKes } from '@/lib/constants'
import { statusLabel, summarizeNannyEarnings } from '@/lib/booking'
import type { Booking } from '@/lib/types'
import { TIER_COMMISSION } from '@/lib/nanny-agreement-rules'

export default function NannyEarnings({ bookings }: { bookings: Booking[] }) {
  const stats = summarizeNannyEarnings(bookings)
  const completed = bookings.filter(b => b.status === 'completed')

  return (
    <div className="form-card">
      <h3>Booking values &amp; payout terms</h3>
      <p className="field-hint" style={{ marginBottom: 16 }}>
        Quoted family totals for your placements. Payouts are processed by VacayNanny after a booking is completed — this is not a wallet balance.
      </p>
      <details className="agreement-commercial"><summary>Current agreement commission and payout process</summary><ul>{Object.entries(TIER_COMMISSION).map(([tier,rate]) => <li key={tier}>{tier[0].toUpperCase()+tier.slice(1)}: {rate.commission} platform commission · {rate.payout} nanny share of agreed service charges.</li>)}</ul><p>Approved pass-through expenses and taxes collected for remittance are treated as stated in your agreement. Your individual share and any adjustment are checked against the booking record. Historical bookings keep their agreed terms.</p><p>Complete your booking report and obtain the client completion confirmation. Once these are received and checked, payout is processed to your verified details within three business days, subject to a documented dispute or legal restriction. Contact the team for your payout statement; the amounts below are family totals and do not show money already transferred to you.</p></details>
      <div className="earnings-grid">
        <div>
          <div className="stat-num">{formatKes(stats.completedKes)}</div>
          <div className="stat-lbl">{stats.completedCount} completed</div>
        </div>
        <div>
          <div className="stat-num">{formatKes(stats.upcomingKes)}</div>
          <div className="stat-lbl">{stats.upcomingCount} upcoming{stats.inProgressCount ? ` · ${stats.inProgressCount} in progress` : ''}</div>
        </div>
      </div>
      {completed.length === 0 && (
        <p style={{ color: 'rgba(23,50,77,0.5)', marginTop: 8 }}>No completed placements yet.</p>
      )}
      {completed.map(b => (
        <div className="review-row" key={b.id}>
          <span className="review-key">
            {b.destination} · {b.check_in} → {b.check_out}
            <br />
            <small>{b.parent_name} · {statusLabel(b.status)}</small>
          </span>
          <span className="review-val">{b.total_amount_kes != null ? formatKes(b.total_amount_kes) : '—'}</span>
        </div>
      ))}
    </div>
  )
}
