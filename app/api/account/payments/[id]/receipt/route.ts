import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile, profileOwnsBooking } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { formatKes } from '@/lib/constants'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) return new NextResponse('Sign in to download your payment record.', { status:401 })
  try {
    const { id } = await params, db = createServerClient()
    const payment = await db.from('payment_attempts').select('id,booking_id,reference,amount_subunit,currency,status,channel,paid_at').eq('id',id).maybeSingle()
    if (payment.error) throw new Error('Payment lookup failed')
    if (!payment.data) return new NextResponse('Payment record not found.', { status:404 })
    const booking = await db.from('bookings').select('*').eq('id',payment.data.booking_id).maybeSingle()
    if (booking.error) throw new Error('Booking lookup failed')
    if (!booking.data || (profile.role !== 'admin' && !profileOwnsBooking(profile,booking.data))) return new NextResponse('Payment record not found.', { status:404 })
    const p = payment.data, b = booking.data
    if (p.status !== 'success') return new NextResponse('A payment record is available after payment is confirmed.', { status:409 })
    const clean = (value: unknown) => String(value || '').replace(/[\r\n\u0000-\u001f]/g,' ')
    const content = ['VacayNanny: Payment record',`Reference: ${clean(p.reference)}`,`Booking: ${clean(b.id)}`,`Client: ${clean(b.parent_name)}`,`Destination: ${clean(b.destination)}`,`Dates: ${clean(b.check_in)} to ${clean(b.check_out)}`,`Amount received: ${formatKes(p.amount_subunit / 100)} (${clean(p.currency)})`,`Paid at: ${clean(p.paid_at)}`,`Method: ${clean(p.channel || 'Paystack checkout')}`,'','This records a confirmed payment. It is not a tax invoice or proof that a later refund has been processed.','Support: hello@vacaynanny.net'].join('\n')
    return new NextResponse(content,{ headers:{ 'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="vacaynanny-payment-${clean(p.reference).replace(/[^a-zA-Z0-9-]/g,'')}.txt"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' } })
  } catch { return new NextResponse('Your payment record could not be loaded. Please retry.',{status:503}) }
}
