import { config, isMockMode } from './config';

/**
 * Browser Supabase client — API mode only.
 *
 * Uses the PUBLIC anon/publishable key (safe to ship to browsers; all data access
 * is still verified by the Node.js API and Postgres RLS). The service-role key
 * must never be used here. supabase-js persists the session in localStorage and
 * refreshes the access token automatically.
 *
 * Loaded lazily so demo mode never downloads or initialises supabase-js.
 */
let clientPromise = null;

export function getSupabase() {
  if (isMockMode) return Promise.reject(new Error('Supabase is not used in demo mode.'));
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => {
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error('Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      }
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    });
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}

/** Current access token (refreshed by supabase-js when close to expiry), or null. */
export async function getAccessToken() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}
