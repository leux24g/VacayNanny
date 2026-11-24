import Link from 'next/link'
import type { PaymentAttempt } from '@/lib/paystack'
import type { Booking } from '@/lib/types'
import { formatKes } from '@/lib/constants'
import styles from './Portal.module.css'

export type ClientPayment = Omit<PaymentAttempt, 'authorization_url'>
export default function ClientPayments({ payments, bookings }: { payments: ClientPayment[]; bookings: Booking[] }) {
  return <>
    <p className={styles.hint}>Pay from your booking after the match has been accepted by you and every assigned nanny. Successful payments appear here with a downloadable record. Refund requests remain under review until our team confirms the outcome.</p>
    {!payments.length && <div className={styles.record}><h3>No payment records yet</h3><p>Your payment history will appear here after checkout is opened for a booking.</p></div>}
    {payments.map(payment => <article className={styles.record} key={payment.id}>
      <h3>{bookings.find(b => b.id === payment.booking_id)?.destination || 'Booking payment'}</h3>
      <dl><dt>Amount</dt><dd>{formatKes(payment.amount_subunit / 100)}</dd><dt>Status</dt><dd>{payment.status === 'success' ? 'Paid' : payment.status === 'failed' ? 'Unsuccessful' : 'Pending confirmation'}</dd><dt>Reference</dt><dd>{payment.reference}</dd><dt>Date</dt><dd>{new Date(payment.paid_at || payment.created_at).toLocaleString('en-GB', { timeZone:'Africa/Nairobi' })} EAT</dd><dt>Method</dt><dd>{payment.channel || 'Paystack checkout'}</dd></dl>
      {payment.status === 'success' && <a className="btn-ghost" href={`/api/account/payments/${payment.id}/receipt`}>Download payment record (.txt)</a>}
      <Link className="btn-ghost" href="#client-bookings">View your bookings</Link>
    </article>)}
  </>
}
