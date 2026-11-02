import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, Lock, Mail, Sparkles, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Switch } from '@/components/ui';
import { useServiceMutation } from '@/hooks';
import { userService } from '@/services';
import { copyToClipboard } from '@/lib/utils';

/** A strong, easy-to-read password (no look-alike characters). */
export function generatePassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  const body = Array.from(bytes, (n) => chars[n % chars.length]).join('');
  return `${body.slice(0, 7)}-${body.slice(7)}`;
}

function passwordProblem(password) {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 72) return 'Use at most 72 characters.';
  return null;
}

/** Password box with show/hide, generate and copy — the admin shares it with the member. */
function PasswordField({ value, onChange, error, label = 'Password' }) {
  const [show, setShow] = useState(false);
  const copy = async () => {
    await copyToClipboard(value);
    toast.success('Password copied');
  };
  return (
    <Field label={label} error={error} required hint="At least 8 characters. Share it privately; they can change it in Settings → Security.">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            aria-invalid={!!error || undefined}
            className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-10 font-mono text-[14px] text-ink outline-none transition-colors focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:bg-canvas hover:text-ink focus-ring"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <Button
          type="button"
          icon={Sparkles}
          onClick={() => {
            onChange(generatePassword());
            setShow(true);
          }}
        >
          Generate
        </Button>
        <Button type="button" icon={Copy} onClick={copy} disabled={!value} aria-label="Copy password" />
      </div>
    </Field>
  );
}

const EMPTY = { name: '', email: '', role: '', password: '', isAdmin: false };

/** Administrator: add a member account. */
export function AddMemberDialog({ open, onClose }) {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setV({ ...EMPTY, password: generatePassword() });
      setErrors({});
    }
  }, [open]);
  const set = (k) => (val) => setV((x) => ({ ...x, [k]: val?.target ? val.target.value : val }));

  const save = useServiceMutation((values) => userService.create(values), {
    success: (u) => `${u.name} can now sign in`,
    onSuccess: onClose,
  });

  const submit = (e) => {
    e?.preventDefault();
    const next = {};
    if (!v.name.trim()) next.name = 'Enter their name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) next.email = 'Enter a valid email address.';
    const pw = passwordProblem(v.password);
    if (pw) next.password = pw;
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate({ name: v.name.trim(), email: v.email.trim(), role: v.role.trim() || 'Team member', password: v.password, isAdmin: v.isAdmin });
  };

  return (
    <Dialog
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title="Add a team member"
      description="They sign in with this email and password. Nobody can sign up on their own."
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserPlus} loading={save.isPending} onClick={submit}>
            Create account
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.name} required>
            <Input autoComplete="off" value={v.name} onChange={set('name')} data-autofocus />
          </Field>
          <Field label="Role" hint="For example Copywriter.">
            <Input autoComplete="off" value={v.role} onChange={set('role')} placeholder="Team member" />
          </Field>
        </div>
        <Field label="Email" error={errors.email} required>
          <Input type="email" icon={Mail} autoComplete="off" value={v.email} onChange={set('email')} placeholder="name@company.com" />
        </Field>
        <PasswordField value={v.password} onChange={set('password')} error={errors.password} />
        <div className="rounded-xl border border-line bg-canvas/60 p-3">
          <Switch
            checked={v.isAdmin}
            onChange={set('isAdmin')}
            label="Administrator"
            description="Can add and remove people and change their passwords."
          />
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** Administrator: set a new password for a member. */
export function PasswordDialog({ user, open, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setPassword(generatePassword());
      setError(null);
    }
  }, [open]);

  const save = useServiceMutation((pw) => userService.setPassword(user.id, pw), {
    success: () => `Password changed for ${user?.name}`,
    onSuccess: onClose,
  });

  const submit = (e) => {
    e?.preventDefault();
    const problem = passwordProblem(password);
    setError(problem);
    if (!problem) save.mutate(password);
  };

  return (
    <Dialog
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      size="sm"
      title="Change password"
      description={user ? `Set a new password for ${user.name} (${user.email}). Their old password stops working.` : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon={KeyRound} loading={save.isPending} onClick={submit}>
            Save password
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <PasswordField label="New password" value={password} onChange={setPassword} error={error} />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
