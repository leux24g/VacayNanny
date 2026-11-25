import {NextRequest,NextResponse} from 'next/server'
import {requireAdminProfile} from '@/lib/auth'
import {createServerClient} from '@/lib/supabase/service'
export async function POST(_request:NextRequest,{params}:{params:Promise<{id:string}>}){
 const admin=await requireAdminProfile();if(!admin)return NextResponse.json({error:'Administrator sign-in required.'},{status:401})
 try{const db=createServerClient(),{id}=await params,loaded=await db.from('nannies').select('user_id').eq('id',id).maybeSingle();if(loaded.error||!loaded.data?.user_id)return NextResponse.json({error:'Link this nanny to its verified account first.'},{status:409});const user=await db.auth.admin.getUserById(loaded.data.user_id);if(user.error||!user.data.user?.email)throw new Error('Canonical account unavailable');const started=await db.rpc('begin_existing_onboarding',{p_nanny:id,p_actor:admin.id,p_email:user.data.user.email});if(started.error)throw new Error('Onboarding could not be linked');return NextResponse.json({id:started.data},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'Could not start onboarding. Refresh and retry.'},{status:503})}
}
