import { NextRequest } from 'next/server'
import { handlePaystackWebhook } from '@/lib/paystack-webhook'

export const runtime = 'nodejs'

// Compatibility for existing dashboards; new configuration uses /uat or /prod.
export async function POST(request: NextRequest) {
  return handlePaystackWebhook(request)
}
