import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

/**
 * Route guard. In demo mode this only controls what the UI shows — it is NOT
 * security. In API mode every request is verified by the backend (Supabase
 * access token + active workspace membership); while the persisted session is
 * being restored we show a loading state instead of redirecting to /login.
 */
function SessionLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" role="status" aria-label="Restoring your session">
      <Loader2 className="animate-spin text-brand" size={22} />
    </div>
  );
}

function RestoreError({ message }) {
  const restore = useAuthStore((s) => s.restore);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4" role="alert">
      <div className="max-w-sm text-center">
        <AlertCircle className="mx-auto text-danger" size={24} aria-hidden />
        <p className="mt-3 text-[14px] text-ink">{message}</p>
        <button type="button" onClick={() => restore()} className="mt-4 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-canvas focus-ring">
          Try again
        </button>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const restoreError = useAuthStore((s) => s.restoreError);
  const location = useLocation();
  if (status === 'loading') return <SessionLoader />;
  if (!user && restoreError) return <RestoreError message={restoreError} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const passwordRecovery = useAuthStore((s) => s.passwordRecovery);
  if (status === 'loading') return <SessionLoader />;
  if (user) return <Navigate to={passwordRecovery ? '/settings/security' : '/'} replace />;
  return <Outlet />;
}
