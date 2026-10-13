import { useMemo, useState } from 'react';
import { FlaskConical, ImagePlus, Wand, X } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Field, Input, Segmented, Select } from '@/components/ui';
import { VersionThumb } from '@/components/data-display/Entities';
import { aspectRatio, cn, timeAgo } from '@/lib/utils';
import { BrandContextPanel } from './BrandContextPanel';
import { MAX_DIM, MIN_DIM, dimensionError } from './toolMeta';
import { isMockMode } from '@/lib/config';

/** Picker for "Edit existing image": choose an image output of this task. */
export function EditImagePicker({ open, onClose, outputs, onPick, selectedId }) {
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Edit an existing image" description="Pick an image from this task. Your prompt will be applied as an edit, saved as a new draft version of that image.">
      {!outputs?.length ? (
        <EmptyState compact icon={ImagePlus} title="No images in this task yet" description="Generate an image first, then you can edit it here." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {outputs.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(o.id);
                  onClose();
                }}
                className={cn('card block w-full overflow-hidden text-left transition-all hover:border-line-strong hover:shadow-pop focus-ring', selectedId === o.id && 'border-brand ring-2 ring-brand/20')}
              >
                <VersionThumb version={o.currentVersion} fit="contain" className="aspect-square w-full border-b border-line" />
                <span className="block px-2.5 py-2">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{o.title}</span>
                  <span className="block text-[11px] text-muted">
                    v{o.currentVersion?.versionNumber} · {o.currentVersion?.image?.requestedWidth}×{o.currentVersion?.image?.requestedHeight} · {timeAgo(o.updatedAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * Image tool controls: preset, custom width/height, aspect ratio, number of
 * images, reference images and "edit existing image".
 */
export function ImageControls({ value, onChange, presets = [], presetsLoading, imageOutputs = [], client, references, onAddReferences, accept }) {
  const [picker, setPicker] = useState(false);
  const customPreset = presets.find((p) => p.isCustom);
  const selectedPreset = presets.find((p) => p.id === value.presetId);
  const editing = imageOutputs.find((o) => o.id === value.editOutputId);
  const dimError = dimensionError(value.width, value.height);
  const matchesPreset = selectedPreset && !selectedPreset.isCustom && Number(value.width) === selectedPreset.width && Number(value.height) === selectedPreset.height;

  const presetOptions = useMemo(
    () => presets.map((p) => ({ value: p.id, label: p.isCustom ? 'Custom dimensions' : `${p.name} · ${p.width}×${p.height}${p.scope === 'client' ? ' (client)' : ''}` })),
    [presets],
  );

  const pickPreset = (id) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return onChange({ presetId: '' });
    onChange({ presetId: p.id, width: p.width, height: p.height });
  };

  const setDim = (key, raw) => {
    const n = raw === '' ? '' : Math.round(Number(raw));
    onChange({ [key]: n, presetId: customPreset?.id || '' });
  };

  const fileInputId = 'ws-ref-images';

  return (
    <div className="space-y-3.5">
      {editing && (
        <div className="flex items-center gap-2.5 rounded-lg border border-brand/30 bg-brand-soft/60 p-2">
          <VersionThumb version={editing.currentVersion} fit="contain" className="h-12 w-12 shrink-0 rounded-md border border-line" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-brand">Editing existing image</p>
            <p className="truncate text-[11.5px] text-muted">
              {editing.title} · v{editing.currentVersion?.versionNumber} → your prompt creates v{(editing.versionCount || editing.currentVersion?.versionNumber || 1) + 1} (draft)
            </p>
          </div>
          <Button size="icon-xs" variant="ghost" icon={X} onClick={() => onChange({ editOutputId: null })} aria-label="Stop editing this image" />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Field label="Preset" hint={presetsLoading ? 'Loading presets…' : selectedPreset?.isCustom ? 'Set any width and height below.' : selectedPreset?.description}>
          <Select size="sm" value={value.presetId || ''} onChange={(e) => pickPreset(e.target.value)} options={presetOptions} placeholder="Custom dimensions" />
        </Field>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
          <Field label="Width">
            <Input type="number" min={MIN_DIM} max={MAX_DIM} step={1} inputMode="numeric" value={value.width} onChange={(e) => setDim('width', e.target.value)} invalid={!!dimError} size="sm" />
          </Field>
          <span className="pb-2 text-muted" aria-hidden>
            ×
          </span>
          <Field label="Height">
            <Input type="number" min={MIN_DIM} max={MAX_DIM} step={1} inputMode="numeric" value={value.height} onChange={(e) => setDim('height', e.target.value)} invalid={!!dimError} size="sm" />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone="brand">Requested {value.width || '—'} × {value.height || '—'}px</Badge>
        <Badge>Aspect {aspectRatio(value.width, value.height)}</Badge>
        {!matchesPreset && <Badge tone="warning">Custom size</Badge>}
        {dimError && (
          <span className="text-xs font-medium text-danger" role="alert">
            {dimError}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink">Number of images</p>
          <Segmented
            ariaLabel="Number of images"
            size="sm"
            value={String(editing ? 1 : value.count)}
            onChange={(c) => !editing && onChange({ count: Number(c) })}
            options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
          />
          {editing && <p className="mt-1 text-[11px] text-muted">Edits produce one new version.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            id={fileInputId}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => {
              onAddReferences(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <Button size="sm" icon={ImagePlus} onClick={() => document.getElementById(fileInputId)?.click()}>
            Reference images
          </Button>
          <Button size="sm" icon={Wand} variant={editing ? 'soft' : 'secondary'} onClick={() => setPicker(true)}>
            {editing ? 'Change image' : 'Edit existing image'}
          </Button>
        </div>
      </div>

      {references?.length > 0 && <p className="text-[11.5px] text-muted">{references.length} reference image{references.length > 1 ? 's' : ''} attached — shown above the prompt.</p>}

      <BrandContextPanel client={client} compact />
      {isMockMode ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-4 text-muted">
          <FlaskConical size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          No image model is connected in demo mode — results are brand-coloured placeholder renders. Downloads are PNGs at exactly the requested pixels; a real backend will resize/crop model output to match.
        </p>
      ) : (
        <p className="text-[11.5px] leading-4 text-muted">Images are generated with OpenAI and resized/cropped on the server to exactly the requested pixels.</p>
      )}

      <EditImagePicker open={picker} onClose={() => setPicker(false)} outputs={imageOutputs} selectedId={value.editOutputId} onPick={(id) => onChange({ editOutputId: id })} />
    </div>
  );
}
