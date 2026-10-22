import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend env.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const API_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://unpack-backend.vercel.app'

/**
 * Asks the backend to create (or reuse) this user's $0-capped OpenRouter key.
 * The key itself never reaches the browser.
 */
export async function provisionKey(accessToken) {
  const res = await fetch(`${API_URL}/provision-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Key provisioning failed (HTTP ${res.status})`)
  }
  return res.json()
}