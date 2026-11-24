import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/service'
import { loadBooking } from '@/lib/booking-ops'
import {
  newOtp,
  otpDigest,
  sendOtp,
  emailReady,
  limitOtp,
  OTP_SECONDS,
  OTP_RESEND_SECONDS,
} from '@/lib/otp'
import { completionReportErrors, type CompletionReport } from '@/lib/completion-report'
export const runtime = 'nodejs'
async function actorAndBooking(id: string) {
  const profile = await getCurrentProfile()
  if (!profile) return null
  const db = createServerClient(),
    booking = await loadBooking(db, id)
  const { data: nanny } = await db
    .from('nannies')
    .select('id,display_name,is_suspended')
    .eq('user_id', profile.id)
    .maybeSingle()
  if (
    !nanny ||
    nanny.is_suspended ||
    !booking.booking_assignments?.some(
      (a) => a.nanny_id === nanny.id && a.response === 'accepted',
    )
  )
    return null
  return { profile, db, booking, nanny }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params,
      context = await actorAndBooking(id)
    if (!context)
      return NextResponse.json(
        { error: 'Only the assigned nanny can request this code.' },
        { status: 403 },
      )
    const { db, profile, booking, nanny } = context
    const body=await request.json().catch(()=>null)
    const errors=completionReportErrors(body?.report)
    if(errors.length)return NextResponse.json({error:errors[0],errors},{status:400})
    if (!emailReady())
      return NextResponse.json(
        { error: 'Email delivery is not available. Please contact our team.' },
        { status: 503 },
      )
    if (!(await limitOtp(db, `care:${id}:${nanny.id}`, profile.id)))
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      )
    const otp = newOtp()
    const saved=await db.rpc('save_care_completion_report',{p_booking:id,p_actor:profile.id,p_report:body.report})
    if(saved.error)return NextResponse.json({error:'The completion report could not be saved. Check the hours, work details and current placement status.'},{status:409})
    const report=saved.data as CompletionReport
    const { error } = await db.rpc('issue_otp_challenge', {
      p_id: otp.id,
      p_purpose: 'care',
      p_subject: otpDigest('care-subject', `${id}:${nanny.id}`),
      p_hash: otpDigest(otp.id, otp.code),
      p_payload: {report},
      p_actor: profile.id,
      p_booking: id,
    })
    if (error)
      return NextResponse.json(
        {
          error:
            error.code === 'P0001'
              ? error.message
              : 'Could not request completion verification.',
        },
        { status: 409 },
      )
    try {
      let email = booking.email
      if (booking.parent_id) {
        const result = await db.auth.admin.getUserById(booking.parent_id)
        if (result.error || !result.data.user?.email)
          throw new Error('Family email unavailable')
        email = result.data.user.email
      }
      await sendOtp(
        email,
        otp.code,
        otp.id,
        'care',
        `${nanny.display_name} has requested confirmation for your ${booking.destination} booking (${booking.check_in} to ${booking.check_out}).\n\nReported hours: ${report.hoursWorked}\nWork and handover: ${report.summary}\nAgreed additional services: ${report.additionalServices || 'None reported'}\nApproved expense notes: ${report.expenses || 'None reported'}\n\nReview this report in your client portal. If anything is incorrect, ask the nanny or VacayNanny to correct it before sharing your code.`,
      )
    } catch {
      await db
        .from('otp_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', otp.id)
      return NextResponse.json(
        { error: 'We could not email the family. Please request another code shortly.' },
        { status: 503 },
      )
    }
    return NextResponse.json(
      {
        challengeId: otp.id,
        expiresIn: OTP_SECONDS,
        resendAfter: OTP_RESEND_SECONDS,
        message: 'A completion code has been emailed to the family.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { error: 'Could not request a completion code.' },
      { status: 503 },
    )
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params,
      context = await actorAndBooking(id)
    if (!context)
      return NextResponse.json(
        { error: 'Only the assigned nanny can complete this care.' },
        { status: 403 },
      )
    const body = await request.json(),
      { challengeId, code } = body
    if (!/^[0-9a-f-]{36}$/i.test(challengeId || '') || !/^\d{6}$/.test(code || ''))
      return NextResponse.json(
        { error: 'Enter the six-digit code provided by the family.' },
        { status: 400 },
      )
    if (
      !(await limitOtp(
        context.db,
        `care:${id}:${context.nanny.id}`,
        context.profile.id,
        true,
      ))
    )
      return NextResponse.json(
        { error: 'Too many attempts. Please request a new code later.' },
        { status: 429 },
      )
    const { data, error } = await context.db.rpc('consume_otp_challenge', {
      p_id: challengeId,
      p_purpose: 'care',
      p_hash: otpDigest(challengeId, code),
      p_actor: context.profile.id,
      p_booking: id,
    })
    if (error || !data?.ok)
      return NextResponse.json(
        {
          error:
            'This code is incorrect, expired or already used. Ask the family for the latest code.',
        },
        { status: 400 },
      )
    return NextResponse.json(
      { success: true, completed: data.completed },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { error: 'Could not confirm care completion. Please retry.' },
      { status: 503 },
    )
  }
}
