import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Download, ExternalLink, GitBranch, History, Sparkles } from 'lucide-react';
import { Avatar, Badge, Button, Card, Menu, Table, Td, Th, Tooltip } from '@/components/ui';
import { ClientLogo, ContextPath, TaskTypeBadge, VersionThumb } from '@/components/data-display/Entities';
import { versionText } from '@/services';
import { downloadVersion } from '@/lib/media';
import { cn, copyToClipboard, formatDate, formatDateTime, timeAgo } from '@/lib/utils';

/** Shared actions for an approved output. */
export function useApprovedActions(output, onHistory) {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const v = output.approvedVersion;
  return {
    downloading,
    open: () => output.fileId && navigate(`/files/${output.fileId}`),
    openTask: () => navigate(`/ai-workspace/${output.taskId}`),
    history: () => onHistory(output),
    download: async () => {
      setDownloading(true);
      try {
        const dims = await downloadVersion(output, v);
        toast.success(dims ? `Downloaded PNG at ${dims.width} × ${dims.height}px` : `Downloaded v${v.versionNumber} as text`);
      } catch (e) {
        toast.error(e.message || 'The download failed.');
      } finally {
        setDownloading(false);
      }
    },
    copy: async () => {
      if (await copyToClipboard(versionText(v))) toast.success('Approved text copied to clipboard');
      else toast.error('Could not copy to the clipboard.');
    },
  };
}

function PendingNote({ output, compact }) {
  if (!output.pendingRevision) return null;
  const n = output.currentVersion?.versionNumber;
  if (compact) {
    return (
      <Tooltip content={`A newer draft (v${n}) exists — the approved version stays current until it’s approved`}>
        <Badge tone="warning" icon={GitBranch}>
          Draft v{n}
        </Badge>
      </Tooltip>
    );
  }
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-xs leading-[18px] text-ink">
      <GitBranch size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <span>
        A newer draft (v{n}) exists — this approved version remains current until the draft is approved.
      </span>
    </p>
  );
}

/** Readable preview of an approved text version. */
function TextPreview({ version, className }) {
  if (version.sections?.length) {
    return (
      <div className={cn('space-y-2 overflow-hidden', className)}>
        {version.sections.slice(0, 3).map((s) => (
          <div key={s.id || s.label}>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{s.label}</p>
            <p className="line-clamp-2 text-[12.5px] leading-[18px] text-ink">{s.text}</p>
          </div>
        ))}
        {version.sections.length > 3 && <p className="text-[11px] text-muted">+ {version.sections.length - 3} more sections</p>}
      </div>
    );
  }
  return <p className={cn('line-clamp-[8] whitespace-pre-line text-[12.5px] leading-[19px] text-ink', className)}>{version.content}</p>;
}

function Approver({ version }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar user={version.approvedByUser} size="xs" />
      <span className="truncate">{version.approvedByUser?.name || 'Team member'}</span>
    </span>
  );
}

export function ApprovedCard({ output, onHistory }) {
  const v = output.approvedVersion;
  const a = useApprovedActions(output, onHistory);
  const isImage = output.kind === 'image';
  return (
    <Card className="flex flex-col overflow-hidden">
      <button type="button" onClick={a.open} disabled={!output.fileId} className="block w-full text-left focus-ring disabled:cursor-default" aria-label={`Open ${output.title}`}>
        {isImage ? (
          <div className="relative">
            <VersionThumb version={v} fit="contain" className="aspect-[4/3] w-full border-b border-line" />
            <span className="absolute bottom-2 right-2 rounded-md bg-ink/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {v.image?.requestedWidth} × {v.image?.requestedHeight}
            </span>
          </div>
        ) : (
          <div className="aspect-[4/3] w-full overflow-hidden border-b border-line bg-gradient-to-b from-white to-canvas p-4">
            <TextPreview version={v} />
          </div>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold text-ink" title={output.title}>
              {output.title}
            </h3>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <ClientLogo client={output.client} size="xs" />
              <ContextPath client={output.client} job={output.job} task={output.task} className="min-w-0" />
            </div>
          </div>
          <Badge tone="success" className="shrink-0">
            v{v.versionNumber}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskTypeBadge type={output.tool} />
          <Badge>{isImage ? 'Image' : 'Text'}</Badge>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <Approver version={v} />
          <time dateTime={v.approvedAt} title={formatDateTime(v.approvedAt)} className="shrink-0">
            Approved {formatDate(v.approvedAt, 'd MMM yyyy')}
          </time>
        </div>
        <PendingNote output={output} />
        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <Button size="xs" variant="soft" icon={ExternalLink} onClick={a.open} disabled={!output.fileId}>
            Open
          </Button>
          <Button size="xs" icon={Download} onClick={a.download} loading={a.downloading}>
            {isImage ? 'PNG' : 'Download'}
          </Button>
          {!isImage && (
            <Tooltip content="Copy text">
              <Button size="icon-xs" icon={Copy} onClick={a.copy} aria-label="Copy approved text" />
            </Tooltip>
          )}
          <Tooltip content="Revision history">
            <Button size="icon-xs" icon={History} onClick={a.history} aria-label="View revision history" />
          </Tooltip>
          <Tooltip content="Open task in AI workspace" className="ml-auto">
            <Button size="icon-xs" variant="ghost" icon={Sparkles} onClick={a.openTask} aria-label="Open associated task" />
          </Tooltip>
        </div>
      </div>
    </Card>
  );
}

export function ApprovedGrid({ outputs, onHistory }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {outputs.map((o) => (
        <ApprovedCard key={o.id} output={o} onHistory={onHistory} />
      ))}
    </div>
  );
}

function ApprovedRow({ output, onHistory }) {
  const v = output.approvedVersion;
  const a = useApprovedActions(output, onHistory);
  const isImage = output.kind === 'image';
  return (
    <tr className="align-top transition-colors hover:bg-canvas/60">
      <Td>
        <div className="flex min-w-0 items-start gap-3">
          {isImage ? (
            <VersionThumb version={v} className="h-12 w-12 shrink-0 rounded-lg border border-line" />
          ) : (
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line bg-canvas p-1.5">
              <p className="line-clamp-4 text-[7.5px] leading-[9px] text-muted">{versionText(v)}</p>
            </div>
          )}
          <div className="min-w-0">
            {output.fileId ? (
              <Link to={`/files/${output.fileId}`} className="block max-w-[280px] truncate font-medium text-ink hover:text-brand focus-ring rounded">
                {output.title}
              </Link>
            ) : (
              <span className="block max-w-[280px] truncate font-medium text-ink">{output.title}</span>
            )}
            {!isImage && <p className="mt-0.5 line-clamp-1 max-w-[320px] text-xs text-muted">{versionText(v)}</p>}
            {isImage && (
              <p className="mt-0.5 text-xs tabular-nums text-muted">
                {v.image?.requestedWidth} × {v.image?.requestedHeight}px
              </p>
            )}
          </div>
        </div>
      </Td>
      <Td>
        <ContextPath client={output.client} job={output.job} task={output.task} className="max-w-[280px]" />
      </Td>
      <Td>
        <TaskTypeBadge type={output.tool} />
      </Td>
      <Td>
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone="success">v{v.versionNumber}</Badge>
          <PendingNote output={output} compact />
        </span>
      </Td>
      <Td className="whitespace-nowrap text-muted">
        <time dateTime={v.approvedAt} title={formatDateTime(v.approvedAt)}>
          {formatDate(v.approvedAt)}
          <span className="block text-xs text-subtle">{timeAgo(v.approvedAt)}</span>
        </time>
      </Td>
      <Td className="text-muted">
        <Approver version={v} />
      </Td>
      <Td className="text-right">
        <span className="inline-flex items-center gap-1">
          <Tooltip content={isImage ? 'Download PNG' : 'Download text'}>
            <Button size="icon-sm" variant="ghost" icon={Download} onClick={a.download} loading={a.downloading} aria-label="Download approved version" />
          </Tooltip>
          <Menu
            label={`Actions for ${output.title}`}
            width={220}
            items={[
              { label: 'Open file', icon: ExternalLink, onSelect: a.open, disabled: !output.fileId },
              !isImage && { label: 'Copy text', icon: Copy, onSelect: a.copy },
              { label: 'Revision history', icon: History, onSelect: a.history },
              { label: 'Open task', icon: Sparkles, onSelect: a.openTask },
            ]}
          />
        </span>
      </Td>
    </tr>
  );
}

export function ApprovedTable({ outputs, onHistory }) {
  return (
    <Table className="[&_table]:min-w-[1000px]">
      <thead>
        <tr>
          <Th>Output</Th>
          <Th>Client / Job / Task</Th>
          <Th>Type</Th>
          <Th>Version</Th>
          <Th>Approved</Th>
          <Th>Approved by</Th>
          <Th className="text-right">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {outputs.map((o) => (
          <ApprovedRow key={o.id} output={o} onHistory={onHistory} />
        ))}
      </tbody>
    </Table>
  );
}
