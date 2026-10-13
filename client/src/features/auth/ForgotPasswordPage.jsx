import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, MailCheck, Mail, Send } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { authService } from '@/services';
import { forgotPasswordSchema } from '@/lib/validation';
import { AuthLayout, DemoAuthNotice } from './AuthLayout';
import { isMockMode } from '@/lib/config';

export default function ForgotPasswordPage() {
  usePageTitle('Reset password');
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = async (values) => {
    setError(null);
    try {
      await authService.requestPasswordReset(values);
      setSentTo(values.email.trim());
    } catch (err) {
      setError(err?.message || 'We could not process the request. Please try again.');
    }
  };

  return (
    <AuthLayout>
      {sentTo ? (
        <div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success-soft text-success">
            <MailCheck size={22} aria-hidden />
          </span>
          <h1 className="mt-5 font-display text-[26px] font-bold tracking-[-0.01em] text-ink">Check your inbox</h1>
          <p className="mt-2 text-[14px] leading-6 text-muted" role="status">
            If an account exists for <span className="font-medium text-ink">{sentTo}</span>, {isMockMode ? 'a password reset link would be sent to it.' : 'we’ve sent a password reset link to it. The link signs you in so you can choose a new password in Settings → Security.'}
          </p>
          {isMockMode && (
          <div className="mt-6">
            <DemoAuthNotice>
              <strong className="font-semibold">Demo mode:</strong> no email is actually sent. Demo accounts all use the password shown on the sign-in page.
              Password resets will be handled by the backend.
            </DemoAuthNotice>
          </div>
          )}
          <div className="mt-7 flex flex-wrap gap-2">
            <Button as={Link} to="/login" variant="primary" icon={ArrowLeft}>
              Back to sign in
            </Button>
            <Button variant="ghost" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <h1 className="font-display text-[26px] font-bold tracking-[-0.01em] text-ink">Reset your password</h1>
          <p className="mt-1.5 text-[14px] text-muted">Enter the email you use for StudioFlow AI and we’ll send you a reset link.</p>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-4">
            {error && (
              <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}
            <Field label="Email" error={errors.email?.message} required>
              <Input type="email" icon={Mail} autoComplete="email" placeholder={isMockMode ? 'you@studioflow.demo' : 'you@company.com'} autoFocus {...register('email')} />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting} icon={Send}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
          {isMockMode && <p className="mt-4 text-xs text-muted">Demo mode: no email is actually sent.</p>}
          <Link to="/login" className="mt-8 inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-brand hover:underline focus-ring">
            <ArrowLeft size={15} aria-hidden /> Back to sign in
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
