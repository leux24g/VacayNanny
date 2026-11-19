import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, hasSupabaseConfig } from '@/lib/supabase'
import { sendEmail } from '@/lib/email-delivery'
import { escapeHtml } from '@/lib/application-email-templates'
import { ADMIN_EMAIL } from '@/lib/constants'
import { limitRoute } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim()
    const subject = String(body.subject || 'Website enquiry').trim()
    const message = String(body.message || '').trim()
    if (!name || !email || !message) {
      return NextResponse.json(
        { error: 'Name, email and message are required.' },
        { status: 400 },
      )
    }
    if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Contact inbox is not configured yet.' },
        { status: 503 },
      )
    }
    const supabase = createServerClient()
    const blocked = await limitRoute(request, supabase, 'contact', { email })
    if (blocked) return blocked
    const { error } = await supabase
      .from('contact_messages')
      .insert([{ name, email, subject, message }])
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 })

    const delivery = await sendEmail({
      to: ADMIN_EMAIL,
      replyTo: email,
      subject: `[Contact] ${subject} — ${name}`,
      html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)})</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      text: `${name} (${email})\n\n${message}`,
    }).catch(() => ({ error: { message: 'Delivery unavailable' } }))
    if (delivery.error)
      console.error(
        'Contact notification could not be delivered; enquiry remains saved in the inbox.',
      )

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
