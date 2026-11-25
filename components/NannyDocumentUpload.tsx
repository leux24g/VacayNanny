'use client'

import {clientFetch} from '@/lib/client-request'
import {useState} from 'react'
import {useRouter} from 'next/navigation'
export default function NannyDocumentUpload() {
 const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,body=new FormData(form),file=body.get('document');setError('');setSaved(false)
  if(!(file instanceof File)||!file.size||file.size>4*1024*1024){setError('Choose a file up to 4 MB.');return}
  setBusy(true);try{const response=await clientFetch('/api/nanny/documents',{method:'POST',body}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not save the document.');setSaved(true);form.reset();router.refresh()}catch(error){setError(error instanceof Error?error.message:'Could not connect. Please retry.')}finally{setBusy(false)}
 }
 return <form className="agreement-form" onSubmit={submit}><h4>Add a verification document</h4><p>Upload a certificate received after your application, or provide a clearer identity file. New documents need administrator review and reset the relevant verification check.</p><label htmlFor="additional-doc-kind">Document type<select id="additional-doc-kind" name="kind" required disabled={busy}><option value="">Choose a type</option>{[['cogc','Police clearance certificate'],['certificate','Qualification / training certificate'],['id_front','Identity document front'],['id_back','Identity document back'],['selfie','Identity selfie'],['photo','Profile photo'],['passport','Passport photo page']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>File (up to 4 MB)<input type="file" name="document" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" required disabled={busy}/></label><button className="btn-ghost" disabled={busy}>{busy?'Uploading…':'Submit document for review'}</button>{error&&<p role="alert" className="field-error-msg">{error}</p>}{saved&&<p role="status">Document submitted. Our team will review it before approval.</p>}</form>
}
