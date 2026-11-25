import {NextRequest,NextResponse} from 'next/server'
import {requireAdminProfile} from '@/lib/auth'
import {updateNannyPhoto} from '@/lib/nanny-photo'
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const profile=await requireAdminProfile()
  if(!profile)return NextResponse.json({error:'Administrator sign-in is required.'},{status:401})
  return updateNannyPhoto(request,profile.id,(await params).id)
}
