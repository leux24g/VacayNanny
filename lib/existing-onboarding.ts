import 'server-only'
import type {SupabaseClient} from '@supabase/supabase-js'
import type {CurrentProfile} from './auth'
export async function existingApplication(db:SupabaseClient,profile:CurrentProfile,id:string) {
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid application reference.')
 const result=await db.from('nanny_applications').select('id,user_id,email,legacy_nanny_id,legacy_completed_at,status').eq('id',id).eq('user_id',profile.id).maybeSingle()
 if(result.error)throw new Error('Your onboarding record could not be checked. Please refresh.')
 const row=result.data
 if(!row?.legacy_nanny_id||row.email.toLowerCase()!==profile.email?.toLowerCase()||!profile.emailConfirmed||row.status==='rejected')throw new Error('Use your own linked onboarding record and verified account email.')
 return row
}
