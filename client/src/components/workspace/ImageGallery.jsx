import { useMemo, useState } from 'react';
import { Download, Eye, GitBranch, GitCompare, Info, PanelRight, RefreshCw, Wand } from 'lucide-react';
import { Badge, Button, Menu, Tooltip } from '@/components/ui';
import { ApproveButton, ImagePreviewDialog, OutputHistoryDialog, RevisionDialog } from '@/components/approvals';
import { versionImageSrc } from '@/lib/media';
import { aspectRatio, cn } from '@/lib/utils';
import { OutputStatusBadges, PreservedNotice } from './OutputStatus';
import { ImageMetadataDialog } from './ImageMeta';
import { useOutputActions } from './useOutputActions';
import { isMockMode } from '@/lib/config';

function ImageTile({ output, selected, onSelect, onShowDetails, onEditImage, presetsById, single }) {
  const v = output.currentVersion;
  const img = v?.image;
  const src = useMemo(() => versionImageSrc(v), [v]);
  const [preview, setPreview] = useState(false);
  const [meta, setMeta] = useState(false);
  const [revision, setRevision] = useState(false);
  const [history, setHistory] = useState(null);
  const { regenerate, download } = useOutputActions(output, { onRegenerated: () => onSelect?.(output.id) });
  const ratio = img ? `${img.requestedWidth} / ${img.requestedHeight}` : '1 / 1';

  return (
    <article className={cn('card group overflow-hidden transition-shadow', selected ? 'border-brand/45 ring-2 ring-brand/15' : 'hover:border-line-strong')} aria-label={`Image: ${output.title}`}>
      <div className="relative">
        <button type="button" onClick={() => { onSelect?.(output.id); setPreview(true); }} className="checkerboard block w-full focus-ring" aria-label={`Preview ${output.title}`}>
          <div className={cn('mx-auto flex items-center justify-center', single ? 'max-h-[420px]' : 'max-h-[300px]')} style={{ aspectRatio: ratio }}>
            {src ? <img src={src} alt={output.title} className={cn('h-full w-full object-contain transition-opacity', regenerate.isPending && 'opacity-40')} /> : null}
          </div>
        </button>
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          <span className="rounded-md bg-[#17182B]/75 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white backdrop-blur">
            {img?.requestedWidth} × {img?.requestedHeight}
          </span>
          {isMockMode && <span className="rounded-md bg-[#17182B]/75 px-1.5 py-0.5 text-[10.5px] font-medium text-white backdrop-blur">Demo render</span>}
        </div>
        {regenerate.isPending && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink shadow-pop">Regenerating…</span>
          </div>
        )}
      </div>
      <div className="space-y-2 px-3 py-2.5" onClick={() => onSelect?.(output.id)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{output.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <OutputStatusBadges output={output} />
              <Badge>{aspectRatio(img?.requestedWidth, img?.requestedHeight)}</Badge>
              {img?.presetId && presetsById?.[img.presetId] && <span className="truncate text-[11px] text-muted">{presetsById[img.presetId].name}</span>}
            </div>
          </div>
          <Menu
            label="More image actions"
            width={220}
            items={[
              { label: 'View metadata', icon: Info, onSelect: () => setMeta(true) },
              { label: 'Create revision', icon: GitBranch, onSelect: () => setRevision(true) },
              { label: 'Compare versions', icon: GitCompare, onSelect: () => setHistory('compare'), disabled: (output.versionCount || 1) < 2 },
              onEditImage && { label: 'Edit this image with AI', icon: Wand, onSelect: () => onEditImage(output.id) },
              onShowDetails && { label: 'Show details panel', icon: PanelRight, onSelect: () => onShowDetails(output.id) },
            ].filter(Boolean)}
          />
        </div>
        <PreservedNotice output={output} />
        <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip content="Preview with zoom">
            <Button size="icon-sm" icon={Eye} onClick={() => setPreview(true)} aria-label="Preview" />
          </Tooltip>
          <Tooltip content={`Download PNG ${img?.requestedWidth}×${img?.requestedHeight}`}>
            <Button size="icon-sm" icon={Download} onClick={() => download()} aria-label="Download PNG" />
          </Tooltip>
          <Tooltip content="Regenerate as new version">
            <Button size="icon-sm" icon={RefreshCw} loading={regenerate.isPending} onClick={() => regenerate.mutate()} aria-label="Regenerate" />
          </Tooltip>
          <Tooltip content="Version history / compare">
            <Button size="icon-sm" icon={GitCompare} onClick={() => setHistory('view')} aria-label="Version history" />
          </Tooltip>
          <span className="flex-1" />
          <ApproveButton output={output} size="sm" label="Approve" />
        </div>
      </div>

      <ImagePreviewDialog
        open={preview}
        onClose={() => setPreview(false)}
        src={src}
        title={`${output.title} · v${v?.versionNumber}`}
        subtitle={isMockMode ? 'Demo render — no image model is connected. PNG download is rasterised to the exact requested size.' : 'Generated with OpenAI — downloads use the stored file at its verified size.'}
        requested={img ? { width: img.requestedWidth, height: img.requestedHeight } : undefined}
        onDownload={() => download()}
        footerNote="Preview is scaled to fit"
      />
      <ImageMetadataDialog open={meta} onClose={() => setMeta(false)} output={output} version={v} preset={presetsById?.[img?.presetId]} />
      <RevisionDialog open={revision} onClose={() => setRevision(false)} output={output} sourceVersion={v} onCreated={() => onSelect?.(output.id)} />
      <OutputHistoryDialog open={!!history} onClose={() => setHistory(null)} outputId={output.id} initialVersionId={v?.id} initialMode={history === 'compare' ? 'compare' : 'view'} />
    </article>
  );
}

/** Polished gallery of generated image outputs. */
export function ImageGallery({ outputs, selectedOutputId, onSelect, onShowDetails, onEditImage, presetsById }) {
  const single = outputs.length === 1;
  return (
    <div className={cn('grid gap-3', single ? 'max-w-xl grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
      {outputs.map((o) => (
        <ImageTile key={o.id} output={o} single={single} selected={selectedOutputId === o.id} onSelect={onSelect} onShowDetails={onShowDetails} onEditImage={onEditImage} presetsById={presetsById} />
      ))}
    </div>
  );
}
