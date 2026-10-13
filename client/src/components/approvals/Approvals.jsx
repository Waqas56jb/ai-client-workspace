import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Download, Eye, GitBranch, GitCompare, History, RotateCcw, ShieldCheck } from 'lucide-react';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Select, SkeletonRows, Textarea, Tooltip } from '@/components/ui';
import { VersionThumb } from '@/components/data-display/Entities';
import { ImagePreviewDialog } from './ImagePreview';
import { useOutput, useServiceMutation } from '@/hooks';
import { approvalService, versionService, versionText } from '@/services';
import { downloadVersion, versionImageSrc } from '@/lib/media';
import { diffWords } from '@/lib/diff';
import { cn, copyToClipboard, formatDateTime, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

/** Approve-a-version flow with confirmation. Renders its own trigger button. */
export function ApproveButton({ output, version, size = 'sm', variant = 'success', label = 'Mark approved', onApproved, className }) {
  const [open, setOpen] = useState(false);
  const v = version || output?.currentVersion;
  const isApproved = output?.approvedVersionId === v?.id;
  const mutation = useServiceMutation(() => approvalService.approve(output.id, v.id), {
    success: `Approved v${v?.versionNumber} of “${output?.title}”`,
    onSuccess: (data) => {
      setOpen(false);
      onApproved?.(data);
    },
  });
  if (!output || !v) return null;
  if (isApproved) {
    return (
      <Badge tone="success" icon={ShieldCheck} className={className}>
        Approved v{v.versionNumber}
      </Badge>
    );
  }
  return (
    <>
      <Button size={size} variant={variant} icon={CheckCircle2} onClick={() => setOpen(true)} className={className}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => mutation.mutate()}
        loading={mutation.isPending}
        tone="success"
        icon={CheckCircle2}
        title={`Approve version ${v.versionNumber}?`}
        description={
          output.approvedVersionId
            ? `v${output.approvedVersion?.versionNumber ?? ''} is currently approved. Approving v${v.versionNumber} makes it the approved version shown in Approved Work. The previous version stays in the revision history.`
            : `v${v.versionNumber} will appear in Approved Work for everyone in the workspace. Future edits will create new draft versions.`
        }
        confirmLabel="Approve version"
      />
    </>
  );
}

/**
 * Create a revision with an optional note and edited content.
 * For text outputs, pass `initialContent` (string) or `initialSections`.
 */
export function RevisionDialog({ open, onClose, output, sourceVersion, initialContent, initialSections, onCreated }) {
  const [note, setNote] = useState('');
  const [content, setContent] = useState('');
  const [sections, setSections] = useState(null);
  useEffect(() => {
    if (open) {
      setNote('');
      setContent(initialContent ?? sourceVersion?.content ?? '');
      setSections(initialSections ?? sourceVersion?.sections ?? null);
    }
  }, [open, initialContent, initialSections, sourceVersion]);

  const mutation = useServiceMutation(
    () =>
      versionService.createRevision(output.id, {
        sourceVersionId: sourceVersion?.id,
        note,
        ...(output.kind === 'text' ? (sections ? { sections } : { content }) : {}),
      }),
    {
      success: (data) => `Saved v${data.currentVersion.versionNumber} as a draft${output.approvedVersionId ? ' — approved version preserved' : ''}`,
      onSuccess: (data) => {
        onClose();
        onCreated?.(data);
      },
    },
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Save as new revision"
      description={output?.approvedVersionId ? 'This output has an approved version. Your changes will be saved as a new draft — the approved version will not be changed.' : 'Your changes will be saved as a new draft version.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={GitBranch} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Save revision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {output?.kind === 'text' &&
          (sections ? (
            sections.map((s, i) => (
              <Field key={s.id} label={s.label}>
                <Textarea rows={2} value={s.text} onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </Field>
            ))
          ) : (
            <Field label="Content">
              <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} />
            </Field>
          ))}
        <Field label="Revision note" hint="Briefly describe what changed — shown in the version timeline.">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Updated sponsor wording per committee feedback" />
        </Field>
      </div>
    </Dialog>
  );
}

function VersionBody({ output, version }) {
  if (!version) return null;
  if (output.kind === 'image') {
    const img = version.image;
    return (
      <div className="space-y-2">
        <VersionThumb version={version} fit="contain" className="aspect-[4/3] w-full rounded-lg border border-line" />
        <p className="text-xs text-muted">
          Requested {img.requestedWidth} × {img.requestedHeight}px · {img.prompt}
        </p>
      </div>
    );
  }
  if (version.sections) {
    return (
      <div className="space-y-3">
        {version.sections.map((s) => (
          <div key={s.id}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.label}</p>
            <p className="prose-output mt-0.5">{s.text}</p>
          </div>
        ))}
      </div>
    );
  }
  return <p className="prose-output">{version.content}</p>;
}

/** Side-by-side or inline diff comparison of two versions. */
export function CompareVersions({ output, versions, initialA, initialB }) {
  const [a, setA] = useState(initialA || versions[Math.max(0, versions.length - 2)]?.id);
  const [b, setB] = useState(initialB || versions[versions.length - 1]?.id);
  const va = versions.find((v) => v.id === a);
  const vb = versions.find((v) => v.id === b);
  const diff = useMemo(() => (output.kind === 'text' && va && vb ? diffWords(versionText(va), versionText(vb)) : null), [output.kind, va, vb]);
  const opts = versions.map((v) => ({ value: v.id, label: `v${v.versionNumber}${v.status === 'approved' ? ' · approved' : ''}${output.approvedVersionId === v.id ? ' (current approved)' : ''}` }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Compare">
          <Select value={a} onChange={(e) => setA(e.target.value)} options={opts} />
        </Field>
        <Field label="With">
          <Select value={b} onChange={(e) => setB(e.target.value)} options={opts} />
        </Field>
      </div>
      {output.kind === 'image' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[va, vb].map((v, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <p className="mb-2 text-xs font-semibold text-ink">v{v?.versionNumber}</p>
              <VersionBody output={output} version={v} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-canvas/50 p-4">
          <p className="mb-2 flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-danger-soft ring-1 ring-danger/30" /> Removed in v{vb?.versionNumber}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-success-soft ring-1 ring-success/30" /> Added in v{vb?.versionNumber}
            </span>
          </p>
          <p className="prose-output">
            {diff?.map((d, i) =>
              d.type === 'same' ? (
                <span key={i}>{d.text}</span>
              ) : d.type === 'added' ? (
                <ins key={i} className="rounded bg-success-soft px-0.5 text-success no-underline">
                  {d.text}
                </ins>
              ) : (
                <del key={i} className="rounded bg-danger-soft px-0.5 text-danger">
                  {d.text}
                </del>
              ),
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Vertical version timeline with actions per version.
 * @param {{ output, versions, selectedId?, onSelect?, compact? }} props
 */
export function VersionTimeline({ output, versions, selectedId, onSelect, compact }) {
  const sorted = [...(versions || [])].sort((x, y) => y.versionNumber - x.versionNumber);
  return (
    <ol className="space-y-1">
      {sorted.map((v) => {
        const isCurrent = output.currentVersionId === v.id;
        const isApproved = output.approvedVersionId === v.id;
        const wasApproved = v.status === 'approved' && !isApproved;
        const selected = selectedId === v.id;
        return (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelect?.(v)}
              className={cn(
                'flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-ring',
                selected ? 'border-brand/40 bg-brand-soft/60' : 'border-transparent hover:bg-canvas',
              )}
              aria-current={selected || undefined}
            >
              <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold', isApproved ? 'bg-success text-white' : isCurrent ? 'bg-brand text-white' : 'bg-[#EEF0F6] text-muted')}>
                v{v.versionNumber}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-ink">{v.note}</span>
                  {isApproved && <Badge tone="success">Approved</Badge>}
                  {wasApproved && <Badge>Previously approved</Badge>}
                  {isCurrent && !isApproved && <Badge tone="warning">Current draft</Badge>}
                </span>
                {!compact && (
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <Avatar user={v.createdByUser} size="xs" />
                    {v.createdByUser?.name || 'Unknown'} · <time title={formatDateTime(v.createdAt)}>{timeAgo(v.createdAt)}</time>
                  </span>
                )}
                {v.approvedAt && !compact && (
                  <span className="mt-0.5 block text-xs text-success">
                    Approved by {v.approvedByUser?.name || 'team member'} · {formatDateTime(v.approvedAt)}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Full revision history for an output: timeline, version viewer, compare,
 * download, copy, restore and approve. Used by Files, Approved Work and the
 * AI workspace.
 */
export function OutputHistoryDialog({ open, onClose, outputId, initialVersionId, initialMode = 'view' }) {
  const { data: output, isLoading, error, refetch } = useOutput(open ? outputId : null);
  const [selectedId, setSelectedId] = useState(initialVersionId);
  const [mode, setMode] = useState(initialMode);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedId(initialVersionId);
      setMode(initialMode);
    }
  }, [open, initialVersionId, initialMode]);

  const versions = output?.versions || [];
  const selected = versions.find((v) => v.id === selectedId) || versions.find((v) => v.id === output?.currentVersionId);
  const restore = useServiceMutation(() => versionService.restoreAsDraft(output.id, selected.id), {
    success: (d) => `Restored as new draft v${d.currentVersion.versionNumber}`,
    onSuccess: (d) => setSelectedId(d.currentVersionId),
  });

  const download = async () => {
    try {
      const dims = await downloadVersion(output, selected);
      toast.success(dims ? `Downloaded PNG at ${dims.width} × ${dims.height}px` : 'Download started');
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} size="xl" title={output ? `Revision history — ${output.title}` : 'Revision history'} description={output ? `${output.client?.name} / ${output.job?.title} / ${output.task?.title}` : undefined} bodyClassName="p-0">
        {isLoading ? (
          <SkeletonRows rows={4} className="p-5" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !versions.length ? (
          <EmptyState icon={History} title="No versions" />
        ) : (
          <div className="grid min-h-[420px] md:grid-cols-[300px_1fr]">
            <div className="border-b border-line p-3 md:border-b-0 md:border-r">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{versions.length} versions</p>
              <VersionTimeline output={output} versions={versions} selectedId={selected?.id} onSelect={(v) => { setSelectedId(v.id); setMode('view'); }} />
            </div>
            <div className="min-w-0 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 rounded-lg border border-line bg-canvas p-0.5">
                  <Button size="xs" variant={mode === 'view' ? 'secondary' : 'ghost'} icon={Eye} onClick={() => setMode('view')}>
                    View
                  </Button>
                  <Button size="xs" variant={mode === 'compare' ? 'secondary' : 'ghost'} icon={GitCompare} onClick={() => setMode('compare')} disabled={versions.length < 2}>
                    Compare
                  </Button>
                </div>
                {mode === 'view' && selected && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {output.kind === 'text' ? (
                      <Tooltip content="Copy text">
                        <Button size="icon-sm" icon={Copy} aria-label="Copy text" onClick={async () => (await copyToClipboard(versionText(selected))) && toast.success('Copied to clipboard')} />
                      </Tooltip>
                    ) : (
                      <Button size="sm" icon={Eye} onClick={() => setPreview(true)}>
                        Preview
                      </Button>
                    )}
                    <Button size="sm" icon={Download} onClick={download}>
                      Download v{selected.versionNumber}
                    </Button>
                    {selected.id !== output.currentVersionId && (
                      <Button size="sm" icon={RotateCcw} loading={restore.isPending} onClick={() => restore.mutate()}>
                        Restore as draft
                      </Button>
                    )}
                    <ApproveButton output={output} version={selected} label={`Approve v${selected.versionNumber}`} />
                  </div>
                )}
              </div>
              {mode === 'view' ? (
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-semibold text-ink">Version {selected?.versionNumber}</span>
                    <span>· {formatDateTime(selected?.createdAt)}</span>
                    <span>· {selected?.createdByUser?.name}</span>
                    {selected?.sourceVersionId && <span>· based on v{versions.find((v) => v.id === selected.sourceVersionId)?.versionNumber}</span>}
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-line p-4 scrollbar-thin">
                    <VersionBody output={output} version={selected} />
                  </div>
                </div>
              ) : (
                <CompareVersions output={output} versions={versions} initialB={selected?.id} />
              )}
            </div>
          </div>
        )}
      </Dialog>
      {output?.kind === 'image' && selected && (
        <ImagePreviewDialog
          open={preview}
          onClose={() => setPreview(false)}
          src={versionImageSrc(selected)}
          title={`${output.title} · v${selected.versionNumber}`}
          requested={{ width: selected.image.requestedWidth, height: selected.image.requestedHeight }}
          onDownload={download}
          footerNote={isMockMode ? 'Demo render — PNG downloads are rasterised to the exact requested size.' : 'Generated with OpenAI — downloads use the stored file at its verified size.'}
        />
      )}
    </>
  );
}
