import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NANNY_AGREEMENT_SHA256, NANNY_AGREEMENT_VERSION } from './nanny-agreement-rules'
import { openWorkflow, sealWorkflow } from './workflow-secrets'
import type { CurrentProfile } from './auth'
import type { NannyApplication } from './types'

export type AgreementAcceptance = {
  application_id: string
  version: string
  document_sha256: string
  signer_name: string
  accepted_at: string
}
export type AgreementDetails = {
  fullName: string; nationalIdNumber: string; email: string; phone: string
  payoutMethod: string; payoutAccountName: string; payoutAccountNumber: string; payoutBankName: string
}
export type AgreementSummary = AgreementAcceptance & {
  current: boolean
  payout: { method: string; accountName: string; bankName: string; maskedNumber: string }
}

export function applicationAcceptance(body: Record<string, unknown>) {
  const text = (key: string) => String(body[key] || '').trim()
  return {
    version: NANNY_AGREEMENT_VERSION, document_sha256: NANNY_AGREEMENT_SHA256,
    signer_name: text('agreementSignerName'),
    details: sealWorkflow({
      fullName: text('fullName'), nationalIdNumber: text('nationalIdNumber'),
      email: text('email').toLowerCase(), phone: text('countryCode') + text('phone'),
      payoutMethod: text('payoutMethod'), payoutAccountName: text('payoutAccountName'),
      payoutAccountNumber: text('payoutAccountNumber').replace(/[\s-]/g, ''),
      payoutBankName: text('payoutBankName'),
    } satisfies AgreementDetails),
  }
}

export async function acceptedSignupApplication(db: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await db.rpc('nanny_signup_application', { p_email: email })
  if (error) throw new Error('Nanny onboarding verification is temporarily unavailable.')
  return typeof data === 'string' ? data : null
}

export async function loadAgreementSummary(db: SupabaseClient, applicationId: string): Promise<AgreementSummary | null> {
  const { data, error } = await db.from('nanny_agreement_acceptances').select('*').eq('application_id', applicationId).eq('version', NANNY_AGREEMENT_VERSION).maybeSingle()
  if (error) throw new Error('Agreement acceptance could not be loaded. Please refresh.')
  if (!data) return null
  const details = openWorkflow<AgreementDetails>(data.details)
  return {
    application_id: data.application_id, version: data.version, document_sha256: data.document_sha256,
    signer_name: data.signer_name, accepted_at: data.accepted_at,
    current: data.version === NANNY_AGREEMENT_VERSION && data.document_sha256 === NANNY_AGREEMENT_SHA256,
    payout: {
      method: details.payoutMethod, accountName: details.payoutAccountName,
      bankName: details.payoutBankName, maskedNumber: '•••• ' + details.payoutAccountNumber.slice(-4),
    },
  }
}

export async function ownNannyApplication(db: SupabaseClient, profile: CurrentProfile, id?: string): Promise<NannyApplication | null> {
  let owned = db.from('nanny_applications').select('*').eq('user_id', profile.id)
  if (id) owned = owned.eq('id', id)
  const result = await owned.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (result.error) throw new Error('Your application could not be loaded. Please refresh.')
  if (result.data) return result.data as NannyApplication
  if (!profile.emailConfirmed || !profile.email) return null
  let unclaimed = db.from('nanny_applications').select('*').is('user_id', null).ilike('email', profile.email.replace(/[\\%_]/g, '\\$&'))
  if (id) unclaimed = unclaimed.eq('id', id)
  const fallback = await unclaimed.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (fallback.error) throw new Error('Your application could not be loaded. Please refresh.')
  return fallback.data as NannyApplication | null
}
