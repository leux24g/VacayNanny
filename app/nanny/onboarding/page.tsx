import {redirect} from 'next/navigation'
import {requireProfile} from '@/lib/auth'
import {createServerClient} from '@/lib/supabase/service'
import {ownNannyApplication} from '@/lib/nanny-onboarding'
import NannyApplicationForm from '@/components/NannyApplicationForm'
export const metadata={title:'Complete your existing nanny onboarding | VacayNanny'}
export default async function Page(){
 const profile=await requireProfile(['nanny','admin']),db=createServerClient(),app=await ownNannyApplication(db,profile)
 if(!app?.legacy_nanny_id||app.legacy_completed_at)redirect('/nanny#nanny-onboarding')
 const names=app.full_name.trim().split(/\s+/)
 return <NannyApplicationForm existingApplicationId={app.id} initialContact={{firstName:names[0]||'',lastName:names.slice(1).join(' '),email:profile.email||'',phone:app.phone||'',county:app.county||'',town:app.town||''}}/>
}
