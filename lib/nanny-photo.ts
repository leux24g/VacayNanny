import 'server-only'
import { NextRequest,NextResponse } from 'next/server'
import { createServerClient } from './supabase/service'
import { ProfileImageError,uploadPublicPhoto,validateProfileImage } from './profile-media'

/** Both callers derive actor identity from the verified session, never the form. */
export async function updateNannyPhoto(request:NextRequest,actor:string,nannyId?:string) {
  try {
    if(Number(request.headers.get('content-length')||0)>4.2*1024*1024)return NextResponse.json({error:'Choose a photo up to 4 MB after resizing.'},{status:413})
    const db=createServerClient(),lookup=db.from('nannies').select('id,user_id,is_suspended')
    const loaded=await (nannyId?lookup.eq('id',nannyId):lookup.eq('user_id',actor)).maybeSingle()
    if(loaded.error)throw new Error('Profile lookup unavailable')
    if(!loaded.data)return NextResponse.json({error:'Nanny profile not found. Contact the team if your account is not linked to a profile yet.'},{status:404})
    const form=await request.formData(),photo=form.get('photo'),remove=form.get('removePhoto')==='true',file=photo instanceof File&&photo.size>0?photo:null
    if((!file&&!remove)||(file&&remove))return NextResponse.json({error:'Choose a photo to upload, or select Remove photo.'},{status:400})
    const invalid=validateProfileImage(file);if(invalid)return NextResponse.json({error:invalid},{status:400})
    const url=file?await uploadPublicPhoto(db,`live/${loaded.data.id}`,file):null
    const result=await db.rpc('update_nanny_photo',{p_nanny:loaded.data.id,p_actor:actor,p_photo_url:url})
    if(result.error)return NextResponse.json({error:'The photo could not be confirmed as saved. Refresh the profile before retrying.'},{status:503})
    return NextResponse.json({success:true,photoUrl:result.data},{headers:{'Cache-Control':'no-store'}})
  }catch(error){return NextResponse.json({error:error instanceof ProfileImageError?error.message:'Could not update the photo. Your selection is still on this page; please retry.'},{status:error instanceof ProfileImageError?400:503})}
}
