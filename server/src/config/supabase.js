import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Public (anon/publishable key) client — used ONLY to verify end-user access
 * tokens with Supabase Auth. It carries no elevated privileges.
 */
let authClient = null;
export function getAuthClient() {
  if (!authClient) authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, noPersist);
  return authClient;
}

/**
 * Service-role client — bypasses RLS. Server-side only, never exposed. Used
 * exclusively for Storage object operations on the private application bucket,
 * AFTER the API has authorised the request against database records, and for
 * the operator-run provisioning script.
 */
let serviceClient = null;
export function getServiceClient() {
  if (!serviceClient) serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, noPersist);
  return serviceClient;
}

export function setSupabaseClients({ auth, service } = {}) {
  if (auth) authClient = auth;
  if (service) serviceClient = service;
}
