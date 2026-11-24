import { NextRequest, NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron-auth'
import { createServerClient } from '@/lib/supabase/service'
import { processWorkflowJobs } from '@/lib/workflow-jobs'
import { advanceDueBookings } from '@/lib/booking-ops'
import { withWorkerDeadline } from '@/lib/worker-context'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!authorizedCron(request.headers.get('authorization'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now(), db = createServerClient({ timeoutMs: 5000 })
  const runId = crypto.randomUUID()
  try {
    const run = await db.from('workflow_worker_runs').insert({ id:runId })
    if (run.error) throw run.error
    const { data: expired, error } = await db.rpc('run_workflow_automation')
    let lifecycleFailed = Boolean(error)
    try {
      await withWorkerDeadline(AbortSignal.timeout(10000),()=>advanceDueBookings(db, { strict: true }))
    } catch {
      lifecycleFailed = true
    }
    const worker = await processWorkflowJobs(db,45,{budgetMs:Math.max(0,40000-(Date.now()-started))})
    const recorded = await db.from('workflow_worker_runs').update({ finished_at:new Date().toISOString(),status:lifecycleFailed ? 'failed' : 'completed',processed:worker.processed,failed:worker.failed,last_error:lifecycleFailed ? 'Booking lifecycle processing needs review.' : null }).eq('id',runId)
    if (recorded.error) throw recorded.error
    return NextResponse.json(
      {
        ok: !lifecycleFailed,
        expired,
        processed: worker.processed,
        failed: worker.failed,
        disabled: worker.disabled,
        budgetExhausted: worker.budgetExhausted,
      },
      { status: lifecycleFailed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    await db.from('workflow_worker_runs').update({ finished_at:new Date().toISOString(),status:'failed',last_error:'Worker could not finish. Unacknowledged jobs recover after lease expiry.' }).eq('id',runId)
    return NextResponse.json(
      { error: 'Workflow processing failed. Pending jobs remain queued.' },
      { status: 503 },
    )
  }
}
export const GET = POST
