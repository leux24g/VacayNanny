import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/service'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AuthOtpError, consumeAuthOtp, establishOtpSession } from '@/lib/auth-otp'
import { limitOtp } from '@/lib/otp'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  try {
    const body = await request.json(),
      { challengeId, code, purpose } = body
    if (
      !/^[0-9a-f-]{36}$/i.test(challengeId || '') ||
      !/^\d{6}$/.test(code || '') ||
      !['login', 'signup', 'reset'].includes(purpose)
    )
      return NextResponse.json(
        { error: 'Enter the six-digit code from your email.' },
        { status: 400 },
      )
    const password = typeof body.password === 'string' ? body.password : ''
    if (
      (purpose === 'signup' || purpose === 'reset') &&
      (password.length < 12 || password.length > 256)
    )
      return NextResponse.json(
        { error: 'Use a password of 12 to 256 characters.' },
        { status: 400 },
      )
    const db = createServerClient()
    if (
      !(await limitOtp(
        db,
        challengeId,
        request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
        true,
      ))
    )
      return NextResponse.json(
        { error: 'Too many attempts. Request a new code later.' },
        { status: 429 },
      )
    const payload = await consumeAuthOtp(db, challengeId, purpose, code)
    if (!payload)
      return NextResponse.json(
        {
          error:
            'This code is incorrect, expired or already used. Try again or request a new code.',
        },
        { status: 400 },
      )
    const auth = await createSupabaseServer()
    const user = await establishOtpSession(db, auth, payload, password)
    if (!user)
      return NextResponse.json(
        { success: true, next: '/login?password=reset' },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    const claim = await db.rpc('claim_nanny_applications', {
      p_actor: user.id,
      p_verified_email: payload.email,
    })
    if (claim.error) throw new Error('Application linking is temporarily unavailable. Please sign in again.')
    const { data: profile } = await db
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const next =
      typeof body.next === 'string' &&
      body.next.startsWith('/') &&
      !body.next.startsWith('//') &&
      !body.next.includes('\\')
        ? body.next
        : '/account'
    return NextResponse.json(
      {
        success: true,
        next:
          profile?.role === 'admin'
            ? '/admin'
            : profile?.role === 'nanny' ||
                (purpose === 'signup' && payload.role === 'nanny')
              ? '/nanny'
              : next,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof AuthOtpError ? error.message : 'Could not finish sign-in. Please sign in again or request a new code.' },
      { status: error instanceof AuthOtpError ? error.status : 503 },
    )
  }
}
