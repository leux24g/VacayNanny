'use client'

import {clientFetch} from '@/lib/client-request'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
export type OpsTask = {
  id: string
  kind: string
  summary: string
  status: 'open' | 'acknowledged' | 'resolved'
  assigned_to: string | null
  created_at: string
  booking_id: string | null
}
export type FailedJob = {
  delivery_started_at?:string | null
  delivery_accepted_at?:string | null
  id: string
  kind: string
  status: string
  attempts: number
  last_error: string | null
  created_at: string
}
export type QueueHealth = {
  ready:number; scheduled:number; processing:number; stale:number; failed:number
  oldestReadyAt:string | null; lastSuccessAt:string | null; workerStale?:boolean
  lastRun:{ startedAt:string; finishedAt:string|null; status:string; processed:number; failed:number; error:string|null } | null
}
export default function AdminWorkflowTasks({
  tasks,
  failedJobs,
  onOpenBooking,
  queueHealth,
}: {
  tasks: OpsTask[]
  failedJobs: FailedJob[]
  onOpenBooking: (id: string) => void
  queueHealth?: QueueHealth | null
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  async function update(id: string, body: Record<string, unknown>) {
    setBusy(id)
    setError('')
    try {
      const response = await clientFetch(`/api/admin/workflow/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) setError(data.error)
      else router.refresh()
    } catch {
      setError('Could not update this follow-up. Please retry.')
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="ops-stack">
      <h2>Operations follow-ups</h2>
      <p>
        Expired proposals, replacement deadlines, suspensions and failed notifications
        appear here.
      </p>
      {queueHealth && <div className="ops-card" aria-label="Queue health"><h3>Queue health</h3><div className="queue-stats"><p><strong>{queueHealth.ready}</strong> ready</p><p><strong>{queueHealth.scheduled}</strong> waiting for scheduled time or retry</p><p><strong>{queueHealth.processing}</strong> processing</p><p><strong>{queueHealth.stale}</strong> interrupted leases</p><p><strong>{queueHealth.failed}</strong> need review</p></div><p>Last successful worker: {queueHealth.lastSuccessAt ? `${new Date(queueHealth.lastSuccessAt).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})} EAT` : 'Awaiting a completed run'}</p><p>Interrupted jobs are recovered after three minutes. Transient failures back off automatically; repeated failures and uncertain email deliveries require operator review.</p>{(queueHealth.workerStale || queueHealth.lastRun?.status === 'failed') && <p role="alert" className="field-error-msg">The workflow worker needs attention. Check the scheduler, worker logs and provider settings. {queueHealth.lastRun?.error}</p>}{queueHealth.stale > 0 && <p role="status">An interrupted job is waiting for its lease to expire or be reclaimed by the next worker.</p>}</div>}
      {error && (
        <p role="alert" className="field-error-msg">
          {error}
        </p>
      )}
      {!tasks.some((t) => t.status !== 'resolved') && <p>No open follow-ups.</p>}
      {tasks
        .filter((task) => task.status !== 'resolved')
        .map((task) => (
          <article className="ops-card" key={task.id}>
            <span className="ops-pill">{task.status}</span>
            <h3>{task.kind.replaceAll('_', ' ')}</h3>
            <p>{task.summary}</p>
            <p>{task.assigned_to ? 'Assigned to an operator' : 'Unassigned'}</p>
            {task.booking_id && <p>Booking reference: {task.booking_id.slice(0, 8)}</p>}
            <div className="booking-actions">
              {task.booking_id && (
                <button
                  className="btn-ghost"
                  onClick={() => onOpenBooking(task.booking_id!)}
                >
                  Open booking
                </button>
              )}
              <button
                className="btn-ghost"
                disabled={busy === task.id}
                onClick={() => update(task.id, { kind: 'task', status: 'acknowledged' })}
              >
                Take follow-up
              </button>
              <button
                className="btn-coral"
                disabled={busy === task.id}
                onClick={() => update(task.id, { kind: 'task', status: 'resolved' })}
              >
                Mark resolved
              </button>
            </div>
          </article>
        ))}
      {failedJobs.map((job) => (
        <article className="ops-card" key={job.id}>
          <h3>Notification needs attention</h3>
          <p>
            {job.kind} · {job.attempts} attempts
          </p>
          <p>{job.last_error}</p>
          <button
            className="btn-ghost"
            disabled={busy === job.id}
            onClick={() => {
              if(job.delivery_accepted_at){void update(job.id,{kind:'job',resumeConfirmed:true});return}
              if (
                window.confirm(
                  'Check the provider delivery log first. Retry only if this notification was not delivered.',
                )
              )
                void update(job.id, { kind: 'job', confirmedNotDelivered: true })
            }}
          >
            {job.delivery_accepted_at ? 'Resume saved delivery' : 'Retry after checking delivery'}
          </button>
        </article>
      ))}
    </section>
  )
}
