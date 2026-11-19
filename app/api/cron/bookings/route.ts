import { NextRequest, NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron-auth'
import { advanceDueBookings } from '@/lib/booking-ops'
import { createServerClient, hasSupabaseConfig } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  if (
    !authorizedCron(
      request.headers.get('authorization'),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  try {
    const updated = await advanceDueBookings(createServerClient(), {
      strict: true,
    })
    return NextResponse.json(
      { ok: true, updated },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    console.error('Scheduled booking update failed.')
    return NextResponse.json(
      { error: 'Scheduled update failed.' },
      { status: 503 },
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
