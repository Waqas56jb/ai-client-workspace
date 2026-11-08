import { config } from './config';

/**
 * Sign-in against our own API (VITE_AUTH_MODE=local, the AWS deployment) with the
 * same methods the app uses from supabase-js, so authService/apiClient need no
 * changes. The session (short-lived access token + rotating refresh token) is kept
 * in localStorage like supabase-js does, and refreshed shortly before it expires.
 */
const KEY = 'studioflow.auth';
const listeners = new Set();
let refreshing = null;

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
const write = (session) => {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the session lasts until the tab closes */
  }
};
const emit = (event, session) => listeners.forEach((fn) => fn(event, session));

async function post(path, body, token) {
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    method: path === '/auth/password' ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return res.ok ? { data: json?.data, error: null } : { data: null, error: { status: res.status, message: json?.error?.message || 'Request failed.' } };
}

async function refresh(session) {
  refreshing ||= post('/auth/refresh', { refreshToken: session.refresh_token })
    .then(({ data, error }) => {
      if (error) {
        // only a definite "no" signs out; a network blip keeps the session for the next try
        if (error.status === 401) {
          write(null);
          emit('SIGNED_OUT', null);
        }
        return error.status === 401 ? null : session;
      }
      write(data.session);
      emit('TOKEN_REFRESHED', data.session);
      return data.session;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export const localAuthClient = {
  auth: {
    async getSession() {
      let session = read();
      if (session && session.expires_at - 60 < Date.now() / 1000) session = await refresh(session);
      return { data: { session }, error: null };
    },

    async signInWithPassword({ email, password }) {
      const { data, error } = await post('/auth/login', { email, password });
      if (error) return { data: { session: null, user: null }, error: { ...error, status: error.status === 401 ? 400 : error.status } };
      write(data.session);
      emit('SIGNED_IN', data.session);
      return { data: { session: data.session, user: data.session.user }, error: null };
    },

    async signOut({ scope } = {}) {
      const session = read();
      write(null);
      emit('SIGNED_OUT', null);
      if (scope !== 'local' && session?.refresh_token) await post('/auth/logout', { refreshToken: session.refresh_token }).catch(() => {});
      return { error: null };
    },

    async updateUser({ password }) {
      const { data } = await this.getSession();
      if (!data.session) return { data: null, error: { status: 401, message: 'Please sign in again.' } };
      const { error } = await post('/auth/password', { password }, data.session.access_token);
      return { data: error ? null : { user: data.session.user }, error };
    },

    /** No email service on this deployment: password resets go through an administrator. */
    async resetPasswordForEmail() {
      return { data: {}, error: null };
    },

    onAuthStateChange(fn) {
      listeners.add(fn);
      // another tab signed in or out
      const onStorage = (e) => e.key === KEY && fn(e.newValue ? 'SIGNED_IN' : 'SIGNED_OUT', e.newValue ? JSON.parse(e.newValue) : null);
      window.addEventListener('storage', onStorage);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(fn);
              window.removeEventListener('storage', onStorage);
            },
          },
        },
      };
    },
  },
};
