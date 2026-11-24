import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { emailSettings } from './email-settings'
import {
  sendApplicationEmails,
  sendApplicationStatusEmail,
  sendInterviewInviteEmail,
  sendProfileActivatedEmail,
  sendBookingEmails,
  sendBookingMessageEmail,
} from './email'
import {
  sendEmail,
  deliverEmail,
  withNotificationContext,
  type StoredEmail,
  DeliveryUncertainError,
  DeliveryNotStartedError,
} from './email-delivery'
import { fireEvent, nannyContact, loadBooking } from './booking-ops'
import { formatNairobiInterview } from './application-docs'
import { openWorkflow } from './workflow-secrets'
import type { Booking, NannyApplication } from './types'
import type { BookingEmailEvent } from './email'
import { ADMIN_EMAIL, siteUrl } from './constants'
import { withWorkerDeadline } from './worker-context'

type WorkflowJob = {
  id: string
  kind: string
  payload: Record<string, unknown>
  lease_token: string
  delivery_started_at?:string | null
  delivery_accepted_at?:string | null
}
export async function enqueueJob(
  db: SupabaseClient,
  kind: string,
  payload: unknown,
  key: string,
) {
  const { data, error } = await db.rpc('enqueue_workflow_job', {
    p_kind: kind,
    p_payload: payload,
    p_key: key,
  })
  if (error) throw new Error('Could not queue the notification. Please retry.')
  return data as string
}
async function processJob(db: SupabaseClient, job: WorkflowJob) {
  const payload = job.payload
  if(job.kind==='public_photo_cleanup') {
    const path=String(payload.path || '')
    if(!/^(profiles|live)\//.test(path)||path.split('/').includes('..'))throw new Error('Invalid photo cleanup path.')
    const url=db.storage.from('nanny-photos').getPublicUrl(path).data.publicUrl
    const pointers=await Promise.all([['profiles','avatar_url'],['nannies','photo_url'],['reviews','avatar_url'],['destinations','image_url'],['homepage_steps','image_url']].map(([table,column])=>db.from(table).select(column).eq(column,url).limit(1)))
    if(pointers.some(result=>result.error))throw new Error('Could not verify public photo references.')
    if(!pointers.some(result=>result.data?.length)) {const removed=await db.storage.from('nanny-photos').remove([path]);if(removed.error)throw new Error('Could not remove an abandoned photo.')}
    return
  }
  if (job.kind === 'application_upload_cleanup') {
    for (const entry of payload.entries as Array<{ bucket: string; path: string }>) {
      if (entry.bucket !== 'nanny-documents') throw new Error('Invalid cleanup bucket.')
      const { data, error } = await db
        .from('nanny_documents')
        .select('id')
        .eq('storage_path', `${entry.bucket}/${entry.path}`)
        .maybeSingle()
      if (error) throw new Error('Could not check staged document ownership.')
      const protectedAgreement = !data ? await db.from('nanny_applications').select('id').or(`agreement_signed_path.eq.${entry.path},agreement_submitted_path.eq.${entry.path}`).limit(1) : null
      if (protectedAgreement?.error) throw new Error('Could not check agreement ownership.')
      if (!data && !protectedAgreement?.data?.length) {
        const removal = await db.storage.from(entry.bucket).remove([entry.path])
        if (removal.error) throw new Error('Could not clean an abandoned upload.')
      }
    }
    return
  }
  if (job.kind === 'email') {
    const stored = openWorkflow<StoredEmail>(
      payload.sealed as Parameters<typeof openWorkflow>[0],
    )
    if(stored.applicationStatus) {
      const source=await db.from('nanny_applications').select('status,decision_version').eq('id',stored.applicationStatus.id).maybeSingle()
      if(source.error)throw new Error('Application status is unavailable.')
      if(!source.data || source.data.status!==stored.applicationStatus.status || (stored.applicationStatus.version!==undefined && source.data.decision_version!==stored.applicationStatus.version))return
    }
    if(!job.delivery_accepted_at) {
      if(job.delivery_started_at && (emailSettings().provider==='smtp' || Date.now()-Date.parse(job.delivery_started_at)>23*3600000))throw new DeliveryUncertainError('Previous delivery was interrupted. Check the provider log before resending.')
      const started=await db.rpc('begin_workflow_email_delivery',{p_id:job.id,p_lease:job.lease_token})
      if(started.error || typeof started.data!=='boolean')throw new Error('Could not reserve email delivery.')
      if(started.data) {
        await deliverEmail(stored, job.id)
        const accepted=await db.rpc('confirm_workflow_email_delivery',{p_id:job.id,p_lease:job.lease_token})
        if(accepted.error)throw new DeliveryUncertainError('Delivery was accepted but could not be recorded. Check the provider log.')
      }
    }
    if (stored.applicationApprovalId) {
      const { error } = await db
        .from('nanny_applications')
        .update({ approval_email_sent_at: new Date().toISOString() })
        .eq('id', stored.applicationApprovalId)
      if (error) throw new Error('Could not record approval notification acceptance.')
    }
    return
  }
  await withNotificationContext(job.id, async () => {
    if (job.kind === 'booking_message') {
      const { data: message, error } = await db
        .from('booking_messages')
        .select('*')
        .eq('id', payload.messageId)
        .single()
      if (error || !message)
        throw new Error('The message notification source is unavailable.')
      const booking = await loadBooking(db, String(payload.bookingId))
      const recipients: Array<{
        to: string
        recipientName: string
        inboxPath: '/account' | '/nanny'
      }> = []
      if (message.sender_role !== 'parent')
        recipients.push({
          to: booking.email,
          recipientName: booking.parent_name,
          inboxPath: '/account',
        })
      for (const assignment of booking.booking_assignments || []) {
        const contact = await nannyContact(db, assignment.nanny_id)
        const { data: nanny } = await db
          .from('nannies')
          .select('user_id')
          .eq('id', assignment.nanny_id)
          .single()
        if (contact.email && nanny?.user_id !== message.sender_id)
          recipients.push({
            to: contact.email,
            recipientName: contact.name || 'there',
            inboxPath: '/nanny',
          })
      }
      for (const recipient of recipients)
        await sendBookingMessageEmail({
          ...recipient,
          destination: booking.destination,
          senderLabel:
            message.sender_role === 'parent'
              ? 'The family'
              : message.sender_role === 'nanny'
                ? 'A nanny on your placement'
                : 'VacayNanny operations',
          preview: String(message.body).slice(0, 220),
        })
    } else if (job.kind === 'booking_event') {
      const source = payload.booking as Booking
      const latest = await loadBooking(db,source.id)
      if (source.version !== undefined && latest.version !== source.version) return
      await fireEvent(
        db,
        payload.event as BookingEmailEvent,
        payload.booking as Booking,
        { note: payload.note as string, extraNannyId: payload.extraNannyId as string },
      )
    } else if (job.kind === 'booking_received') {
      const b = payload.booking as Booking
      const { trackingUrl } = openWorkflow<{ trackingUrl: string }>(
        payload.notification as Parameters<typeof openWorkflow>[0],
      )
      await sendBookingEmails({
        parentName: b.parent_name,
        email: b.email,
        phone: b.phone || '',
        destination: b.destination,
        checkIn: b.check_in,
        checkOut: b.check_out,
        childrenAges: [b.children_count, b.youngest_age].filter(Boolean).join(' · '),
        tier: b.tier || 'Any',
        message: b.notes || '',
        trackingUrl,
      })
    } else if (job.kind.startsWith('application_')) {
      const { data, error } = await db
        .from('nanny_applications')
        .select('*')
        .eq('id', payload.applicationId)
        .single()
      if (error || !data)
        throw new Error('Application notification source is unavailable.')
      const a = data as NannyApplication
      if (job.kind === 'application_status' && (payload.status !== a.status || (payload.decisionVersion !== undefined && payload.decisionVersion !== a.decision_version))) return
      if (job.kind === 'application_interview' && (a.status === 'rejected' || !a.interview_at || Date.parse(a.interview_at) !== Date.parse(String(payload.interviewAt)))) return
      if (job.kind === 'application_received')
        await sendApplicationEmails({
          fullName: a.full_name,
          email: a.email,
          phone: a.phone || '',
          county: a.county || '',
          town: a.town || '',
          experienceYears: a.experience_years || '',
          cogcStatus: a.cogc_status || '',
          certifications: a.certifications,
          services: a.services,
          ageGroups: a.age_groups,
          ref1Name: 'Provided privately',
          ref2Name: 'Provided privately',
          willingToTravel: a.willing_to_travel || '',
        })
      else if (job.kind === 'application_status')
        await sendApplicationStatusEmail({
          fullName: a.full_name,
          email: a.email,
          status: payload.status as 'approved' | 'rejected',
          applicationId: a.id,
          decisionVersion:a.decision_version,
        })
      else if (job.kind === 'application_interview')
        await sendInterviewInviteEmail({
          fullName: a.full_name,
          email: a.email,
          whenLabel: formatNairobiInterview(String(payload.interviewAt)),
          notes: payload.notes as string,
        })
    } else if (job.kind === 'profile_activated') {
      const current = await db.from('nannies').select('is_active,is_suspended').eq('slug',String(payload.slug)).maybeSingle()
      if (current.error) throw new Error('Activation status is unavailable.')
      if (!current.data?.is_active || current.data.is_suspended) return
      await sendProfileActivatedEmail(
        payload as unknown as Parameters<typeof sendProfileActivatedEmail>[0],
      )
    } else if (job.kind === 'ops_notice') {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: 'VacayNanny needs an operations follow-up',
        text: `${String(payload.summary)}\n${siteUrl('/admin')}`,
        html: `<p>Open your operations workspace to review a pending follow-up.</p>`,
      })
    } else if (job.kind === 'care_quote') {
      const { name, email, trackingUrl, summary } = openWorkflow<{
        name: string
        email: string
        trackingUrl: string
        summary: string
      }>(payload.sealed as Parameters<typeof openWorkflow>[0])
      await sendEmail({
        to: email,
        subject: 'Your VacayNanny specialist care quote',
        text: `Hi ${name},\n\n${summary}\n\nReview your quote: ${trackingUrl}`,
        html: `<p>Your specialist care quote is ready. Open your private enquiry link to review the scope and accept it.</p>`,
      })
    } else throw new Error('Unknown notification job type.')
  })
}
export async function processWorkflowJobs(db: SupabaseClient, limit = 30, options: { budgetMs?: number } = {}) {
  const disabled = emailSettings().mode === 'disabled'
  const deadline = Date.now() + Math.max(0,Math.min(options.budgetMs ?? 35000,40000))
  let processed = 0,
    failed = 0, claimed = 0
  while (claimed < limit && Date.now() < deadline - 12000) {
    // Claim only the job that can start now; leave the rest available to other runs.
    const { data, error } = await db.rpc('claim_workflow_jobs', {
      p_limit: 1,
      p_kinds: disabled ? ['application_upload_cleanup','public_photo_cleanup'] : null,
    })
    if (error) throw new Error('Could not load pending notifications.')
    const job = (data as WorkflowJob[] | null)?.[0]
    if (!job) break
    claimed++
    let failure: string | null = null
    try {
      await withWorkerDeadline(AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-Date.now()-5000))),()=>processJob(db, job))
      processed++
    } catch (error) {
      failure = error instanceof DeliveryUncertainError
        ? 'Manual delivery check required: email outcome is uncertain. Check the provider log before retrying.'
        : error instanceof DeliveryNotStartedError ? 'Delivery not started: email was not accepted. Check provider configuration.' : 'Job processing failed. Check configuration and retry.'
      failed++
    }
    const { error: finishError } = await db.rpc('finish_workflow_job', {
      p_id: job.id,
      p_lease: job.lease_token,
      p_error: failure,
    })
    if (finishError) throw new Error('Could not record notification processing.')
  }
  return { processed, failed, disabled, budgetExhausted: Date.now() >= deadline - 12000 }
}
