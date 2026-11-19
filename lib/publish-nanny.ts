import type { SupabaseClient } from '@supabase/supabase-js'
import { tierDailyRate } from '@/lib/catalog-data'
import { slugify } from '@/lib/constants'
import type { NannyApplication, NannyTier } from '@/lib/types'

type PublishResult =
  | {
      ok: true
      slug: string
      fullName: string
      email: string | null
      tier: NannyTier
      fresh: boolean
    }
  | { ok: false; status: number; error: string }

async function uniqueSlug(supabase: SupabaseClient, name: string) {
  const base = slugify(name) || 'nanny'
  let slug = base
  for (let i = 2; i < 40; i += 1) {
    const { data } = await supabase
      .from('nannies')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return slug
    slug = `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

function asTier(value: unknown): NannyTier {
  if (value === 'bronze' || value === 'silver' || value === 'gold') return value
  return 'bronze'
}

async function insertFromApplication(
  supabase: SupabaseClient,
  app: NannyApplication,
) {
  const slug = await uniqueSlug(supabase, app.full_name)
  const { data: photoDoc } = await supabase
    .from('nanny_documents')
    .select('storage_path')
    .eq('application_id', app.id)
    .eq('kind', 'photo')
    .maybeSingle()
  let photoUrl: string | null = null
  if (photoDoc?.storage_path?.startsWith('nanny-photos/')) {
    const path = String(photoDoc.storage_path).replace('nanny-photos/', '')
    photoUrl = supabase.storage.from('nanny-photos').getPublicUrl(path)
      .data.publicUrl
  }
  const tier = asTier(app.estimated_tier)
  const { error } = await supabase.from('nannies').insert([
    {
      user_id: app.user_id,
      application_id: app.id,
      slug,
      display_name: app.full_name,
      photo_url: photoUrl,
      bio: app.bio,
      tier,
      daily_rate_kes: await tierDailyRate(supabase, tier),
      county: app.county,
      town: app.town,
      destinations: app.preferred_locations?.length
        ? app.preferred_locations
        : [app.town].filter(Boolean),
      languages: app.languages || [],
      age_groups: app.age_groups || [],
      services: app.services || [],
      certifications: app.certifications || [],
      tags: [...(app.certifications || []), ...(app.languages || [])].slice(
        0,
        6,
      ),
      available_days: app.available_days || [],
      willing_to_travel: app.willing_to_travel,
      is_active: true,
    },
  ])
  if (error) return { ok: false as const, status: 500, error: error.message }
  return { ok: true as const, slug, tier }
}

export async function publishApprovedApplication(
  supabase: SupabaseClient,
  app: NannyApplication,
): Promise<PublishResult> {
  if (
    app.status !== 'approved' ||
    !app.agreement_signed_path ||
    !app.agreement_reviewed_at ||
    !app.agreement_reviewed_by
  ) {
    return {
      ok: false,
      status: 409,
      error:
        'Approve the application and review its signed agreement before activating the profile.',
    }
  }
  const { data: existing, error } = await supabase
    .from('nannies')
    .select('id,slug,is_active')
    .eq('application_id', app.id)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (existing) {
    if (!existing.is_active) {
      const { error: updateError } = await supabase
        .from('nannies')
        .update({ is_active: true })
        .eq('id', existing.id)
      if (updateError)
        return { ok: false, status: 500, error: updateError.message }
    }
    return {
      ok: true,
      slug: existing.slug,
      fullName: app.full_name,
      email: app.email,
      tier: asTier(app.estimated_tier),
      fresh: !existing.is_active,
    }
  }
  const inserted = await insertFromApplication(supabase, app)
  if (!inserted.ok) return inserted
  return {
    ok: true,
    slug: inserted.slug,
    tier: inserted.tier,
    fullName: app.full_name,
    email: app.email,
    fresh: true,
  }
}

export async function approveNannyAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<PublishResult> {
  const { data, error } = await supabase
    .from('nanny_applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data)
    return {
      ok: false,
      status: 409,
      error: 'Review this account’s application and signed agreement first.',
    }
  return publishApprovedApplication(supabase, data as NannyApplication)
}
