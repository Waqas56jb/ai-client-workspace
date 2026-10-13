import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Download, ExternalLink, GitBranch, History, Info, MessageSquare, Pencil, Ruler, Sparkles, Trash2 } from 'lucide-react';
import { ApprovalBadge, Avatar, Button, Card, CardHeader, ConfirmDialog, ErrorState, MetaRow, Page, PageHeader, Skeleton, Tooltip } from '@/components/ui';
import { ContextPath } from '@/components/data-display/Entities';
import { ApproveButton, OutputHistoryDialog, VersionTimeline } from '@/components/approvals';
import { DemoNote, FilePreview, fileTypeLabel, downloadBlockedReason, STORAGE_INFO, StorageBadge } from '@/components/files';
import { useBreadcrumbs, useFile, useFileSource, usePageTitle, useServiceMutation } from '@/hooks';
import { fileService } from '@/services';
import { canDownload, downloadFileRecord } from '@/lib/media';
import { aspectRatio, formatBytes, formatDateTime, timeAgo } from '@/lib/utils';
import { RenameFileDialog } from './components/RenameFileDialog';
import { isMockMode } from '@/lib/config';

function DetailSkeleton() {
  return (
    <Page wide>
      <Skeleton className="mb-2 h-3.5 w-48" />
      <Skeleton className="mb-6 h-7 w-80" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[420px] w-full rounded-xl" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    </Page>
  );
}

export default function FileDetailPage() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { data: file, isLoading, error, refetch } = useFile(fileId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [history, setHistory] = useState({ open: false, versionId: null });
  const [verified, setVerified] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const source = useFileSource(file?.storage === 'browser' ? file : null);

  useBreadcrumbs([{ label: 'Files', to: '/files' }, { label: file?.name || (error ? 'Not found' : 'File') }]);
  usePageTitle(file?.name || 'File');

  const remove = useServiceMutation(() => fileService.remove(file.id), {
    success: () => `Removed “${file.name}”`,
    onSuccess: () => navigate('/files', { replace: true }),
  });

  if (isLoading) return <DetailSkeleton />;
  if (error || !file) {
    return (
      <Page>
        <div className="card">
          <ErrorState error={error} onRetry={refetch} />
          <div className="-mt-6 flex justify-center pb-10">
            <Button as={Link} to="/files" icon={ArrowLeft}>
              Back to files
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  const output = file.output;
  const isOutput = file.category === 'output' && !!output;
  const img = output?.kind === 'image' ? output.currentVersion?.image : null;
  const blockedReason = downloadBlockedReason(file) || (!canDownload(file) ? 'No file content is available for this record.' : null) || (file.storage === 'browser' && source.unavailable ? source.unavailable : null);

  const download = async () => {
    setDownloading(true);
    try {
      const dims = await downloadFileRecord(file);
      if (dims) {
        setVerified(dims);
        toast.success(`Downloaded PNG at ${dims.width} × ${dims.height}px`);
      } else toast.success(`Downloading “${file.name}”`);
    } catch (e) {
      toast.error(e.message || 'The download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const downloadButton = (
    <Button icon={Download} onClick={download} loading={downloading} disabled={!!blockedReason}>
      {img ? 'Download PNG' : 'Download'}
    </Button>
  );

  return (
    <Page wide>
      <PageHeader
        eyebrow={
          <Link to="/files" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-brand focus-ring rounded">
            <ArrowLeft size={13} aria-hidden /> Files
          </Link>
        }
        title={
          <span className="inline-flex max-w-full items-center gap-2">
            <span className="truncate">{file.name}</span>
            <Tooltip content="Rename">
              <Button variant="ghost" size="icon-xs" icon={Pencil} onClick={() => setRenameOpen(true)} aria-label="Rename file" />
            </Tooltip>
          </span>
        }
        actions={
          <>
            {blockedReason ? (
              <Tooltip content={<span className="block max-w-[260px] whitespace-normal">{blockedReason}</span>} side="bottom">
                <span tabIndex={0} className="rounded-lg focus-ring">
                  {downloadButton}
                </span>
              </Tooltip>
            ) : (
              downloadButton
            )}
            {isOutput && (
              <Button icon={History} onClick={() => setHistory({ open: true, versionId: output.currentVersionId })}>
                Full history
              </Button>
            )}
            {isOutput && <ApproveButton output={output} size="md" label={`Approve v${output.currentVersion?.versionNumber}`} />}
            {!isOutput && (
              <Button variant="danger-ghost" icon={Trash2} onClick={() => setRemoveOpen(true)}>
                Remove
              </Button>
            )}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ApprovalBadge status={file.status || 'reference'} pending={file.pendingRevision} />
          <StorageBadge storage={file.storage} />
          <ContextPath client={file.client} job={file.job} task={file.task} />
        </div>
      </PageHeader>

      {file.pendingRevision && output?.approvedVersion && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          <GitBranch size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <p>
            A newer draft (v{output.currentVersion?.versionNumber}) exists. Approved v{output.approvedVersion.versionNumber} remains the current approved version until the draft is approved.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <FilePreview file={file} onDownload={blockedReason ? undefined : download} />
          </Card>
          {file.description && (
            <Card className="px-5 py-4">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Description</p>
              <p className="text-[14px] leading-6 text-ink">{file.description}</p>
            </Card>
          )}
          {img && (
            <Card>
              <CardHeader icon={Ruler} title="Image dimensions" description="What was requested versus what the exported PNG measured." />
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                <div className="rounded-lg border border-line bg-canvas/50 px-4 py-3">
                  <p className="text-xs text-muted">Requested</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">
                    {img.requestedWidth} × {img.requestedHeight}px
                  </p>
                  <p className="text-xs text-muted">Aspect ratio {aspectRatio(img.requestedWidth, img.requestedHeight)}</p>
                </div>
                <div className={verified ? 'rounded-lg border border-success/30 bg-success-soft/50 px-4 py-3' : 'rounded-lg border border-dashed border-line-strong px-4 py-3'}>
                  <p className="text-xs text-muted">Downloaded PNG</p>
                  {verified ? (
                    <>
                      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">
                        {verified.width} × {verified.height}px
                      </p>
                      <p className="text-xs text-success">
                        Verified after export{verified.width === img.requestedWidth && verified.height === img.requestedHeight ? ' — matches the request' : ''}
                      </p>
                    </>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-muted">Download to verify — the PNG is rasterised to exactly the requested size.</p>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader icon={Info} title="Details" />
            <dl className="divide-y divide-line px-5 py-1">
              <MetaRow label="Type">{fileTypeLabel(file)}</MetaRow>
              <MetaRow label="Size">{formatBytes(file.size)}</MetaRow>
              <MetaRow label="Status">
                <ApprovalBadge status={file.status || 'reference'} pending={file.pendingRevision} />
              </MetaRow>
              {isOutput && (
                <MetaRow label="Versions">
                  {file.versionCount} · current v{output.currentVersion?.versionNumber}
                  {output.approvedVersion ? ` · approved v${output.approvedVersion.versionNumber}` : ''}
                </MetaRow>
              )}
              <MetaRow label="Client">{file.client ? <Link className="hover:text-brand" to={`/clients/${file.client.id}`}>{file.client.name}</Link> : '—'}</MetaRow>
              <MetaRow label="Job">{file.job ? <Link className="hover:text-brand" to={`/jobs/${file.job.id}`}>{file.job.title}</Link> : '—'}</MetaRow>
              <MetaRow label="Task">{file.task ? <Link className="hover:text-brand" to={`/tasks/${file.task.id}`}>{file.task.title}</Link> : '—'}</MetaRow>
              <MetaRow label="Created">
                <time dateTime={file.createdAt}>{formatDateTime(file.createdAt)}</time>
              </MetaRow>
              <MetaRow label={isOutput ? 'Last revision' : 'Modified'}>
                <time dateTime={file.lastRevisionAt} title={formatDateTime(file.lastRevisionAt)}>
                  {formatDateTime(file.lastRevisionAt)}
                  <span className="block text-xs font-normal text-muted">{timeAgo(file.lastRevisionAt)}</span>
                </time>
              </MetaRow>
              <MetaRow label="Responsible">
                <span className="inline-flex items-center gap-1.5">
                  <Avatar user={file.createdByUser} size="xs" />
                  {file.createdByUser?.name || 'Unknown'}
                </span>
              </MetaRow>
              <MetaRow label="Storage">
                <StorageBadge storage={file.storage} withTooltip={false} />
              </MetaRow>
            </dl>
            <div className="border-t border-line px-5 py-3">
              <DemoNote>{(STORAGE_INFO[file.storage] || STORAGE_INFO['record-only']).description}</DemoNote>
            </div>
          </Card>

          {(file.conversation || file.task) && (
            <Card>
              <CardHeader icon={Sparkles} title="Related work" />
              <div className="space-y-1 p-2">
                {file.conversation && (
                  <Link to={`/ai-workspace/${file.conversation.taskId}?conversation=${file.conversation.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-canvas focus-ring">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                      <MessageSquare size={15} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{file.conversation.title}</span>
                      <span className="block text-xs text-muted">Conversation that produced this output</span>
                    </span>
                    <ExternalLink size={14} className="text-subtle" aria-hidden />
                  </Link>
                )}
                {file.task && (
                  <Link to={`/ai-workspace/${file.task.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-canvas focus-ring">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted">
                      <Sparkles size={15} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{file.task.title}</span>
                      <span className="block text-xs text-muted">Open task in the AI workspace</span>
                    </span>
                    <ExternalLink size={14} className="text-subtle" aria-hidden />
                  </Link>
                )}
              </div>
            </Card>
          )}

          {isOutput && output.versions?.length > 0 && (
            <Card>
              <CardHeader
                icon={History}
                title="Revision history"
                description="Approved versions are never changed — revisions create new drafts."
                action={
                  <Button size="xs" variant="ghost" onClick={() => setHistory({ open: true, versionId: output.currentVersionId })}>
                    Full history
                  </Button>
                }
              />
              <div className="max-h-[360px] overflow-y-auto p-2 scrollbar-thin">
                <VersionTimeline output={output} versions={output.versions} selectedId={output.currentVersionId} onSelect={(v) => setHistory({ open: true, versionId: v.id })} />
              </div>
            </Card>
          )}
        </div>
      </div>

      <RenameFileDialog open={renameOpen} onClose={() => setRenameOpen(false)} file={file} />
      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title={`Remove “${file.name}”?`}
        description={
          file.storage === 'browser'
            ? 'The file record and the copy held in this browser will be deleted. This can’t be undone.'
            : isMockMode
              ? 'The file record will be removed from the library, its client and any conversations that reference it. This can’t be undone.'
              : 'The file will be archived and removed from the library. The stored copy is retained for audit purposes.'
        }
        confirmLabel="Remove file"
      />
      {isOutput && <OutputHistoryDialog open={history.open} onClose={() => setHistory((h) => ({ ...h, open: false }))} outputId={output.id} initialVersionId={history.versionId} />}
    </Page>
  );
}
