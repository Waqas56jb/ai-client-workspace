import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRound, LogOut, MonitorSmartphone, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, MetaRow } from '@/components/ui';
import { useBreadcrumbs, usePageTitle } from '@/hooks';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';
import { authService } from '@/services';

const KEY_POINTS = [
  'OpenAI API keys and the Supabase service-role key will live only on the Node.js server, loaded from server environment variables.',
  'The browser talks to our own API; the server adds keys when calling OpenAI or Supabase. Keys are never sent to, or stored in, the frontend.',
  'Anything prefixed VITE_ is bundled into the public JavaScript and visible to anyone — only non-secret values (like the API base URL) may use it.',
  'This demo makes no OpenAI calls at all: AI output is simulated in the browser.',
];

const API_KEY_POINTS = [
  'The OpenAI API key and the Supabase service-role key live only on the Node.js server (Railway environment variables). They are never sent to the browser.',
  'The browser signs in with Supabase Auth using the public anon/publishable key, then sends its short-lived access token to the StudioFlow API on every request.',
  'The API verifies the token and your active workspace membership on every request; database row-level security applies to everything you read or change.',
  'Anything prefixed VITE_ is bundled into the public JavaScript — only non-secret values (API URL, Supabase URL and anon key) may use it.',
];

export default function SecuritySettingsPage() {
  usePageTitle('Security');
  useBreadcrumbs([{ label: 'Settings', to: '/settings' }, { label: 'Security' }]);
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const doLogout = async () => {
    setBusy(true);
    try {
      await logout();
      toast.success(isMockMode ? 'Signed out of the demo session' : 'Signed out');
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Current session"
          description={isMockMode ? 'Demo session stored in this browser' : 'Supabase Auth session in this browser (refreshed automatically)'}
          icon={MonitorSmartphone}
          action={
            <Badge tone={isMockMode ? 'warning' : 'success'} dot>
              {session?.mode === 'api' ? 'Signed in' : 'Demo session'}
            </Badge>
          }
        />
        <div className="p-5">
          {user && (
            <div className="mb-4 flex items-center gap-3">
              <Avatar user={user} size="lg" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-ink">{user.name}</div>
                <div className="truncate text-xs text-muted">{user.email}</div>
              </div>
            </div>
          )}
          <dl className="divide-y divide-line border-t border-line">
            <MetaRow label={isMockMode ? 'Session started' : 'Signed in'}>
              {session?.startedAt ? (
                <span title={formatDateTime(session.startedAt)}>
                  {formatDateTime(session.startedAt)} · {timeAgo(session.startedAt)}
                </span>
              ) : (
                '—'
              )}
            </MetaRow>
            {isMockMode ? (
              <MetaRow label="Remember me">{session?.remember ? 'On — kept in localStorage until you sign out' : 'Off — ends when this browser tab session closes'}</MetaRow>
            ) : (
              <>
                <MetaRow label="Signed in as">{session?.email || user?.email || '—'}</MetaRow>
                <MetaRow label="Access token expires">
                  {session?.expiresAt ? `${formatDateTime(session.expiresAt)} · renewed automatically while you’re signed in` : '—'}
                </MetaRow>
                <MetaRow label="Provider">Supabase Auth (email & password)</MetaRow>
              </>
            )}
            <MetaRow label="Mode">{session?.mode === 'api' ? 'API (StudioFlow server)' : 'Demo (in-browser check)'}</MetaRow>
          </dl>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/60 px-5 py-3">
          <p className="text-xs text-muted">{isMockMode ? 'Signing out clears the demo session from this browser. Workspace data is kept.' : 'Signing out ends your session and revokes its refresh token.'}</p>
          <Button variant="danger-ghost" icon={LogOut} onClick={() => setConfirm(true)}>
            Log out
          </Button>
        </div>
      </Card>

      {!isMockMode && <ChangePasswordCard />}

      {isMockMode && <Card>
        <CardHeader title="Authentication" icon={ShieldAlert} />
        <div className="space-y-3 p-5 text-[13px] leading-6 text-muted">
          <p>
            <strong className="font-semibold text-ink">This is demo authentication, not production security.</strong> Credentials are checked in your browser against the demo
            team, and route guards only control what the interface shows.
          </p>
          <p>
            The production release will authenticate on the Node.js backend (hashed passwords, server-issued sessions or JWTs, rate limiting and secure password resets) and
            enforce access on every API request.
          </p>
        </div>
      </Card>}

      <Card>
        <CardHeader title="API keys & secrets" icon={KeyRound} />
        <ul className="space-y-3 p-5">
          {(isMockMode ? KEY_POINTS : API_KEY_POINTS).map((p) => (
            <li key={p} className="flex gap-2.5 text-[13px] leading-6 text-muted">
              <ShieldCheck size={16} className="mt-1 shrink-0 text-success" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={doLogout}
        loading={busy}
        icon={LogOut}
        title="Log out of StudioFlow AI?"
        description={isMockMode ? 'You’ll return to the sign-in page. Your workspace data stays in this browser.' : 'You’ll return to the sign-in page.'}
        confirmLabel="Log out"
      />
    </div>
  );
}

/** API mode: change the Supabase Auth password (also used after a password-reset link). */
function ChangePasswordCard() {
  const recovery = useAuthStore((s) => s.passwordRecovery);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirmPassword) return setError('The passwords don’t match.');
    setSaving(true);
    try {
      await authService.updatePassword(password);
      useAuthStore.setState({ passwordRecovery: false });
      setPassword('');
      setConfirmPassword('');
      toast.success('Password changed');
    } catch (err) {
      setError(err?.message || 'The password could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={recovery ? 'border-brand' : undefined}>
      <CardHeader title={recovery ? 'Choose a new password' : 'Change password'} description={recovery ? 'You opened a password-reset link. Set a new password to finish.' : undefined} icon={KeyRound} />
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
        <Field label="New password" error={error || undefined}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" loading={saving} disabled={!password}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}
