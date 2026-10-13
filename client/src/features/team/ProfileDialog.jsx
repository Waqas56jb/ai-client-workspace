import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Avatar, Button, Dialog, Field, Input } from '@/components/ui';
import { useServiceMutation } from '@/hooks';
import { userService } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { profileSchema } from '@/lib/validation';
import { AvatarColorPicker } from './AvatarColorPicker';
import { isMockMode } from '@/lib/config';

/** Edit a demo team member's profile. Refreshes the session user when editing yourself. */
export function ProfileDialog({ user, open, onClose }) {
  const me = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: '', email: '', role: '', avatarColor: '#6257E8' } });

  useEffect(() => {
    if (user) reset({ name: user.name, email: user.email, role: user.role, avatarColor: user.avatarColor || '#6257E8' });
  }, [user, reset]);

  const preview = useWatch({ control });
  const save = useServiceMutation((values) => userService.update(user.id, values), {
    success: (u) => `Updated ${u.name}`,
    onSuccess: async (u) => {
      if (me?.id === u.id) await refreshUser();
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title="Edit profile"
      description={isMockMode ? 'Updates the shared demo record only — no real account is changed.' : 'Updates your workspace profile (name, role and avatar colour).'}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!isDirty} onClick={handleSubmit((v) => save.mutate(v))}>
            Save profile
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas/60 p-3">
          <Avatar user={{ name: preview.name || user?.name || '?', avatarColor: preview.avatarColor }} size="xl" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">{preview.name || '—'}</div>
            <div className="truncate text-xs text-muted">{preview.role || '—'}</div>
          </div>
        </div>
        <Field label="Full name" error={errors.name?.message} required>
          <Input autoComplete="name" {...register('name')} data-autofocus />
        </Field>
        <Field label="Email" error={errors.email?.message} required hint={isMockMode ? undefined : 'Sign-in emails are managed by the workspace administrator.'}>
          <Input type="email" autoComplete="email" readOnly={!isMockMode} {...register('email')} />
        </Field>
        <Field label="Role" error={errors.role?.message} required hint="Descriptive only — all members have the same access in this release.">
          <Input {...register('role')} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Avatar colour</span>
          <Controller control={control} name="avatarColor" render={({ field }) => <AvatarColorPicker value={field.value} onChange={field.onChange} />} />
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
