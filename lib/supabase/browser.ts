import { createBrowserClient } from '@supabase/ssr'
import {clientFetch} from '@/lib/client-request'

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {global:{fetch:clientFetch}}
  )
}
