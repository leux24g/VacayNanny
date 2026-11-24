import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhook } from '@/lib/payment-rules'
import { reconcilePayment } from '@/lib/paystack'
import { createServerClient } from '@/lib/supabase/service'
import { paystackSettings, type PaystackEnvironment } from '@/lib/paystack-settings'

export async function handlePaystackWebhook(request: NextRequest, environment?: PaystackEnvironment) {
  let settings
  try {
    settings = paystackSettings()
  } catch {
    return new NextResponse('Payments unavailable', { status: 503 })
  }
  if (environment && settings.environment !== environment)
    return new NextResponse('Payment environment unavailable', { status: 404 })
  if (!settings.secretKey)
    return new NextResponse('Payments unavailable', { status: 503 })
  const raw = Buffer.from(await request.arrayBuffer())
  if (!verifyWebhook(raw, request.headers, settings.secretKey, settings.webhookSecret))
    return new NextResponse('Invalid signature', { status: 401 })
  try {
    const event = JSON.parse(raw.toString('utf8'))
    if (event.event === 'charge.success') {
      const reference = event.data?.reference
      if (typeof reference !== 'string' || !/^VN-[0-9a-f-]{36}$/i.test(reference))
        return NextResponse.json({ received: true })
      // A signed event still needs independent verification in the selected mode.
      await reconcilePayment(createServerClient(), reference)
    }
    return NextResponse.json({ received: true })
  } catch {
    console.error('Paystack event reconciliation failed')
    return new NextResponse('Please retry', { status: 500 })
  }
}
