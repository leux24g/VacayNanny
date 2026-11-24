'use client'
import type { Booking } from '@/lib/types'
import CompletionReportView from './CompletionReportView'

export default function AdminCompletionReports({bookings,onOpenBooking}:{bookings:Booking[];onOpenBooking:(id:string)=>void}) {
  const reports=bookings.flatMap(booking=>(booking.booking_assignments || []).filter(a=>a.completion_report).map(assignment=>({booking,assignment})))
  return <section className="ops-stack"><h2>Completion &amp; payout reviews</h2><p>Check the report, client confirmation, verified payout details and agreed commission before processing a manual payout. Completion confirmation does not record a transfer. The agreement provides three business days after the completed form and client sign-off are received and checked, subject to a documented dispute or legal restriction.</p>{!reports.length&&<p>No completion reports to review.</p>}{reports.map(({booking,assignment})=><article className="ops-card" key={`${booking.id}:${assignment.nanny_id}`}><h3>{booking.destination} · {booking.parent_name}</h3><p>Family payment: {booking.payment_status === 'paid'?'Received':booking.payment_status === 'not_required'?'Historical arrangement — verify balance':booking.payment_status || 'Check payment record'}</p><CompletionReportView report={assignment.completion_report!} name={assignment.nannies?.display_name || 'Assigned nanny'} confirmedAt={assignment.completed_at} /><button type="button" className="btn-ghost" onClick={()=>onOpenBooking(booking.id)}>Open booking for payout review</button></article>)}</section>
}
