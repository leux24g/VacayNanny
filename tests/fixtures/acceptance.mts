import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applicationAcceptance } from '../../lib/nanny-onboarding'
import { completeApplication } from './application'
export function testAcceptance(fullName:string) {
  if(!process.env.NOTIFICATION_ENCRYPTION_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.NOTIFICATION_ENCRYPTION_KEY='acceptance-integration-synthetic-key'
  return applicationAcceptance({...completeApplication,fullName,agreementSignerName:fullName,payoutAccountName:fullName})
}
export async function recordTestAcceptance(db:SupabaseClient,id:string,fullName:string) {
  const acceptance=testAcceptance(fullName)
  assert.ifError((await db.from('nanny_agreement_acceptances').insert({application_id:id,...acceptance})).error)
}
