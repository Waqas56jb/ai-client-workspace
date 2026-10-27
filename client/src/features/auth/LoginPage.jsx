import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Button, Checkbox, Field, Input } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services';
import { loginSchema } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { isMockMode } from '@/lib/config';
import { AuthLayout, DemoAuthNotice } from './AuthLayout';

export default function LoginPage() {
  usePageTitle('Sign in');
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState(null);
  const accounts = useMemo(() => (isMockMode ? authService.demoAccounts() : []), []);
  const [notMember, setNotMember] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: true },
  });
  const email = watch('email');

  const onSubmit = async (values) => {
    setAuthError(null);
    setNotMember(false);
    try {
      const user = await login(values);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      const from = location.state?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      if (err?.status === 403) setNotMember(true);
      setAuthError(err?.status === 403 ? 'Not a workspace member. This account signed in successfully but is not an active member of the StudioFlow workspace. Ask your administrator to add you.' : err?.message || 'Sign-in failed. Please try again.');
    }
  };

  const fillAccount = (a) => {
    setValue('email', a.email, { shouldValidate: true, shouldDirty: true });
    setValue('password', a.password, { shouldValidate: true, shouldDirty: true });
    setAuthError(null);
  };

  return (
    <AuthLayout>
      <h1 className="font-display text-[26px] font-bold tracking-[-0.01em] text-ink">Sign in</h1>
      <p className="mt-1.5 text-[14px] text-muted">Welcome back. Sign in to your StudioFlow AI workspace.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-4">
        {authError && (
          <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {notMember && <strong className="block font-semibold">Not a workspace member</strong>}
              {notMember ? authError.replace(/^Not a workspace member\. /, '') : authError}
            </span>
          </div>
        )}

        <Field label="Email" error={errors.email?.message} required>
          <Input type="email" icon={Mail} autoComplete="email" placeholder={isMockMode ? 'you@studioflow.demo' : 'you@company.com'} {...register('email')} />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="text-[13px] font-medium text-ink">
              Password<span className="ml-0.5 text-danger" aria-hidden>*</span>
            </label>
            <Link to="/forgot-password" className="rounded text-[12.5px] font-medium text-brand hover:underline focus-ring">
              Forgot password?
            </Link>
          </div>
          <Field error={errors.password?.message} id="login-password">
            <PasswordInput show={showPassword} onToggle={() => setShowPassword((s) => !s)} {...register('password')} />
          </Field>
        </div>

        <Checkbox label="Remember me on this browser" {...register('remember')} />

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting} iconRight={ArrowRight}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {isMockMode ? (
      <>
      <section className="mt-8" aria-labelledby="demo-accounts-heading">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 id="demo-accounts-heading" className="text-[13px] font-semibold text-ink">
            Demo accounts
          </h2>
          <span className="text-xs text-muted">
            Password: <code className="rounded bg-[#F1F2F7] px-1 py-px font-mono text-[11.5px] text-ink">{accounts[0]?.password}</code>
          </span>
        </div>
        <div className="space-y-1.5">
          {accounts.map((a) => {
            const selected = email?.toLowerCase() === a.email.toLowerCase();
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => fillAccount(a)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition-colors focus-ring',
                  selected ? 'border-brand ring-3 ring-brand/10' : 'border-line hover:border-line-strong hover:bg-canvas/60',
                )}
              >
                <Avatar user={a} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{a.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {a.role} · {a.email}
                  </span>
                </span>
                <span className={cn('text-xs font-medium', selected ? 'text-brand' : 'text-subtle')}>{selected ? 'Selected' : 'Use'}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-5">
        <DemoAuthNotice>
          <strong className="font-semibold">Demo authentication</strong> — credentials are checked in your browser and are not production security. Real sign-in
          will be handled by the Node.js backend.
        </DemoAuthNotice>
      </div>
      </>
      ) : (
        <p className="mt-6 text-xs leading-5 text-muted">
          Accounts are created by your workspace administrator. Use the email and password you were given, or reset your password if you’ve forgotten it.
        </p>
      )}
    </AuthLayout>
  );
}

function PasswordInput({ show, onToggle, id, invalid, ...props }) {
  return (
    <div className="relative">
      <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        placeholder="Enter your password"
        aria-invalid={invalid || undefined}
        className={cn(
          'h-9 w-full rounded-lg border bg-surface pl-9 pr-10 text-[14px] text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand focus:ring-3 focus:ring-brand/15',
          invalid ? 'border-danger' : 'border-line',
        )}
        {...props}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:bg-canvas hover:text-ink focus-ring"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
