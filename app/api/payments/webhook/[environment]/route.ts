import { NextRequest, NextResponse } from 'next/server'
import { handlePaystackWebhook } from '@/lib/paystack-webhook'

export const runtime = 'nodejs'
export async function POST(request: NextRequest, { params }: { params: Promise<{ environment: string }> }) {
  const { environment } = await params
  if (environment !== 'uat' && environment !== 'prod')
    return new NextResponse('Unknown payment environment', { status: 404 })
  return handlePaystackWebhook(request, environment)
}
