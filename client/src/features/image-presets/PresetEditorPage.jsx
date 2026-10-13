import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeftRight, Info, Save } from 'lucide-react';
import { Button, Card, CardHeader, ErrorState, Field, Input, Page, PageHeader, Segmented, Select, Skeleton, Switch, Textarea, UnsavedChangesDialog } from '@/components/ui';
import { useBreadcrumbs, useClient, useClients, usePageTitle, usePreset, useServiceMutation, useUnsavedChanges } from '@/hooks';
import { presetService } from '@/services';
import { presetSchema } from '@/lib/validation';
import { aspectRatio } from '@/lib/utils';
import { PresetPreview } from './components';

const EMPTY = {
  name: '',
  description: '',
  width: 1080,
  height: 1080,
  scope: 'global',
  clientId: '',
  background: '',
  layout: '',
  typography: '',
  brandColors: '',
  logoPlacement: '',
  safeArea: 'Keep text and logos 7% inside every edge.',
};

const FIELDS = Object.keys(EMPTY);

export default function PresetEditorPage() {
  const { presetId } = useParams();
  const isEdit = !!presetId;
  const { data: preset, isLoading, error, refetch } = usePreset(presetId);

  usePageTitle(isEdit ? `Edit ${preset?.name || 'preset'}` : 'New image preset');
  useBreadcrumbs([{ label: 'Image presets', to: '/image-presets' }, { label: isEdit ? preset?.name || 'Edit preset' : 'New preset' }]);

  if (isEdit && isLoading) {
    return (
      <Page>
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[520px] w-full rounded-xl" />
          <Skeleton className="h-[460px] w-full rounded-xl" />
        </div>
      </Page>
    );
  }
  if (isEdit && error) {
    return (
      <Page narrow>
        <Card>
          <ErrorState error={error} onRetry={refetch} />
          {error.status === 404 && (
            <div className="-mt-8 pb-10 text-center">
              <Button as={Link} to="/image-presets">
                Back to presets
              </Button>
            </div>
          )}
        </Card>
      </Page>
    );
  }

  const initial = preset ? Object.fromEntries(FIELDS.map((k) => [k, preset[k] ?? EMPTY[k]])) : EMPTY;
  return <PresetForm key={preset?.id || 'new'} preset={preset} initial={initial} />;
}

function PresetForm({ preset, initial }) {
  const navigate = useNavigate();
  const isEdit = !!preset;
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [done, setDone] = useState(false);
  const { data: clients } = useClients();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(presetSchema), defaultValues: initial });

  const [name, width, height, scope, clientId] = useWatch({ control, name: ['name', 'width', 'height', 'scope', 'clientId'] });
  const { data: client } = useClient(scope === 'client' && clientId ? clientId : null);

  const blocker = useUnsavedChanges(isDirty && !done);

  const save = useServiceMutation((values) => (isEdit ? presetService.update(preset.id, values) : presetService.create(values)), {
    success: (p) => (isEdit ? `Saved “${p.name}”` : `Created “${p.name}”`),
  });

  useEffect(() => {
    if (done) navigate('/image-presets');
  }, [done, navigate]);

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync({ ...values, clientId: values.scope === 'client' ? values.clientId : '' });
      reset(values);
      setDone(true);
    } catch {
      /* toast shown by useServiceMutation */
    }
  };

  const w = Number(width);
  const h = Number(height);
  const swap = () => {
    setValue('width', h, { shouldDirty: true, shouldValidate: true });
    setValue('height', w, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <Page>
      <PageHeader
        title={isEdit ? `Edit preset` : 'New image preset'}
        description={isEdit ? preset.name : 'Save a size and layout guidance for the image tool.'}
        actions={
          <>
            <Button as={Link} to="/image-presets" variant="secondary">
              Cancel
            </Button>
            <Button variant="primary" icon={Save} loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
              {isEdit ? 'Save changes' : 'Create preset'}
            </Button>
          </>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Basics" description="Name, size and who can use this preset" />
            <div className="space-y-4 p-5">
              <Field label="Preset name" error={errors.name?.message} required>
                <Input placeholder="e.g. Square social image" {...register('name')} />
              </Field>
              <Field label="Description" error={errors.description?.message} hint="Where this size is typically used.">
                <Textarea rows={2} {...register('description')} />
              </Field>

              <div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
                  <Field label="Width (px)" error={errors.width?.message} required>
                    <Input type="number" inputMode="numeric" min={64} max={8192} step={1} {...register('width', { valueAsNumber: true })} />
                  </Field>
                  <Button variant="ghost" size="icon-sm" icon={ArrowLeftRight} onClick={swap} aria-label="Swap width and height" className="mt-[26px]" title="Swap width and height" />
                  <Field label="Height (px)" error={errors.height?.message} required>
                    <Input type="number" inputMode="numeric" min={64} max={8192} step={1} {...register('height', { valueAsNumber: true })} />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Aspect ratio: <span className="font-mono font-medium text-ink">{aspectRatio(w, h)}</span>
                  {w > 0 && h > 0 && <span> · {(w * h / 1e6).toFixed(2)} MP</span>}
                </p>
              </div>

              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink">Scope</span>
                <Segmented
                  ariaLabel="Preset scope"
                  value={scope}
                  onChange={(v) => {
                    setValue('scope', v, { shouldDirty: true, shouldValidate: !!errors.clientId });
                    if (v === 'global') setValue('clientId', '', { shouldDirty: true, shouldValidate: true });
                  }}
                  options={[
                    { value: 'global', label: 'Global — all clients' },
                    { value: 'client', label: 'Client-specific' },
                  ]}
                />
              </div>
              {scope === 'client' && (
                <Field label="Client" error={errors.clientId?.message} required hint="Only shown in the image tool for this client.">
                  {clients ? (
                    <Select placeholder="Select a client…" options={clients.map((c) => ({ value: c.id, label: c.name }))} {...register('clientId')} />
                  ) : (
                    <Skeleton className="h-9 w-full rounded-lg" />
                  )}
                </Field>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Creative guidance" description="Included in every image request that uses this preset" />
            <div className="space-y-4 p-5">
              <Field label="Preferred background" error={errors.background?.message}>
                <Input placeholder="e.g. Brand primary colour or lifestyle photography" {...register('background')} />
              </Field>
              <Field label="Layout guidance" error={errors.layout?.message}>
                <Textarea rows={3} placeholder="Where the headline, supporting text and CTA should sit…" {...register('layout')} />
              </Field>
              <Field label="Typography guidance" error={errors.typography?.message}>
                <Textarea rows={2} placeholder="Heading/body font usage, maximum words per headline…" {...register('typography')} />
              </Field>
              <Field label="Brand colour instructions" error={errors.brandColors?.message}>
                <Textarea rows={2} placeholder="How brand colours should be used…" {...register('brandColors')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Logo placement" error={errors.logoPlacement?.message}>
                  <Textarea rows={2} placeholder="e.g. Top-left, 8% of shortest side" {...register('logoPlacement')} />
                </Field>
                <Field label="Safe-area guidance" error={errors.safeArea?.message}>
                  <Textarea rows={2} placeholder="e.g. Keep text 7% inside every edge" {...register('safeArea')} />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Live preview" description="Demo render at the preset’s exact dimensions, scaled to fit" action={<Switch checked={showSafeArea} onChange={setShowSafeArea} label="Safe area" />} />
            <div className="p-5">
              <PresetPreview width={w} height={h} name={name} client={scope === 'client' ? client : null} showSafeArea={showSafeArea} />
            </div>
          </Card>

          <div className="rounded-xl border border-info/20 bg-info-soft p-4 text-[13px] leading-5 text-[#1F4E9E]">
            <div className="mb-2 flex items-center gap-2 font-semibold text-info">
              <Info size={16} aria-hidden /> Requested vs. delivered dimensions
            </div>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="font-semibold">Requested generation size</strong> is what we ask the image model for. Image APIs may only support a few fixed sizes, so the
                model’s raw output may differ.
              </li>
              <li>
                <strong className="font-semibold">Downloaded size</strong> is always exactly {Number.isFinite(w) ? w : '—'} × {Number.isFinite(h) ? h : '—'} px — the future backend
                post-processes each image (resize / crop) to the preset’s exact pixels.
              </li>
              <li>Fonts and on-image text are guidance for the model. Exact typography and logos may be placed by a controlled rendering layer after generation.</li>
            </ul>
          </div>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      <UnsavedChangesDialog blocker={blocker} />
    </Page>
  );
}
