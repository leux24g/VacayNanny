import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requestSignal } from '@/lib/worker-context'

export async function createSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global:{fetch:(input,init)=>fetch(input,{...init,signal:requestSignal(8000,init?.signal)})},
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Called from a Server Component — middleware will refresh the session.
          }
        },
      },
    }
  )
}
