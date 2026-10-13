import { create } from 'zustand';
import { authService, apiSession, readSession } from '@/services/authService';
import { userService } from '@/services/userService';
import { setUnauthorizedHandler } from '@/services/apiClient';
import { getDb } from '@/services/mock/db';
import { isMockMode } from '@/lib/config';
import { queryClient } from '@/app/providers';

/**
 * Holds the signed-in user.
 *
 * Mock mode: the demo user is restored synchronously from the demo session; the
 * workspace data is shared and lives in the mock database.
 *
 * API mode: the user is restored asynchronously from the persisted Supabase
 * session (`status: 'loading'` until done) and verified with GET /auth/me.
 */
function initialUser() {
  const session = readSession();
  if (!session || !isMockMode) return null;
  return getDb().users.find((u) => u.id === session.userId) || null;
}

export const useAuthStore = create((set, get) => ({
  user: initialUser(),
  session: isMockMode ? readSession() : null,
  /** 'loading' while an API-mode session is being restored, then 'ready'. */
  status: isMockMode ? 'ready' : 'loading',
  restoreError: null,
  /** API mode: the user arrived through a password-reset link and should choose a new password. */
  passwordRecovery: false,

  async login(values) {
    const { user, session } = await authService.login(values);
    set({ user, session, status: 'ready', restoreError: null });
    return user;
  },

  async logout() {
    try {
      await authService.logout();
    } finally {
      set({ user: null, session: null, passwordRecovery: false });
      if (!isMockMode) clearQueryCache();
    }
  },

  /** API mode: restore the session on app start. */
  async restore() {
    if (isMockMode) return;
    set({ status: 'loading', restoreError: null });
    try {
      const res = await authService.restoreSession();
      set({ user: res?.user || null, session: res?.session || null, status: 'ready' });
    } catch (err) {
      // 401/403 → signed out (fetchMe already cleared the local session).
      const signedOut = err?.status === 401 || err?.status === 403;
      set({ user: null, session: null, status: 'ready', restoreError: signedOut ? null : err?.message || 'Could not restore your session.' });
    }
  },

  /** Clears the user locally (session expired / revoked). RequireAuth redirects to /login. */
  signedOutLocally() {
    if (!get().user) return;
    set({ user: null, session: null });
    clearQueryCache();
  },

  /** Re-reads the current user's record (e.g. after editing their profile). */
  async refreshUser() {
    const current = get().user;
    if (!current) return;
    try {
      const user = isMockMode ? await userService.get(current.id) : await authService.currentUser();
      set({ user: user || current });
    } catch {
      if (isMockMode) set({ user: null, session: null });
    }
  },
}));

function clearQueryCache() {
  queryClient.clear();
}

if (!isMockMode && typeof window !== 'undefined') {
  setUnauthorizedHandler(() => useAuthStore.getState().signedOutLocally());
  useAuthStore.getState().restore();
  authService
    .onAuthChange((event, session) => {
      const state = useAuthStore.getState();
      if (event === 'SIGNED_OUT') state.signedOutLocally();
      else if (event === 'PASSWORD_RECOVERY') useAuthStore.setState({ passwordRecovery: true });
      else if (event === 'TOKEN_REFRESHED' && session && state.user) {
        useAuthStore.setState({ session: apiSession(session, state.user, state.session?.remember ?? true) });
      }
    })
    .catch(() => {});
}
