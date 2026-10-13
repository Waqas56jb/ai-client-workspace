import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ExternalLink, MessagesSquare, Paperclip, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { ApprovalBadge, Avatar, Button, ConfirmDialog, Menu, Table, Td, Th, Tooltip } from '@/components/ui';
import { ClientChip, TaskStatusBadge, TaskTypeBadge } from '@/components/data-display';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useServiceMutation } from '@/hooks';
import { taskService } from '@/services';
import { TASK_STATUSES } from '@/lib/constants';
import { cn, formatDateTime, pluralize, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

export const workspaceHref = (taskId, conversationId) => `/ai-workspace/${taskId}${conversationId ? `?conversation=${conversationId}` : ''}`;

/** Approval state of a task's outputs. */
export function TaskApproval({ task }) {
  if (task.approvalStatus === 'none') return <span className="text-xs text-subtle">No outputs</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <ApprovalBadge status={task.approvalStatus} />
      <span className="text-[11.5px] text-muted">
        {task.approvedCount}/{task.outputCount}
      </span>
    </span>
  );
}

/** Delete-task confirmation + mutation. */
export function DeleteTaskDialog({ task, open, onClose, onDeleted }) {
  const qc = useQueryClient();
  // Navigate away before refreshing caches so the deleted record never flashes "Not found".
  const mutation = useMutation({
    mutationFn: () => taskService.remove(task.id),
    onSuccess: () => {
      toast.success(isMockMode ? `Deleted “${task.title}”` : `Archived “${task.title}”`);
      onClose();
      onDeleted?.();
      setTimeout(() => qc.invalidateQueries(), 0);
    },
    onError: (err) => toast.error(err?.message || 'Could not delete the task.'),
  });
  if (!task) return null;
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => mutation.mutate()}
      loading={mutation.isPending}
      tone="danger"
      title={isMockMode ? `Delete “${task.title}”?` : `Archive “${task.title}”?`}
      description={
        isMockMode
          ? 'This permanently deletes the task with all of its AI conversations, generated outputs and every version of those outputs (including approved versions). This cannot be undone.'
          : 'The task will be archived and hidden from task lists. Its AI conversations, outputs, versions and approvals are kept for the audit history.'
      }
      confirmLabel={isMockMode ? 'Delete task' : 'Archive task'}
    >
      {isMockMode && <ul className="space-y-1 rounded-lg border border-line bg-canvas/60 px-3 py-2 text-xs text-muted">
        <li>{pluralize(task.conversationCount || 0, 'conversation')} and {pluralize(task.messageCount || 0, 'message')}</li>
        <li>
          {pluralize(task.outputCount || 0, 'output')} ({task.approvedCount || 0} approved)
        </li>
        <li>Uploaded attachments are kept in Files but unlinked from the task.</li>
      </ul>}
    </ConfirmDialog>
  );
}

/** Three-dot menu for a task: open workspace, edit, delete. */
export function TaskMenu({ task, onDeleted, showWorkspace = true }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Menu
        label={`Actions for ${task.title}`}
        items={[
          showWorkspace && { label: 'Open AI workspace', icon: Sparkles, onSelect: () => navigate(workspaceHref(task.id)) },
          { label: 'View details', icon: ExternalLink, onSelect: () => navigate(`/tasks/${task.id}`) },
          { label: 'Edit task', icon: Pencil, onSelect: () => navigate(`/tasks/${task.id}/edit`) },
          { separator: true },
          { label: isMockMode ? 'Delete task' : 'Archive task', icon: Trash2, danger: true, onSelect: () => setConfirm(true) },
        ]}
      />
      <DeleteTaskDialog task={task} open={confirm} onClose={() => setConfirm(false)} onDeleted={onDeleted} />
    </>
  );
}

/** Inline status changer (menu trigger showing the current status). */
export function TaskStatusMenu({ task }) {
  const mutation = useServiceMutation((status) => taskService.update(task.id, { status }), {
    success: (d) => `Status set to ${TASK_STATUSES.find((s) => s.id === d.status)?.label}`,
  });
  return (
    <Menu
      align="start"
      width={180}
      items={TASK_STATUSES.map((s) => ({
        label: s.label,
        hint: s.id === task.status ? 'Current' : undefined,
        disabled: s.id === task.status || mutation.isPending,
        onSelect: () => mutation.mutate(s.id),
      }))}
      trigger={
        <button
          type="button"
          aria-label={`Change status (currently ${TASK_STATUSES.find((s) => s.id === task.status)?.label})`}
          className="inline-flex items-center gap-1 rounded-md focus-ring hover:opacity-85"
        >
          <TaskStatusBadge status={task.status} />
          <ChevronDown size={13} className="text-muted" aria-hidden />
        </button>
      }
    />
  );
}

function Counts({ task }) {
  return (
    <span className="inline-flex items-center gap-3 text-xs text-muted">
      <Tooltip content={`${pluralize(task.conversationCount, 'conversation')} · ${pluralize(task.messageCount, 'message')}`}>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <MessagesSquare size={13} aria-hidden />
          {task.conversationCount}
          <span className="text-subtle">/ {task.messageCount}</span>
        </span>
      </Tooltip>
      <Tooltip content={pluralize(task.fileCount, 'file')}>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Paperclip size={13} aria-hidden />
          {task.fileCount}
        </span>
      </Tooltip>
    </span>
  );
}

/** Tasks table used by the Tasks list and the Job detail page. */
export function TaskTable({ tasks, hideClient, hideJob, onDeleted }) {
  const navigate = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Task</Th>
          {!hideClient && <Th>Client</Th>}
          {!hideJob && <Th>Job</Th>}
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Activity</Th>
          <Th>Approval</Th>
          <Th>Updated</Th>
          <Th>Owner</Th>
          <Th className="text-right">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id} className="cursor-pointer transition-colors hover:bg-canvas/60" onClick={() => navigate(`/tasks/${t.id}`)}>
            <Td className="max-w-[280px]">
              <Link to={`/tasks/${t.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-ink hover:text-brand focus-ring rounded">
                {t.title}
              </Link>
              {t.description && <p className="mt-0.5 truncate text-xs text-muted">{t.description}</p>}
            </Td>
            {!hideClient && (
              <Td className="max-w-[180px]">
                <ClientChip client={t.client} />
              </Td>
            )}
            {!hideJob && (
              <Td className="max-w-[180px]">
                {t.job ? (
                  <Link to={`/jobs/${t.job.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-[13px] text-ink hover:text-brand focus-ring rounded">
                    {t.job.title}
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
            )}
            <Td>
              <TaskTypeBadge type={t.type} />
            </Td>
            <Td>
              <TaskStatusBadge status={t.status} />
            </Td>
            <Td>
              <Counts task={t} />
            </Td>
            <Td>
              <TaskApproval task={t} />
            </Td>
            <Td className="whitespace-nowrap text-xs text-muted">
              <time dateTime={t.updatedAt} title={formatDateTime(t.updatedAt)}>
                {timeAgo(t.updatedAt)}
              </time>
            </Td>
            <Td>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Avatar user={t.assignee} size="sm" />
                <span className="hidden max-w-[90px] truncate xl:inline">{t.assignee?.name?.split(' ')[0] || 'Unassigned'}</span>
              </span>
            </Td>
            <Td className="text-right" onClick={(e) => e.stopPropagation()}>
              <span className="inline-flex items-center gap-1">
                <Button as={Link} to={workspaceHref(t.id)} size="xs" variant="soft" icon={Sparkles} aria-label={`Open AI workspace for ${t.title}`}>
                  Open
                </Button>
                <TaskMenu task={t} onDeleted={onDeleted} showWorkspace={false} />
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Card view of a task. */
export function TaskCard({ task: t }) {
  const navigate = useNavigate();
  return (
    <div
      className="card group flex cursor-pointer flex-col p-4 transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40"
      onClick={() => navigate(`/tasks/${t.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TaskTypeBadge type={t.type} />
          <TaskStatusBadge status={t.status} />
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <TaskMenu task={t} />
        </span>
      </div>
      <Link to={`/tasks/${t.id}`} onClick={(e) => e.stopPropagation()} className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-ink hover:text-brand focus-ring rounded">
        {t.title}
      </Link>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <ClientChip client={t.client} className="text-xs" />
        {t.job && (
          <>
            <span aria-hidden>/</span>
            <Link to={`/jobs/${t.job.id}`} onClick={(e) => e.stopPropagation()} className="truncate hover:text-brand focus-ring rounded">
              {t.job.title}
            </Link>
          </>
        )}
      </div>
      <p className={cn('mt-2 line-clamp-2 text-[13px] leading-5', t.description ? 'text-muted' : 'text-subtle')}>{t.description || 'No description'}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Counts task={t} />
        <TaskApproval task={t} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <Avatar user={t.assignee} size="xs" />
          <span className="truncate">{t.assignee?.name || 'Unassigned'}</span>
          <span aria-hidden>·</span>
          <time dateTime={t.updatedAt} title={formatDateTime(t.updatedAt)} className="whitespace-nowrap">
            {timeAgo(t.updatedAt)}
          </time>
        </span>
        <Button as={Link} to={workspaceHref(t.id)} size="xs" variant="soft" icon={Sparkles} onClick={(e) => e.stopPropagation()}>
          Workspace
        </Button>
      </div>
    </div>
  );
}

