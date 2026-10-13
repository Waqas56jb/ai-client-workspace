import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns';
import { Archive, CalendarClock, CheckCircle2, CircleDashed, ExternalLink, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, ConfirmDialog, Menu, Table, Td, Th, Tooltip } from '@/components/ui';
import { ClientLogo, JobStatusBadge } from '@/components/data-display';
import { jobService } from '@/services';
import { cn, formatDate, formatDateTime, pluralize, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

/** Deadline label + tone relative to today. */
export function deadlineInfo(deadline, status) {
  if (!deadline) return null;
  const d = parseISO(deadline);
  if (!isValid(d)) return null;
  const days = differenceInCalendarDays(d, new Date());
  const date = formatDate(deadline);
  if (status === 'completed' || status === 'archived') return { label: date, tone: 'neutral', title: `Deadline ${date}` };
  if (days < 0) return { label: `Overdue · ${date}`, tone: 'danger', title: `${pluralize(-days, 'day')} overdue` };
  if (days === 0) return { label: 'Due today', tone: 'warning', title: date };
  if (days <= 7) return { label: `Due in ${pluralize(days, 'day')}`, tone: 'warning', title: date };
  return { label: date, tone: 'neutral', title: `Due in ${days} days` };
}

export function DeadlineBadge({ job, empty = null }) {
  const info = deadlineInfo(job.deadline, job.status);
  if (!info) return empty;
  return (
    <Tooltip content={info.title}>
      <Badge tone={info.tone} icon={CalendarClock}>
        {info.label}
      </Badge>
    </Tooltip>
  );
}

/** Delete or archive a job. Jobs that contain tasks are archived by the service. */
export function DeleteJobDialog({ job, open, onClose, onDone }) {
  const qc = useQueryClient();
  // The API always archives jobs; the demo deletes empty ones.
  const hasTasks = !isMockMode || (job?.taskCount || 0) > 0;
  const mutation = useMutation({
    mutationFn: () => jobService.remove(job.id),
    onSuccess: (res) => {
      if (res?.result === 'archived') toast.success(`Archived “${job.title}” — its tasks, outputs and files were kept`);
      else toast.success(`Deleted “${job.title}”`);
      onClose();
      onDone?.(res);
      setTimeout(() => qc.invalidateQueries(), 0);
    },
    onError: (err) => toast.error(err?.message || 'Could not remove the job.'),
  });
  if (!job) return null;
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => mutation.mutate()}
      loading={mutation.isPending}
      tone={hasTasks ? 'primary' : 'danger'}
      icon={hasTasks ? Archive : undefined}
      title={hasTasks ? `Archive “${job.title}”?` : `Delete “${job.title}”?`}
      description={
        !isMockMode
          ? 'The job will be archived — tasks, conversations, outputs, approvals and files are all kept and the job can be reactivated by editing its status.'
          : hasTasks
          ? `This job contains ${pluralize(job.taskCount, 'task')}, so it can’t be deleted. It will be archived instead — tasks, conversations, outputs, approvals and files are all kept and the job can be reactivated by editing its status.`
          : 'This job has no tasks and will be permanently deleted. Any files linked to it stay in Files (unlinked from the job). This cannot be undone.'
      }
      confirmLabel={hasTasks ? 'Archive job' : 'Delete job'}
    />
  );
}

export function JobMenu({ job, onDone, showView = true }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const archived = job.status === 'archived';
  return (
    <>
      <Menu
        label={`Actions for ${job.title}`}
        items={[
          showView && { label: 'View job', icon: ExternalLink, onSelect: () => navigate(`/jobs/${job.id}`) },
          { label: 'Edit job', icon: Pencil, onSelect: () => navigate(`/jobs/${job.id}/edit`) },
          { label: 'New task in job', icon: Plus, onSelect: () => navigate(`/tasks/new?clientId=${job.clientId}&jobId=${job.id}`) },
          { separator: true },
          job.taskCount > 0 || !isMockMode
            ? { label: archived ? 'Already archived' : 'Archive job', icon: Archive, disabled: archived, onSelect: () => setConfirm(true) }
            : { label: 'Delete job', icon: Trash2, danger: true, onSelect: () => setConfirm(true) },
        ]}
      />
      <DeleteJobDialog job={job} open={confirm} onClose={() => setConfirm(false)} onDone={onDone} />
    </>
  );
}

function Counts({ job, className }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted', className)}>
      <span className="inline-flex items-center gap-1 tabular-nums" title={`${job.doneTaskCount} of ${job.taskCount} tasks done`}>
        <ListChecks size={13} aria-hidden />
        {pluralize(job.taskCount, 'task')}
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums text-warning" title="Outputs with a draft version">
        <CircleDashed size={13} aria-hidden />
        {job.draftCount} draft
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums text-success" title="Outputs with an approved version">
        <CheckCircle2 size={13} aria-hidden />
        {job.approvedCount} approved
      </span>
    </span>
  );
}

export function JobCard({ job }) {
  const navigate = useNavigate();
  return (
    <div className="card flex min-w-0 cursor-pointer flex-col p-5 transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40" onClick={() => navigate(`/jobs/${job.id}`)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ClientLogo client={job.client} size="md" />
          <div className="min-w-0">
            <Link to={`/clients/${job.clientId}`} onClick={(e) => e.stopPropagation()} className="block truncate text-xs font-medium text-muted hover:text-brand focus-ring rounded">
              {job.client?.name || 'Unknown client'}
            </Link>
            <Link to={`/jobs/${job.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-[15px] font-semibold text-ink hover:text-brand focus-ring rounded">
              {job.title}
            </Link>
          </div>
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <JobMenu job={job} showView={false} />
        </span>
      </div>
      <p className={cn('mt-3 line-clamp-2 min-h-10 text-[13px] leading-5', job.description ? 'text-muted' : 'text-subtle')}>{job.description || 'No description'}</p>
      <Counts job={job} className="mt-3" />
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <JobStatusBadge status={job.status} />
        <DeadlineBadge job={job} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span title={formatDateTime(job.createdAt)}>Created {formatDate(job.createdAt)}</span>
        <span title={formatDateTime(job.updatedAt)}>Updated {timeAgo(job.updatedAt)}</span>
      </div>
    </div>
  );
}

export function JobTable({ jobs, hideClient }) {
  const navigate = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Job</Th>
          {!hideClient && <Th>Client</Th>}
          <Th>Status</Th>
          <Th>Tasks</Th>
          <Th>Drafts</Th>
          <Th>Approved</Th>
          <Th>Deadline</Th>
          <Th>Created</Th>
          <Th>Updated</Th>
          <Th className="text-right">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="cursor-pointer transition-colors hover:bg-canvas/60" onClick={() => navigate(`/jobs/${j.id}`)}>
            <Td className="max-w-[320px]">
              <Link to={`/jobs/${j.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-ink hover:text-brand focus-ring rounded">
                {j.title}
              </Link>
              {j.description && <p className="mt-0.5 truncate text-xs text-muted">{j.description}</p>}
            </Td>
            {!hideClient && (
              <Td className="max-w-[200px]">
                <Link to={`/clients/${j.clientId}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink hover:text-brand focus-ring rounded">
                  <ClientLogo client={j.client} size="sm" />
                  <span className="truncate">{j.client?.name}</span>
                </Link>
              </Td>
            )}
            <Td>
              <JobStatusBadge status={j.status} />
            </Td>
            <Td className="tabular-nums">
              {j.taskCount}
              {j.taskCount > 0 && <span className="text-xs text-muted"> · {j.doneTaskCount} done</span>}
            </Td>
            <Td className={cn('tabular-nums', j.draftCount ? 'text-warning' : 'text-muted')}>{j.draftCount}</Td>
            <Td className={cn('tabular-nums', j.approvedCount ? 'text-success' : 'text-muted')}>{j.approvedCount}</Td>
            <Td>
              <DeadlineBadge job={j} empty={<span className="text-xs text-subtle">None</span>} />
            </Td>
            <Td className="whitespace-nowrap text-xs text-muted">{formatDate(j.createdAt)}</Td>
            <Td className="whitespace-nowrap text-xs text-muted">
              <time dateTime={j.updatedAt} title={formatDateTime(j.updatedAt)}>
                {timeAgo(j.updatedAt)}
              </time>
            </Td>
            <Td className="text-right" onClick={(e) => e.stopPropagation()}>
              <JobMenu job={j} showView={false} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
