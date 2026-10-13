import { apiClient, call, ServiceError } from './apiClient';
import { getDb, mutate } from './mock/db';
import { DEMO_PASSWORD } from '@/mock-data';
import { config } from '@/lib/config';
import { getSupabase } from '@/lib/supabaseClient';
import { nowIso } from '@/lib/utils';

/**
 * Mock mode: DEMO AUTHENTICATION — NOT PRODUCTION SECURITY. Credentials are
 * checked in the browser against the demo team so the UI can be explored without
 * a backend. Anyone can read this code.
 *
 * API mode: Supabase Auth (email + password) in the browser. supabase-js keeps and
 * refreshes the session; the Node.js API verifies the access token on every
 * request and requires an ACTIVE workspace membership (403 otherwise).
 */
function writeSession(session, remember) {
  const raw = JSON.stringify(session);
  try {
    localStorage.removeItem(config.sessionKey);
    sessionStorage.removeItem(config.sessionKey);
    (remember ? localStorage : sessionStorage).setItem(config.sessionKey, raw);
  } catch {
    /* storage unavailable — session lives in memory only */
  }
}

export function readSession() {
  try {
    const raw = localStorage.getItem(config.sessionKey) || sessionStorage.getItem(config.sessionKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(config.sessionKey);
    sessionStorage.removeItem(config.sessionKey);
  } catch {
    /* ignore */
  }
}

export const authService = {
  demoAccounts() {
    return getDb().users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor, password: DEMO_PASSWORD }));
  },

  login: ({ email, password, remember }) =>
    call({
      latency: 650,
      mock: () => {
        const db = getDb();
        const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
        if (!user || password !== DEMO_PASSWORD || user.status !== 'active') {
          throw new ServiceError('Invalid email or password. Use one of the demo accounts listed below.', { status: 401, code: 'invalid_credentials' });
        }
        mutate(() => {
          user.lastActiveAt = nowIso();
        });
        const session = { userId: user.id, startedAt: nowIso(), remember: !!remember, mode: 'demo' };
        writeSession(session, remember);
        return { session, user };
      },
      api: async () => {
        const supabase = await getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error || !data?.session) {
          const invalid = !error || error.status === 400 || /invalid/i.test(error.message || '');
          throw new ServiceError(invalid ? 'Invalid email or password.' : error.message || 'Sign-in failed. Please try again.', {
            status: invalid ? 401 : error.status || 400,
            code: invalid ? 'invalid_credentials' : error.code || 'auth_error',
          });
        }
        const user = await fetchMe(supabase);
        return { data: { user, session: apiSession(data.session, user, remember) } };
      },
    }),

  logout: () =>
    call({
      latency: 150,
      mock: () => {
        clearSession();
        return { ok: true };
      },
      api: async () => {
        clearSession();
        const supabase = await getSupabase();
        const { error } = await supabase.auth.signOut();
        // Revoking the refresh token failed (e.g. offline) — still drop the local session.
        if (error) await supabase.auth.signOut({ scope: 'local' });
        return { data: { ok: true } };
      },
    }),

  requestPasswordReset: ({ email }) =>
    call({
      latency: 900,
      // Always resolves the same way so the UI never reveals whether an account exists.
      mock: () => ({ ok: true, email }),
      api: async () => {
        const supabase = await getSupabase();
        const redirectTo = typeof window !== 'undefined' && window.location ? `${window.location.origin}/login` : undefined;
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        // Rate limits are worth surfacing; anything else resolves the same way so the
        // UI never reveals whether an account exists.
        if (error?.status === 429) throw new ServiceError('Too many reset requests. Please wait a few minutes and try again.', { status: 429, code: 'rate_limited' });
        return { data: { ok: true, email } };
      },
    }),

  currentUser: () =>
    call({
      latency: 0,
      mock: () => {
        const session = readSession();
        if (!session) return null;
        return getDb().users.find((u) => u.id === session.userId) || null;
      },
      api: async () => {
        const res = await apiClient.get('/auth/me');
        return { data: res.data?.user ?? null };
      },
    }),

  /**
   * API mode: restores the signed-in member from the persisted Supabase session.
   * Resolves `{ user, session }` or `null` when there is no (valid) session.
   */
  async restoreSession() {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return null;
    const user = await fetchMe(supabase);
    return { user, session: apiSession(data.session, user, true) };
  },

  /** API mode: sets a new password for the signed-in Supabase user. */
  async updatePassword(password) {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new ServiceError(error.message || 'The password could not be changed.', { status: error.status || 400, code: error.code || 'auth_error' });
    return { ok: true };
  },

  /** API mode: subscribes to Supabase auth changes (sign-out in another tab, token refresh). */
  async onAuthChange(listener) {
    const supabase = await getSupabase();
    const { data } = supabase.auth.onAuthStateChange((event, session) => listener(event, session));
    return () => data?.subscription?.unsubscribe();
  },
};

/** GET /auth/me; signs out locally when the account is not an active workspace member. */
async function fetchMe(supabase) {
  try {
    const res = await apiClient.get('/auth/me');
    if (!res.data?.user) throw new ServiceError('Your account could not be loaded.', { status: 500, code: 'no_user' });
    return res.data.user;
  } catch (err) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    if (err?.status === 403) {
      throw new ServiceError('Not a workspace member — this account is not an active member of the StudioFlow workspace. Ask your administrator for access.', {
        status: 403,
        code: 'not_workspace_member',
      });
    }
    throw err;
  }
}

/** Session summary shown in Settings → Security (no tokens are kept in app state). */
function apiSession(session, user, remember) {
  return {
    userId: user.id,
    email: session.user?.email || user.email,
    startedAt: session.user?.last_sign_in_at || nowIso(),
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    remember: !!remember,
    provider: 'supabase',
    mode: 'api',
  };
}

export { apiSession };
