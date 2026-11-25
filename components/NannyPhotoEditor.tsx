'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import MediaImage from './MediaImage'

/** Decode before upload, and reduce large phone photos below the request limit. */
async function preparePhoto(source: File): Promise<File> {
  const extension = source.name.split('.').pop()?.toLowerCase()
  const type = source.type || (extension === 'png' ? 'image/png' : ['jpg','jpeg'].includes(extension || '') ? 'image/jpeg' : '')
  if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(type)) throw new Error('Choose a JPEG, PNG or WebP photo. For HEIC photos, export or take a JPEG first.')
  if (!source.size || source.size > 25 * 1024 * 1024) throw new Error('Choose a photo up to 25 MB. Large photos are resized before upload.')
  const url = URL.createObjectURL(source), image = new Image()
  let timer:ReturnType<typeof setTimeout>|undefined
  try {
    image.src = url
    await Promise.race([image.decode(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Photo preparation timed out')),15000)})])
    clearTimeout(timer)
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image')
    if (Math.max(image.naturalWidth,image.naturalHeight) <= 1600 && source.size <= 4 * 1024 * 1024)
      return new File([source],source.name,{type:type === 'image/jpg' ? 'image/jpeg' : type})
    const scale = Math.min(1,1600 / Math.max(image.naturalWidth,image.naturalHeight)), canvas = document.createElement('canvas')
    canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale))
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image preparation unavailable')
    context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height)
    const blob = await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value ? resolve(value) : reject(new Error('Image preparation failed')),'image/jpeg',0.88))
    if (blob.size > 4 * 1024 * 1024) throw new Error('Photo is still too large')
    return new File([blob],'profile-photo.jpg',{type:'image/jpeg'})
  } catch { throw new Error('This photo could not be opened or resized. Choose another JPEG or PNG photo.') }
  finally { clearTimeout(timer);URL.revokeObjectURL(url) }
}

export default function NannyPhotoEditor({initialUrl,endpoint,name}:{initialUrl:string|null;endpoint:string;name:string}) {
  const router=useRouter(), id=useId()
  const [currentUrl,setCurrentUrl]=useState(initialUrl || ''),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[remove,setRemove]=useState(false)
  const [preparing,setPreparing]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
  const busy=preparing||saving,shown=remove?'':preview||currentUrl
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview])
  async function choose(input:HTMLInputElement) {
    const source=input.files?.[0];input.value='';if(!source)return
    setPreparing(true);setError('');setSaved(false)
    try {const photo=await preparePhoto(source);setFile(photo);setPreview(URL.createObjectURL(photo));setRemove(false)}
    catch(error){setError(error instanceof Error?error.message:'Could not open this photo.')}
    finally{setPreparing(false)}
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();if(busy||(!file&&!remove))return
    setSaving(true);setError('');setSaved(false)
    try {
      const body=new FormData();if(file)body.set('photo',file);if(remove)body.set('removePhoto','true')
      const response=await fetch(endpoint,{method:'POST',body,signal:AbortSignal.timeout(45000)}),result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.error||'Could not save the photo. Please retry.')
      setCurrentUrl(result.photoUrl || '');setFile(null);setPreview('');setRemove(false);setSaved(true);router.refresh()
    }catch(error){setError(error instanceof Error&&error.name!=='TimeoutError'?error.message:'The save could not be confirmed. Refresh to check the photo before retrying.')}
    finally{setSaving(false)}
  }
  return <form className="nanny-photo-editor form-card" aria-label={`Profile photo for ${name}`} onSubmit={save}>
    <h3>Profile photo</h3><p>This is the picture families see on the nanny card and public profile.</p>
    <div className="profile-photo-row"><div className="profile-avatar">{shown?<MediaImage src={shown} alt={`${name} profile photo preview`} fill sizes="88px"/>:<span aria-label="No profile photo">{name.split(/\s+/).slice(0,2).map(part=>part[0]).join('')}</span>}</div>
    <div className="photo-picker-actions">
      <label className="btn-ghost photo-picker-button" htmlFor={`${id}-upload`}>Choose photo<input id={`${id}-upload`} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>void choose(event.currentTarget)}/></label>
      <label className="btn-ghost photo-picker-button" htmlFor={`${id}-camera`}>Take photo<input id={`${id}-camera`} type="file" accept="image/jpeg,image/png" capture="user" disabled={busy} onChange={event=>void choose(event.currentTarget)}/></label>
      {shown&&<button type="button" className="btn-ghost" disabled={busy} onClick={()=>{setFile(null);setPreview('');setRemove(true);setSaved(false);setError('')}}>Remove photo</button>}
    </div></div>
    <p className="field-hint">JPEG, PNG or WebP. Phone photos are resized if needed. Take photo opens the camera on supported phones; your device may show a file picker instead.</p>
    {file&&<p>{file.name} — ready to save</p>}{remove&&<p>The current photo will be removed when you save.</p>}
    {preparing&&<p role="status">Preparing your photo…</p>}{error&&<p role="alert" className="field-error-msg">{error}</p>}{saved&&<p role="status">Profile photo updated. Families will see the saved photo.</p>}
    <button className="btn-coral" type="submit" disabled={busy||(!file&&!remove)}>{saving?'Saving photo…':'Save photo'}</button>
  </form>
}
