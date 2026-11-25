'use client'
import {useEffect,useRef} from 'react'
export default function FormError({message}:{message:string}) {
 const ref=useRef<HTMLParagraphElement>(null)
 useEffect(()=>{if(message)ref.current?.focus()},[message])
 return message?<p className="field-error-msg" role="alert" tabIndex={-1} ref={ref}>{message}</p>:null
}
