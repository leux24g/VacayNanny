import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/constants'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg'])
const MAX_BYTES = 4 * 1024 * 1024
export class ProfileImageError extends Error {}

export function imageExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName === 'jpg' || fromName === 'jpeg' || fromName === 'png' || fromName === 'webp') return fromName === 'jpeg' ? 'jpg' : fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

export function validateProfileImage(file: File | null): string | null {
  if (!file || file.size <= 0) return null
  if (file.size > MAX_BYTES) return 'Photos must be 4 MB or smaller.'
  if (!ALLOWED_TYPES.has(file.type)) {
    return 'Use a JPG, PNG, or WebP photo.'
  }
  return null
}

export async function queuePublicPhotoCleanup(db:SupabaseClient,url:string|null|undefined) {
  if(!url)return
  const prefix=db.storage.from('nanny-photos').getPublicUrl('').data.publicUrl
  if(!url.startsWith(prefix))return
  const path=url.slice(prefix.length)
  if(!/^(profiles|live)\//.test(path)||path.split('/').includes('..'))return
  const result=await db.rpc('enqueue_workflow_job',{p_kind:'public_photo_cleanup',p_payload:{path},p_key:`photo-retire:${path}`})
  if(result.error)throw new Error('Could not prepare the photo update. Please retry.')
}

export async function uploadPublicPhoto(
  supabase: SupabaseClient,
  folder: string,
  file: File,
): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer())
  const ext=buf[0]===255&&buf[1]===216&&buf[2]===255?'jpg':buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP'?'webp':null
  if(!ext)throw new ProfileImageError('Choose a valid JPG, PNG or WebP image.')
  const path = `${folder}/${slugify(file.name.replace(/\.[^.]+$/, '')) || 'photo'}-${crypto.randomUUID()}.${ext}`
  const queued=await supabase.rpc('enqueue_workflow_job',{p_kind:'public_photo_cleanup',p_payload:{path},p_key:`photo-upload:${path}`})
  if(queued.error)throw new Error('Could not prepare safe photo storage. Please retry.')
  const { error } = await supabase.storage.from('nanny-photos').upload(path, buf, {
    contentType:ext==='jpg'?'image/jpeg':`image/${ext}`,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('nanny-photos').getPublicUrl(path)
  return data.publicUrl
}
