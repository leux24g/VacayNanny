import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { hasSupabaseConfig } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase/service'
import { ProfileImageError, queuePublicPhotoCleanup, uploadPublicPhoto, validateProfileImage } from '@/lib/profile-media'

function cleanName(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function cleanPhone(value: unknown) {
  return String(value || '').trim().slice(0, 32)
}

export async function PATCH(request: NextRequest) {
  try {
    if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Profile storage is not configured yet.' }, { status: 503 })
    }
    const profile = await getCurrentProfile()
    if (!profile) return NextResponse.json({ error: 'Sign in to edit your profile.' }, { status: 401 })

    const form = await request.formData()
    const fullName = cleanName(form.get('fullName'))
    const phone = cleanPhone(form.get('phone'))
    const removeAvatar = String(form.get('removeAvatar') || '') === 'true'
    const avatar = form.get('avatar')
    const file = avatar instanceof File && avatar.size > 0 ? avatar : null

    if (fullName.length < 2) {
      return NextResponse.json({ error: 'Enter your full name.' }, { status: 400 })
    }
    if (fullName.length > 80) {
      return NextResponse.json({ error: 'Name is too long.' }, { status: 400 })
    }
    if (phone && (!/^[+()\d\s-]+$/.test(phone) || phone.replace(/\D/g,'').length < 9 || phone.replace(/\D/g,'').length > 15))
      return NextResponse.json({ error: 'Enter a valid phone number, including the country code where applicable.' },{status:400})
    const imageError = validateProfileImage(file)
    if (imageError) return NextResponse.json({ error: imageError }, { status: 400 })

    const supabase = createServerClient()
    if(file || removeAvatar)await queuePublicPhotoCleanup(supabase,profile.avatar_url)
    const updates: Record<string, unknown> = {
      full_name: fullName,
      phone: phone || null,
    }
    if (file) {
      updates.avatar_url = await uploadPublicPhoto(supabase, `profiles/${profile.id}`, file)
    } else if (removeAvatar) {
      updates.avatar_url = null
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)
      .select('id, role, full_name, email, phone, avatar_url, created_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Could not save your profile. Please retry.' }, { status: 503 })
    if (!data) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })

    return NextResponse.json({ success: true, profile: data })
  } catch (err) {
    if(err instanceof ProfileImageError)return NextResponse.json({error:err.message},{status:400})
    console.error('Account profile update failed')
    return NextResponse.json({ error: 'Could not save your profile.' }, { status: 500 })
  }
}
