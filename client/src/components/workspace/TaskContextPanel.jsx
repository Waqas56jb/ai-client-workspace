import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, FolderOpen } from 'lucide-react';
import { Avatar, EmptyState, SkeletonRows } from '@/components/ui';
import { ContextPath, FileThumb, TaskStatusBadge, TaskTypeBadge } from '@/components/data-display/Entities';
import { cn, formatBytes, formatDate, timeAgo } from '@/lib/utils';
import { ConversationList } from './ConversationList';

function SectionTitle({ children, action }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{children}</h3>
      {action}
    </div>
  );
}

function TaskSummary({ task, client, job }) {
  const [expanded, setExpanded] = useState(false);
  const long = (task.description || '').length > 160;
  return (
    <section className="space-y-2.5">
      <ContextPath client={client} job={job} />
      <h2 className="font-display text-[17px] font-bold leading-snug text-ink">{task.title}</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <TaskTypeBadge type={task.type} />
        <TaskStatusBadge status={task.status} />
      </div>
      {task.description ? (
        <div>
          <p className={cn('whitespace-pre-line text-[13px] leading-5 text-muted', !expanded && long && 'line-clamp-3')}>{task.description}</p>
          {long && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline focus-ring rounded">
              {expanded ? 'Show less' : 'Show more'}
              <ChevronDown size={13} className={cn('transition-transform', expanded && 'rotate-180')} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <p className="text-[13px] italic text-subtle">No task description.</p>
      )}
      {task.notes && <p className="rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs leading-5 text-muted">{task.notes}</p>}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-canvas px-2.5 py-2">
          <dt className="text-muted">Assignee</dt>
          <dd className="mt-1 flex items-center gap-1.5 font-medium text-ink">
            <Avatar user={task.assignee} size="xs" />
            <span className="truncate">{task.assignee?.name || 'Unassigned'}</span>
          </dd>
        </div>
        <div className="rounded-lg bg-canvas px-2.5 py-2">
          <dt className="text-muted">Outputs</dt>
          <dd className="mt-1 font-medium text-ink">
            {task.outputCount} · <span className="text-success">{task.approvedCount} approved</span>
          </dd>
        </div>
      </dl>
      <Link to={`/tasks/${task.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline focus-ring rounded">
        Task details <ArrowUpRight size={13} aria-hidden />
      </Link>
    </section>
  );
}

function TaskFiles({ files, loading }) {
  return (
    <section>
      <SectionTitle
        action={
          <Link to="/files" className="text-xs font-medium text-brand hover:underline focus-ring rounded">
            Library
          </Link>
        }
      >
        Task files {files?.length ? <span className="text-subtle">({files.length})</span> : null}
      </SectionTitle>
      {loading ? (
        <SkeletonRows rows={2} />
      ) : !files?.length ? (
        <EmptyState compact icon={FolderOpen} title="No files yet" description="Attachments and generated outputs for this task appear here." />
      ) : (
        <ul className="space-y-1">
          {files.slice(0, 12).map((f) => (
            <li key={f.id}>
              <Link to={`/files/${f.id}`} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-canvas focus-ring">
                <FileThumb file={f} className="h-9 w-9 shrink-0 rounded-md border border-line" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{f.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {f.category === 'output' ? 'Output' : f.category === 'attachment' ? 'Attachment' : 'Reference'} · {formatBytes(f.size)} · {timeAgo(f.lastRevisionAt || f.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {files.length > 12 && <li className="px-1.5 pt-1 text-xs text-muted">+{files.length - 12} more in the file library</li>}
        </ul>
      )}
    </section>
  );
}

/** Left column: task information, conversations and task files. */
export function TaskContextPanel({ task, client, job, conversations, conversationsLoading, selectedConversationId, onSelectConversation, onNewConversation, creatingConversation, files, filesLoading }) {
  return (
    <div className="space-y-6 p-4">
      <TaskSummary task={task} client={client} job={job} />
      <div className="h-px bg-line" />
      <ConversationList
        conversations={conversations}
        loading={conversationsLoading}
        selectedId={selectedConversationId}
        onSelect={onSelectConversation}
        onNew={onNewConversation}
        creating={creatingConversation}
      />
      <div className="h-px bg-line" />
      <TaskFiles files={files} loading={filesLoading} />
      <p className="text-[11px] text-subtle">Task created {formatDate(task.createdAt)}</p>
    </div>
  );
}
