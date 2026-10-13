import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Eye, History, Layers, RotateCcw } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, MetaRow, SkeletonRows } from '@/components/ui';
import { ApproveButton, OutputHistoryDialog, VersionTimeline } from '@/components/approvals';
import { VersionThumb } from '@/components/data-display/Entities';
import { useOutput, useServiceMutation } from '@/hooks';
import { versionService, versionText } from '@/services';
import { TOOL_BY_ID, WRITING_FORMATS } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import { OutputStatusBadges, PreservedNotice } from './OutputStatus';
import { DimensionsBlock } from './ImageMeta';
import { MissingInfoCallout } from './TextOutputPanel';
import { OPTION_LABELS } from './toolMeta';
import { ToolIcon } from './ToolSelector';

function Section({ title, children, action }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function formatOption(key, v, presetsById) {
  if (Array.isArray(v)) return v.join(', ');
  if (key === 'format') return WRITING_FORMATS.find((f) => f.id === v)?.label || v;
  if (key === 'presetId') return presetsById?.[v]?.name || v;
  return String(v);
}

/** Generation settings recorded with the request that produced the output. */
function SettingsList({ output, version, sourceOptions, presetsById }) {
  const rows = [];
  if (output.kind === 'image' && version?.image) {
    const p = presetsById?.[version.image.presetId];
    rows.push(['Preset', p ? p.name : 'Custom dimensions']);
  }
  if (output.format) rows.push(['Format', formatOption('format', output.format)]);
  Object.entries(sourceOptions || {}).forEach(([k, v]) => {
    if (['format', 'presetId', 'width', 'height', 'editOutputId'].includes(k)) return;
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
    rows.push([OPTION_LABELS[k] || k, formatOption(k, v, presetsById)]);
  });
  if (!rows.length) return <p className="text-xs text-muted">Client defaults were used — no extra options.</p>;
  return (
    <dl className="divide-y divide-line">
      {rows.slice(0, 14).map(([label, v]) => (
        <MetaRow key={label} label={label}>
          <span className="line-clamp-2 break-words">{v}</span>
        </MetaRow>
      ))}
    </dl>
  );
}

/**
 * Right-panel inspector for the selected output: status, the previewed version,
 * dimensions, settings, version history and metadata.
 */
export function OutputInspector({ outputId, sourceOptions, presetsById }) {
  const { data: output, isLoading, error, refetch } = useOutput(outputId);
  const [versionId, setVersionId] = useState(null);
  const [history, setHistory] = useState(false);

  useEffect(() => setVersionId(null), [outputId, output?.currentVersionId]);

  const versions = output?.versions || [];
  const version = versions.find((v) => v.id === versionId) || output?.currentVersion;
  const isCurrent = version?.id === output?.currentVersionId;
  const restore = useServiceMutation(() => versionService.restoreAsDraft(output.id, version.id), {
    success: (d) => `Restored v${version?.versionNumber} as new draft v${d.currentVersion.versionNumber}`,
  });
  const excerpt = useMemo(() => versionText(version), [version]);

  if (!outputId) {
    return <EmptyState compact icon={Layers} title="No output selected" description="Select a result in the conversation to see its status, settings, version history and metadata." />;
  }
  if (isLoading) return <SkeletonRows rows={5} className="p-1" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!output) return null;

  const tool = TOOL_BY_ID[output.tool];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5">
        <ToolIcon tool={output.tool} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug text-ink">{output.title}</p>
          <p className="text-xs text-muted">{tool?.name}</p>
          <OutputStatusBadges output={output} className="mt-1.5" />
        </div>
      </div>

      <PreservedNotice output={output} />

      <Section
        title={isCurrent ? `Current version · v${version?.versionNumber}` : `Previewing v${version?.versionNumber}`}
        action={!isCurrent && <Badge tone="info" icon={Eye}>Not current</Badge>}
      >
        {output.kind === 'image' ? (
          <VersionThumb version={version} fit="contain" className="aspect-[4/3] w-full rounded-lg border border-line" />
        ) : (
          <p className="line-clamp-[10] whitespace-pre-wrap rounded-lg border border-line bg-canvas/50 px-3 py-2 text-[12.5px] leading-5 text-ink">{excerpt}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!isCurrent && (
            <Button size="xs" icon={RotateCcw} loading={restore.isPending} onClick={() => restore.mutate()}>
              Restore as draft
            </Button>
          )}
          <ApproveButton output={output} version={version} size="xs" label={`Approve v${version?.versionNumber}`} />
          {!isCurrent && (
            <Button size="xs" variant="ghost" onClick={() => setVersionId(null)}>
              Back to current
            </Button>
          )}
        </div>
        {version?.note && <p className="mt-2 text-[11.5px] text-muted">Note: {version.note}</p>}
        {output.kind !== 'image' && version?.missing?.length > 0 && (
          <div className="mt-2">
            <MissingInfoCallout missing={version.missing} />
          </div>
        )}
      </Section>

      {output.kind === 'image' && (
        <Section title="Image dimensions">
          <DimensionsBlock version={version} />
        </Section>
      )}

      <Section title="Output settings">
        <SettingsList output={output} version={version} sourceOptions={sourceOptions} presetsById={presetsById} />
      </Section>

      <Section
        title={`Version history (${versions.length})`}
        action={
          <Button size="xs" variant="ghost" icon={History} onClick={() => setHistory(true)}>
            Compare
          </Button>
        }
      >
        <VersionTimeline output={output} versions={versions} selectedId={version?.id} onSelect={(v) => setVersionId(v.id)} compact />
      </Section>

      <Section title="Metadata">
        <dl className="divide-y divide-line">
          <MetaRow label="Status">{output.status === 'approved' ? (output.pendingRevision ? 'Approved · draft pending' : 'Approved') : 'Draft'}</MetaRow>
          <MetaRow label="Created by">{output.createdByUser?.name || '—'}</MetaRow>
          <MetaRow label="Created">{formatDateTime(output.createdAt)}</MetaRow>
          <MetaRow label="Last revised">{formatDateTime(output.updatedAt)}</MetaRow>
          <MetaRow label="Version by">{version?.createdByUser?.name || '—'}</MetaRow>
          {output.approvedVersion && (
            <MetaRow label="Approved">
              v{output.approvedVersion.versionNumber} · {output.approvedVersion.approvedByUser?.name || 'team'}
            </MetaRow>
          )}
          <MetaRow label="Kind">{output.kind === 'image' ? 'Image (PNG on export)' : 'Text'}</MetaRow>
        </dl>
        {output.fileId && (
          <Link to={`/files/${output.fileId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline focus-ring rounded">
            Open in file library <ArrowUpRight size={12} aria-hidden />
          </Link>
        )}
      </Section>

      <OutputHistoryDialog open={history} onClose={() => setHistory(false)} outputId={output.id} initialVersionId={version?.id} initialMode="compare" />
    </div>
  );
}
