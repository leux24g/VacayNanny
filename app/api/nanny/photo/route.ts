import {NextRequest,NextResponse} from 'next/server'
import {getCurrentProfile} from '@/lib/auth'
import {updateNannyPhoto} from '@/lib/nanny-photo'
export async function POST(request:NextRequest){
  const profile=await getCurrentProfile()
  if(!profile)return NextResponse.json({error:'Sign in to update your profile photo.'},{status:401})
  if(!['nanny','admin'].includes(profile.role))return NextResponse.json({error:'A linked nanny account is required.'},{status:403})
  return updateNannyPhoto(request,profile.id)
}
