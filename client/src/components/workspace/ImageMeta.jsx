import { Info, Ruler } from 'lucide-react';
import { Badge, Dialog, MetaRow } from '@/components/ui';
import { aspectRatio, formatDateTime } from '@/lib/utils';
import { useVerifiedDims } from './useOutputActions';
import { isMockMode } from '@/lib/config';

/**
 * Distinguishes (1) the requested generation size from (2) the size of the
 * downloaded PNG, and explains how the demo / real pipeline handle it.
 */
export function DimensionsBlock({ version, compact }) {
  const verified = useVerifiedDims((s) => s.dims[version?.id]);
  const img = version?.image;
  if (!img) return null;
  const w = img.requestedWidth;
  const h = img.requestedHeight;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line px-2.5 py-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">1 · Requested</p>
          <p className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
            {w} × {h}
          </p>
          <p className="text-[11px] text-muted">px · {aspectRatio(w, h)}</p>
        </div>
        <div className="rounded-lg border border-line px-2.5 py-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">2 · Downloaded PNG</p>
          <p className="mt-0.5 font-mono text-[13px] font-semibold text-ink">{verified ? `${verified.width} × ${verified.height}` : `${w} × ${h}`}</p>
          <p className="text-[11px] text-muted">{verified ? (verified.width === w && verified.height === h ? 'verified on export ✓' : 'verified on export') : 'exact pixels on export'}</p>
        </div>
      </div>
      {!compact && (
        <p className="flex gap-1.5 text-[11.5px] leading-4 text-muted">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {isMockMode
              ? 'Demo previews are brand-coloured placeholder renders; PNG export is resized to the exact requested pixels. A real image API may not return arbitrary sizes natively, so the backend will post-process (resize / crop) to these dimensions. Brand fonts and on-image text are guidance only.'
              : 'The image model may not return arbitrary sizes natively, so the server resizes / crops its output to the requested dimensions and verifies the stored file. Brand fonts and on-image text are guidance only.'}
          </span>
        </p>
      )}
    </div>
  );
}

/** "View metadata" dialog for an image version. */
export function ImageMetadataDialog({ open, onClose, output, version, preset }) {
  const img = version?.image;
  return (
    <Dialog open={open} onClose={onClose} size="md" title="Image metadata" description={output ? `${output.title} · v${version?.versionNumber}` : undefined}>
      {img && (
        <div className="space-y-4">
          <DimensionsBlock version={version} />
          <dl className="divide-y divide-line">
            <MetaRow label="Requested size">
              {img.requestedWidth} × {img.requestedHeight}px
            </MetaRow>
            <MetaRow label="Aspect ratio">{aspectRatio(img.requestedWidth, img.requestedHeight)}</MetaRow>
            <MetaRow label="Preview render">
              {isMockMode ? `SVG placeholder authored at ${img.requestedWidth} × ${img.requestedHeight}, scaled to fit on screen` : `Stored image${img.actualWidth ? ` at ${img.actualWidth} × ${img.actualHeight}` : ''}, scaled to fit on screen`}
            </MetaRow>
            <MetaRow label="Preset">{preset ? `${preset.name} (${preset.width} × ${preset.height})` : img.presetId ? img.presetId : 'Custom dimensions'}</MetaRow>
            <MetaRow label="Version">
              v{version.versionNumber} <Badge tone={output.approvedVersionId === version.id ? 'success' : 'warning'}>{output.approvedVersionId === version.id ? 'Approved' : 'Draft'}</Badge>
            </MetaRow>
            <MetaRow label="Created by">{version.createdByUser?.name || output.createdByUser?.name || '—'}</MetaRow>
            <MetaRow label="Created">{formatDateTime(version.createdAt)}</MetaRow>
            {img.referenceFileIds?.length > 0 && <MetaRow label="Reference images">{img.referenceFileIds.length}</MetaRow>}
            <MetaRow label="Model">
              {isMockMode ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <Ruler size={13} aria-hidden /> None connected (demo)
                </span>
              ) : (
                <span>
                  {img.model || 'OpenAI'}
                  {img.generatedWidth ? <span className="text-muted"> · generated at {img.generatedWidth} × {img.generatedHeight}</span> : null}
                </span>
              )}
            </MetaRow>
          </dl>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Prompt</p>
            <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] leading-5 text-ink">{img.prompt || '—'}</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
