'use client'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import styles from './Portal.module.css'
export default function PortalLoadError({ message }: { message: string }) {
  const router = useRouter(), [pending,start] = useTransition()
  return <div className={styles.notice} role="alert"><p>{message}</p><button type="button" className="btn-ghost" disabled={pending} onClick={() => start(() => router.refresh())}>{pending ? 'Refreshing…' : 'Refresh your portal'}</button></div>
}
