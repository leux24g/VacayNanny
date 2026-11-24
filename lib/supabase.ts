import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function hasSupabaseConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

let _browser: SupabaseClient | null = null
export function getSupabaseClient() {
  if (!_browser) {
    if (!hasSupabaseConfig()) {
      throw new Error('Supabase environment variables are not set')
    }
    _browser = createBrowserClient()
  }
  return _browser
}
