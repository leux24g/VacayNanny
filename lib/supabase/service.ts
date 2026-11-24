import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { requestSignal } from '@/lib/worker-context'

/** Server-only privileged client. Requests and worker deadlines are bounded. */
export function createServerClient({ timeoutMs = 10000 }: { timeoutMs?: number } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Server database access is not configured.')
  return createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(input,init)=>fetch(input,{...init,signal:requestSignal(timeoutMs,init?.signal)})},
  })
}
export const createAdminClient = createServerClient
