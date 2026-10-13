import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Monitor, Save, UserRound } from 'lucide-react';
import { Avatar, Button, Card, CardHeader, Field, Input, Switch, UnsavedChangesDialog } from '@/components/ui';
import { useBreadcrumbs, usePageTitle, useServiceMutation, useUnsavedChanges } from '@/hooks';
import { userService } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { profileSchema } from '@/lib/validation';
import { AvatarColorPicker } from '@/features/team/AvatarColorPicker';
import { isMockMode } from '@/lib/config';

export default function ProfileSettingsPage() {
  usePageTitle('Profile settings');
  useBreadcrumbs([{ label: 'Settings', to: '/settings' }, { label: 'Profile' }]);
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return <ProfileForm key={`${user.id}:${user.name}:${user.email}:${user.role}:${user.avatarColor}`} user={user} />;
}

function ProfileForm({ user }) {
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name, email: user.email, role: user.role, avatarColor: user.avatarColor || '#6257E8' },
  });
  const preview = useWatch({ control });
  const blocker = useUnsavedChanges(isDirty);

  const save = useServiceMutation((values) => userService.update(user.id, values), { success: 'Profile saved' });
  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
      reset(values);
      await refreshUser();
    } catch {
      /* toast shown by useServiceMutation */
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card>
          <CardHeader title="Profile" description="How you appear to the rest of the team" icon={UserRound} />
          <div className="space-y-5 p-5">
            <div className="flex items-center gap-4">
              <Avatar user={{ name: preview.name || user.name, avatarColor: preview.avatarColor }} size="xl" />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{preview.name || '—'}</div>
                <div className="truncate text-[13px] text-muted">{preview.email || '—'}</div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors.name?.message} required>
                <Input autoComplete="name" {...register('name')} />
              </Field>
              <Field label="Email" error={errors.email?.message} required hint={isMockMode ? undefined : 'Your sign-in email is managed by the workspace administrator.'}>
                <Input type="email" autoComplete="email" readOnly={!isMockMode} {...register('email')} />
              </Field>
              <Field label="Role" error={errors.role?.message} required className="sm:col-span-2" hint="Descriptive only — all members share the same access.">
                <Input {...register('role')} />
              </Field>
            </div>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Avatar colour</span>
              <Controller control={control} name="avatarColor" render={({ field }) => <AvatarColorPicker value={field.value} onChange={field.onChange} />} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/60 px-5 py-3">
            <p className="text-xs text-muted">{isMockMode ? 'Saved to the shared demo workspace — this does not change a real account.' : 'Name, role and avatar colour are saved to your workspace profile.'}</p>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!isDirty || isSubmitting} onClick={() => reset()}>
                Discard
              </Button>
              <Button type="submit" variant="primary" icon={Save} loading={isSubmitting} disabled={!isDirty}>
                Save profile
              </Button>
            </div>
          </div>
        </Card>
      </form>

      <Card>
        <CardHeader title="Display" description="Stored in this browser only and applied instantly" icon={Monitor} />
        <div className="p-5">
          <Switch
            checked={sidebarCollapsed}
            onChange={() => toggleSidebar()}
            label="Compact sidebar"
            description="Collapse the main navigation to icons for more working space. You can also toggle it from the sidebar."
          />
        </div>
      </Card>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
