import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, FileStack, GitBranch, History, MessagesSquare, Paperclip, ShieldCheck, Sparkles } from 'lucide-react';
import { ApprovalBadge, Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, SkeletonRows } from '@/components/ui';
import { FileThumb, VersionThumb } from '@/components/data-display';
import { ApproveButton } from '@/components/approvals';
import { qk, useConversations, useFiles } from '@/hooks';
import { outputService, versionText } from '@/services';
import { TOOL_BY_ID } from '@/lib/constants';
import { formatBytes, formatDateTime, pluralize, timeAgo } from '@/lib/utils';
import { workspaceHref } from './TaskParts';

/** Small preview tile for an output's current version. */
export function OutputPreview({ output, className = 'h-14 w-14' }) {
  const v = output.currentVersion;
  if (output.kind === 'image') return <VersionThumb version={v} className={`${className} shrink-0 rounded-lg border border-line`} />;
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-canvas p-1.5`}>
      <p className="line-clamp-4 text-[8px] leading-[10px] text-muted">{versionText(v)}</p>
    </div>
  );
}

export function ConversationsCard({ task }) {
  const { data, isLoading, error, refetch } = useConversations(task.id);
  return (
    <Card>
      <CardHeader
        icon={MessagesSquare}
        title="Conversations"
        description={data ? pluralize(data.length, 'conversation') : undefined}
        action={
          <Button as={Link} to={workspaceHref(task.id)} size="sm" variant="ghost" icon={Sparkles}>
            New in workspace
          </Button>
        }
      />
      {isLoading ? (
        <SkeletonRows rows={3} className="p-5" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <EmptyState compact icon={MessagesSquare} title="No conversations yet" description="Start one in the AI workspace — every request and response is saved here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((c) => {
            const tool = TOOL_BY_ID[c.tool];
            const Icon = tool?.icon || MessagesSquare;
            return (
              <li key={c.id}>
                <Link to={workspaceHref(task.id, c.id)} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-canvas/60 focus-ring">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: tool?.soft || '#F1F2F7', color: tool?.color || '#4E5168' }}>
                    <Icon size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">{c.title}</span>
                      <time className="shrink-0 text-xs text-muted" dateTime={c.updatedAt} title={formatDateTime(c.updatedAt)}>
                        {timeAgo(c.updatedAt)}
                      </time>
                    </span>
                    {c.lastMessage && <span className="mt-0.5 block truncate text-xs text-muted">{c.lastMessage.role === 'user' ? 'You: ' : 'AI: '}{c.lastMessage.content}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-subtle">
                      {tool && <span>{tool.short}</span>}
                      <span>{pluralize(c.messageCount, 'message')}</span>
                      {c.outputCount > 0 && <span>{pluralize(c.outputCount, 'output')}</span>}
                    </span>
                  </span>
                  <ChevronRight size={15} className="mt-2 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function OutputsCard({ task, outputs, isLoading, error, refetch, onHistory }) {
  return (
    <Card>
      <CardHeader icon={FileStack} title="Outputs" description={outputs ? `${pluralize(outputs.length, 'output')} · ${task.approvedCount} approved` : undefined} />
      {isLoading ? (
        <SkeletonRows rows={3} className="p-5" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !outputs.length ? (
        <EmptyState compact icon={FileStack} title="No outputs yet" description="Generated copy and images appear here with their approval status and versions." />
      ) : (
        <ul className="divide-y divide-line">
          {outputs.map((o) => (
            <li key={o.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
              <button type="button" onClick={() => onHistory(o.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-ring" aria-label={`Open history for ${o.title}`}>
                <OutputPreview output={o} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{o.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <ApprovalBadge status={o.status} pending={o.pendingRevision} />
                    <Badge>
                      v{o.currentVersion?.versionNumber} · {pluralize(o.versionCount, 'version')}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-xs text-muted">Updated {timeAgo(o.updatedAt)}</span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" icon={History} onClick={() => onHistory(o.id)}>
                  History
                </Button>
                <ApproveButton output={o} label={`Approve v${o.currentVersion?.versionNumber}`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Loads full version lists for all outputs (shares the cache with useOutput). */
export function useAllVersions(outputs) {
  const results = useQueries({
    queries: (outputs || []).map((o) => ({ queryKey: qk.output(o.id), queryFn: () => outputService.get(o.id) })),
  });
  const loading = results.some((r) => r.isLoading);
  const versions = useMemo(
    () =>
      results
        .filter((r) => r.data)
        .flatMap((r) => (r.data.versions || []).map((v) => ({ ...v, output: r.data })))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results.map((r) => r.dataUpdatedAt).join()],
  );
  return { versions, loading };
}

export function RevisionHistoryCard({ versions, loading, onOpen }) {
  const [all, setAll] = useState(false);
  const shown = all ? versions : versions.slice(0, 8);
  return (
    <Card>
      <CardHeader icon={GitBranch} title="Revision history" description="Every version of every output, newest first" />
      {loading ? (
        <SkeletonRows rows={3} className="p-5" />
      ) : !versions.length ? (
        <EmptyState compact icon={GitBranch} title="No revisions yet" description="Each generation and edit creates a new version. Approved versions are never overwritten." />
      ) : (
        <>
          <ol className="relative px-5 py-3">
            {shown.map((v, i) => {
              const isApproved = v.output.approvedVersionId === v.id;
              return (
                <li key={v.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < shown.length - 1 && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-line" aria-hidden />}
                  <span className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${isApproved ? 'bg-success text-white' : v.status === 'approved' ? 'bg-success-soft text-success' : 'bg-[#EEF0F6] text-muted'}`}>
                    v{v.versionNumber}
                  </span>
                  <button type="button" onClick={() => onOpen(v.output.id, v.id)} className="min-w-0 flex-1 rounded-lg px-1 text-left hover:bg-canvas/60 focus-ring">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-ink">{v.output.title}</span>
                      {isApproved && <Badge tone="success">Approved</Badge>}
                      {v.status === 'approved' && !isApproved && <Badge>Previously approved</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted">{v.note}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-subtle">
                      <Avatar user={v.createdByUser} size="xs" />
                      {v.createdByUser?.name || 'Unknown'} · <time title={formatDateTime(v.createdAt)}>{timeAgo(v.createdAt)}</time>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {versions.length > 8 && (
            <div className="border-t border-line px-5 py-2.5">
              <Button size="xs" variant="ghost" onClick={() => setAll((a) => !a)}>
                {all ? 'Show fewer' : `Show all ${versions.length} versions`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ApprovalHistoryCard({ versions, loading, onOpen }) {
  const approvals = versions.filter((v) => v.approvedAt).sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1));
  return (
    <Card>
      <CardHeader icon={ShieldCheck} title="Approval history" description={loading ? undefined : pluralize(approvals.length, 'approval')} />
      {loading ? (
        <SkeletonRows rows={2} className="p-5" />
      ) : !approvals.length ? (
        <EmptyState compact icon={CheckCircle2} title="Nothing approved yet" description="Approve an output version to add it to Approved Work." />
      ) : (
        <ul className="divide-y divide-line">
          {approvals.map((v) => {
            const current = v.output.approvedVersionId === v.id;
            return (
              <li key={v.id}>
                <button type="button" onClick={() => onOpen(v.output.id, v.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas/60 focus-ring">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${current ? 'bg-success-soft text-success' : 'bg-[#F1F2F7] text-muted'}`}>
                    <CheckCircle2 size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">
                      <span className="font-medium">v{v.versionNumber}</span> of “{v.output.title}”
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Approved by {v.approvedByUser?.name || 'a team member'} · {formatDateTime(v.approvedAt)}
                    </span>
                  </span>
                  {current ? <Badge tone="success">Current</Badge> : <Badge>Superseded</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function TaskFilesCard({ taskId }) {
  const { data, isLoading, error, refetch } = useFiles({ taskId });
  return (
    <Card>
      <CardHeader icon={Paperclip} title="Files" description={data ? pluralize(data.length, 'file') : undefined} />
      {isLoading ? (
        <SkeletonRows rows={3} className="p-4" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <EmptyState compact icon={Paperclip} title="No files" description="Attachments and generated outputs for this task appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((f) => (
            <li key={f.id}>
              <Link to={`/files/${f.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas/60 focus-ring">
                <FileThumb file={f} className="h-10 w-10 shrink-0 rounded-md border border-line" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{f.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {f.category === 'output' ? 'Generated' : f.category === 'attachment' ? 'Attachment' : 'Reference'} · {formatBytes(f.size)}
                  </span>
                </span>
                {f.status && <ApprovalBadge status={f.status} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

