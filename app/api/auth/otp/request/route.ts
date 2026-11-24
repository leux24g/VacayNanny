import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { requestAuthOtp } from '@/lib/auth-otp'
import { emailReady, limitOtp, OTP_SECONDS, OTP_RESEND_SECONDS } from '@/lib/otp'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = String(body.email || '')
        .trim()
        .toLowerCase(),
      purpose = body.purpose
    const name = String(body.fullName || '').trim(),
      role = body.role === 'nanny' ? 'nanny' : 'parent'
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 200 ||
      !['login', 'signup'].includes(purpose) ||
      (purpose === 'signup' && (!name || name.length > 120))
    )
      return NextResponse.json(
        { error: 'Enter a valid email and your name when signing up.' },
        { status: 400 },
      )
    if (!emailReady())
      return NextResponse.json(
        { error: 'Email verification is not available yet. Please try again shortly.' },
        { status: 503 },
      )
    const db = createServerClient()
    if (
      !(await limitOtp(
        db,
        email,
        request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
      ))
    )
      return NextResponse.json(
        { error: 'Too many codes requested. Please try again later.' },
        { status: 429 },
      )
    const challengeId = await requestAuthOtp(db, email, purpose, name, role)
    return NextResponse.json(
      {
        challengeId,
        expiresIn: OTP_SECONDS,
        resendAfter: OTP_RESEND_SECONDS,
        message: 'If this address can continue, a verification code has been sent.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not send a verification code.',
      },
      { status: 503 },
    )
  }
}
