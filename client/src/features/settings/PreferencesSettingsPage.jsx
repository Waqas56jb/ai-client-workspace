import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FlaskConical, LayoutGrid, List, PenLine, Save, SlidersHorizontal } from 'lucide-react';
import { Button, Card, CardHeader, ErrorState, Field, Segmented, Select, Skeleton, Switch, Textarea, UnsavedChangesDialog } from '@/components/ui';
import { useBreadcrumbs, usePageTitle, usePreferences, usePresets, useServiceMutation, useUnsavedChanges } from '@/hooks';
import { settingsService } from '@/services';
import { SPELLING_CONVENTIONS, TONES } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

const DATE_FORMATS = ['d MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'EEE, d MMMM yyyy'];

const preferencesSchema = z.object({
  writingPreferences: z.string().trim().max(2000, 'Keep this under 2,000 characters'),
  spelling: z.string().min(1, 'Choose a spelling convention'),
  defaultTone: z.string().min(1, 'Choose a default tone'),
  dateFormat: z.string().min(1),
  defaultFileView: z.enum(['grid', 'list']),
  defaultPresetId: z.string().min(1, 'Choose a default preset'),
  simulateFailures: z.boolean(),
});

function toValues(p) {
  return {
    writingPreferences: p.writingPreferences || '',
    spelling: p.spelling || 'Australian English',
    defaultTone: p.defaultTone || 'Professional',
    dateFormat: p.dateFormat || DATE_FORMATS[0],
    defaultFileView: p.defaultFileView === 'list' ? 'list' : 'grid',
    defaultPresetId: p.defaultPresetId || (isMockMode ? 'pr_square' : ''),
    simulateFailures: !!p.simulateFailures,
  };
}

export default function PreferencesSettingsPage() {
  usePageTitle('Workspace preferences');
  useBreadcrumbs([{ label: 'Settings', to: '/settings' }, { label: 'Preferences' }]);
  const { data, isLoading, error, refetch } = usePreferences();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[300px] w-full rounded-xl" />
        <Skeleton className="h-[220px] w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={refetch} />
      </Card>
    );
  }
  return <PreferencesForm key={JSON.stringify(data)} initial={toValues(data)} />;
}

function PreferencesForm({ initial }) {
  const { data: presets } = usePresets({ scope: 'global' });
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(preferencesSchema), defaultValues: initial });
  const dateFormat = useWatch({ control, name: 'dateFormat' });
  const blocker = useUnsavedChanges(isDirty);

  const save = useServiceMutation((values) => settingsService.updatePreferences(values), { success: 'Preferences saved' });
  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
      reset(values);
    } catch {
      /* toast shown by useServiceMutation */
    }
  };

  // The workspace default applies to every client, so only global presets qualify.
  const presetOptions = (presets || []).filter((p) => p.scope !== 'client').map((p) => ({ value: p.id, label: `${p.name} — ${p.width}×${p.height}` }));
  if (!isMockMode && !initial.defaultPresetId) presetOptions.unshift({ value: '', label: 'Choose a preset…' });
  if (initial.defaultPresetId && presets && !presets.some((p) => p.id === initial.defaultPresetId)) {
    presetOptions.unshift({ value: initial.defaultPresetId, label: 'Current preset (archived — choose another)' });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      <Card>
        <CardHeader title="Writing defaults" description="Used when a client profile doesn’t specify its own preference" icon={PenLine} />
        <div className="space-y-4 p-5">
          <Field label="General writing preferences" error={errors.writingPreferences?.message} hint="Included as workspace defaults in every prepared AI request.">
            <Textarea rows={3} {...register('writingPreferences')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred spelling convention" error={errors.spelling?.message}>
              <Select options={SPELLING_CONVENTIONS} {...register('spelling')} />
            </Field>
            <Field label="Default tone" error={errors.defaultTone?.message}>
              <Select options={TONES} {...register('defaultTone')} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Display & defaults" description="How dates, files and images are presented across the workspace" icon={SlidersHorizontal} />
        <div className="space-y-5 p-5">
          <Field label="Date display format" hint={`Example: ${formatDate(new Date(), dateFormat || DATE_FORMATS[0])}`}>
            <Select options={DATE_FORMATS.map((f) => ({ value: f, label: `${formatDate(new Date(), f)}  (${f})` }))} {...register('dateFormat')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Default file view</span>
              <Controller
                control={control}
                name="defaultFileView"
                render={({ field }) => (
                  <Segmented
                    ariaLabel="Default file view"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: 'grid', label: 'Grid', icon: LayoutGrid },
                      { value: 'list', label: 'List', icon: List },
                    ]}
                  />
                )}
              />
            </div>
            <Field label="Default image preset" error={errors.defaultPresetId?.message} hint="Pre-selected in the image tool.">
              {presets ? <Select options={presetOptions} {...register('defaultPresetId')} /> : <Skeleton className="h-9 w-full rounded-lg" />}
            </Field>
          </div>
        </div>
      </Card>

      {isMockMode && <Card>
        <CardHeader title="AI simulation" description="Demo-only behaviour for testing error handling" icon={FlaskConical} />
        <div className="p-5">
          <Controller
            control={control}
            name="simulateFailures"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onChange={field.onChange}
                label="Simulate occasional AI failures"
                description="Roughly 1 in 4 simulated requests will fail. The AI workspace then shows an error with a Retry action that resends the same prepared request — useful for checking the retry flow before the real API is connected."
              />
            )}
          />
        </div>
      </Card>}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur">
        <p className="text-xs text-muted">{isDirty ? 'You have unsaved changes.' : 'All changes saved.'} Preferences apply to the whole shared workspace.</p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!isDirty || isSubmitting} onClick={() => reset()}>
            Discard
          </Button>
          <Button type="submit" variant="primary" icon={Save} loading={isSubmitting} disabled={!isDirty}>
            Save preferences
          </Button>
        </div>
      </div>

      <UnsavedChangesDialog blocker={blocker} />
    </form>
  );
}
