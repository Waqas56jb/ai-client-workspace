import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Activity, ArrowLeft, ChevronRight, FileStack, FolderOpen, LayoutDashboard, ListChecks, MessagesSquare, Paperclip, Pencil, Plus, Sparkles } from 'lucide-react';
import { ApprovalBadge, Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, MetaRow, Page, ProgressBar, Skeleton, SkeletonCards, SkeletonRows, TabPanel, Tabs } from '@/components/ui';
import { ActivityFeed, ClientLogo, FileThumb, JobStatusBadge, TaskStatusBadge, VersionThumb } from '@/components/data-display';
import { OutputHistoryDialog } from '@/components/approvals';
import { qk, useBreadcrumbs, useFiles, useJob, useOutputs, usePageTitle, useTasks } from '@/hooks';
import { conversationService, versionText } from '@/services';
import { TASK_STATUSES, TOOL_BY_ID } from '@/lib/constants';
import { formatBytes, formatDate, formatDateTime, pluralize, timeAgo, truncate } from '@/lib/utils';
import { TaskTable, workspaceHref } from '@/features/tasks/components/TaskParts';
import { DeadlineBadge, JobMenu } from './components/JobParts';

const TABS = ['overview', 'tasks', 'files', 'activity'];

function Stat({ label, value, tone }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3.5 py-2.5">
      <p className="text-[11.5px] font-medium text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone || 'text-ink'}`}>{value}</p>
    </div>
  );
}

function RecentConversations({ tasks }) {
  const withConvs = tasks.filter((t) => t.conversationCount > 0);
  const results = useQueries({ queries: withConvs.map((t) => ({ queryKey: qk.conversations(t.id), queryFn: () => conversationService.listByTask(t.id) })) });
  const loading = results.some((r) => r.isLoading);
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const convs = results
    .flatMap((r) => r.data || [])
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 5);

  return (
    <Card>
      <CardHeader icon={MessagesSquare} title="Recent conversations" description="Across all tasks in this job" />
      {loading ? (
        <SkeletonRows rows={3} className="p-5" />
      ) : !convs.length ? (
        <EmptyState compact icon={MessagesSquare} title="No conversations yet" description="Open a task’s AI workspace to start one." />
      ) : (
        <ul className="divide-y divide-line">
          {convs.map((c) => {
            const tool = TOOL_BY_ID[c.tool];
            const Icon = tool?.icon || MessagesSquare;
            const task = taskById[c.taskId];
            return (
              <li key={c.id}>
                <Link to={workspaceHref(c.taskId, c.id)} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-canvas/60 focus-ring">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: tool?.soft || '#F1F2F7', color: tool?.color || '#4E5168' }}>
                    <Icon size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">{c.title}</span>
                      <time className="shrink-0 text-xs text-muted" title={formatDateTime(c.updatedAt)}>
                        {timeAgo(c.updatedAt)}
                      </time>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {task?.title} · {pluralize(c.messageCount, 'message')}
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

function RecentAssets({ jobId, onOpen }) {
  const { data, isLoading, error, refetch } = useOutputs({ jobId });
  const items = (data || []).slice(0, 6);
  return (
    <Card>
      <CardHeader icon={FileStack} title="Recent generated assets" description={data ? `${pluralize(data.length, 'output')} in this job` : undefined} />
      {isLoading ? (
        <SkeletonRows rows={3} className="p-5" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !items.length ? (
        <EmptyState compact icon={Sparkles} title="Nothing generated yet" description="Copy and images created in this job’s tasks will appear here." />
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((o) => (
            <button key={o.id} type="button" onClick={() => onOpen(o.id)} className="group flex flex-col overflow-hidden rounded-xl border border-line text-left transition-[border,box-shadow] hover:border-line-strong hover:shadow-card focus-ring">
              {o.kind === 'image' ? (
                <VersionThumb version={o.currentVersion} className="aspect-[4/3] w-full border-b border-line" />
              ) : (
                <div className="aspect-[4/3] w-full overflow-hidden border-b border-line bg-gradient-to-b from-white to-canvas p-3">
                  <p className="line-clamp-6 whitespace-pre-line text-[11px] leading-4 text-muted">{truncate(versionText(o.currentVersion), 320)}</p>
                </div>
              )}
              <span className="block p-3">
                <span className="block truncate text-[13px] font-medium text-ink">{o.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <ApprovalBadge status={o.status} pending={o.pendingRevision} />
                  <span className="text-[11.5px] text-muted">v{o.currentVersion?.versionNumber}</span>
                </span>
                <span className="mt-1 block truncate text-[11.5px] text-subtle">{o.task?.title}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function TaskProgress({ job, tasks }) {
  const byStatus = TASK_STATUSES.map((s) => ({ ...s, count: tasks.filter((t) => t.status === s.id).length }));
  return (
    <Card>
      <CardHeader icon={ListChecks} title="Task progress" />
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-semibold tabular-nums text-ink">
            {job.doneTaskCount}
            <span className="text-base font-medium text-muted"> / {job.taskCount} done</span>
          </p>
          <span className="text-xs text-muted">{job.taskCount ? Math.round((job.doneTaskCount / job.taskCount) * 100) : 0}%</span>
        </div>
        <ProgressBar value={job.doneTaskCount} max={job.taskCount || 1} tone="success" className="mt-2.5" label="Tasks completed" />
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {byStatus.map((s) => (
            <li key={s.id}>
              <Link to={`/tasks?jobId=${job.id}&status=${s.id}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 transition-colors hover:bg-canvas focus-ring">
                <TaskStatusBadge status={s.id} />
                <span className="text-[13px] font-semibold tabular-nums text-ink">{s.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function JobSummary({ job }) {
  return (
    <Card>
      <CardHeader title="Job summary" />
      <dl className="divide-y divide-line px-5 py-1.5">
        <MetaRow label="Status">
          <JobStatusBadge status={job.status} />
        </MetaRow>
        <MetaRow label="Deadline">
          <DeadlineBadge job={job} empty={<span className="text-muted">None</span>} />
        </MetaRow>
        <MetaRow label="Client">
          <Link to={`/clients/${job.clientId}`} className="inline-flex items-center gap-1.5 hover:text-brand focus-ring rounded">
            <ClientLogo client={job.client} size="xs" />
            {job.client?.name}
          </Link>
        </MetaRow>
        <MetaRow label="Created by">
          <span className="inline-flex items-center gap-1.5">
            <Avatar user={job.createdByUser} size="xs" />
            {job.createdByUser?.name || 'Unknown'}
          </span>
        </MetaRow>
        <MetaRow label="Created">{formatDate(job.createdAt)}</MetaRow>
        <MetaRow label="Last updated">{formatDateTime(job.updatedAt)}</MetaRow>
      </dl>
      {job.notes && (
        <div className="mx-5 mb-4 rounded-lg border border-line bg-canvas/60 px-3.5 py-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Internal notes</p>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-ink">{job.notes}</p>
        </div>
      )}
    </Card>
  );
}

function FilesGrid({ jobId }) {
  const { data, isLoading, error, refetch } = useFiles({ jobId });
  if (isLoading) return <SkeletonCards count={4} className="lg:grid-cols-4" />;
  if (error)
    return (
      <div className="card">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  if (!data.length)
    return (
      <div className="card">
        <EmptyState icon={Paperclip} title="No files in this job" description="Generated outputs and task attachments for this job appear here." />
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {data.map((f) => (
        <Link key={f.id} to={`/files/${f.id}`} className="card group overflow-hidden transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40 focus-ring">
          <FileThumb file={f} className="aspect-[4/3] w-full border-b border-line" />
          <div className="p-3">
            <p className="truncate text-[13px] font-medium text-ink" title={f.name}>
              {f.name}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {f.task?.title || 'Job file'} · {formatBytes(f.size)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              {f.status ? <ApprovalBadge status={f.status} pending={f.pendingRevision} /> : <Badge>{f.category === 'attachment' ? 'Attachment' : 'Reference'}</Badge>}
              <span className="text-[11px] text-subtle">{timeAgo(f.lastRevisionAt || f.updatedAt)}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function JobDetailPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const [history, setHistory] = useState(null);

  const { data: job, isLoading, error, refetch } = useJob(jobId);
  const tasksQuery = useTasks({ jobId }, { enabled: !!job });
  const tasks = useMemo(() => tasksQuery.data || [], [tasksQuery.data]);

  useBreadcrumbs(
    job
      ? [
          { label: 'Clients', to: '/clients' },
          ...(job.client ? [{ label: job.client.name, to: `/clients/${job.clientId}` }] : []),
          { label: 'Jobs', to: `/clients/${job.clientId}/jobs` },
          { label: job.title },
        ]
      : [{ label: 'Jobs', to: '/jobs' }, { label: isLoading ? 'Loading…' : 'Not found' }],
  );
  usePageTitle(job?.title || 'Job');

  if (isLoading) {
    return (
      <Page>
        <Skeleton className="mb-3 h-3.5 w-40" />
        <Skeleton className="mb-2 h-8 w-72" />
        <Skeleton className="mb-6 h-4 w-96 max-w-full" />
        <SkeletonCards count={3} />
      </Page>
    );
  }

  if (error || !job) {
    return (
      <Page narrow>
        <div className="card pb-8">
          <ErrorState error={error} onRetry={refetch} />
          <div className="text-center">
            <Button as={Link} to="/jobs" icon={ArrowLeft}>
              Back to jobs
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  const newTaskHref = `/tasks/new?clientId=${job.clientId}&jobId=${job.id}`;

  return (
    <Page>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <ClientLogo client={job.client} size="lg" className="hidden sm:inline-flex" />
          <div className="min-w-0">
            <Link to={`/clients/${job.clientId}`} className="text-[13px] font-medium text-muted hover:text-brand focus-ring rounded">
              {job.client?.name}
            </Link>
            <h1 className="mt-0.5 font-display text-[24px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">{job.title}</h1>
            {job.description && <p className="mt-1.5 max-w-2xl text-[14px] text-muted">{job.description}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <JobStatusBadge status={job.status} />
              <DeadlineBadge job={job} />
              <span className="text-xs text-muted" title={formatDateTime(job.updatedAt)}>
                Updated {timeAgo(job.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button as={Link} to={`/jobs/${job.id}/edit`} icon={Pencil}>
            Edit job
          </Button>
          <JobMenu job={job} showView={false} onDone={(res) => res?.result === 'deleted' && navigate(`/clients/${job.clientId}`, { replace: true })} />
          <Button as={Link} to={newTaskHref} variant="primary" icon={Plus}>
            New task
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Tasks" value={job.taskCount} />
        <Stat label="Completed" value={job.doneTaskCount} />
        <Stat label="Drafts" value={job.draftCount} tone={job.draftCount ? 'text-warning' : undefined} />
        <Stat label="Approved" value={job.approvedCount} tone={job.approvedCount ? 'text-success' : undefined} />
        <Stat label="Files" value={job.fileCount} />
      </div>

      <Tabs
        className="mb-5"
        ariaLabel="Job sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          { id: 'tasks', label: 'Tasks', icon: ListChecks, count: job.taskCount },
          { id: 'files', label: 'Files', icon: FolderOpen, count: job.fileCount },
          { id: 'activity', label: 'Activity', icon: Activity },
        ]}
      />

      {tab === 'overview' && (
        <TabPanel className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <RecentAssets jobId={job.id} onOpen={(outputId) => setHistory(outputId)} />
            {tasksQuery.isLoading ? (
              <div className="card p-5">
                <SkeletonRows rows={3} />
              </div>
            ) : (
              <RecentConversations tasks={tasks} />
            )}
          </div>
          <div className="min-w-0 space-y-5">
            <TaskProgress job={job} tasks={tasks} />
            <JobSummary job={job} />
          </div>
        </TabPanel>
      )}

      {tab === 'tasks' && (
        <TabPanel>
          {tasksQuery.isLoading ? (
            <div className="card p-5">
              <SkeletonRows rows={5} />
            </div>
          ) : tasksQuery.error ? (
            <div className="card">
              <ErrorState error={tasksQuery.error} onRetry={tasksQuery.refetch} />
            </div>
          ) : !tasks.length ? (
            <div className="card">
              <EmptyState
                icon={ListChecks}
                title="No tasks in this job"
                description="Add a task for each deliverable — e.g. advertising images, ad copy or member emails."
                action={
                  <Button as={Link} to={newTaskHref} variant="primary" icon={Plus}>
                    New task
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">{pluralize(tasks.length, 'task')}</p>
                <Link to={`/tasks?jobId=${job.id}`} className="text-xs font-medium text-brand hover:underline focus-ring rounded">
                  Open in Tasks with filters
                </Link>
              </div>
              <TaskTable tasks={tasks} hideClient hideJob />
            </>
          )}
        </TabPanel>
      )}

      {tab === 'files' && (
        <TabPanel>
          <FilesGrid jobId={job.id} />
        </TabPanel>
      )}

      {tab === 'activity' && (
        <TabPanel>
          <Card className="py-2">
            <ActivityFeed jobId={job.id} limit={40} emptyText="Changes to this job and its tasks will appear here." />
          </Card>
        </TabPanel>
      )}

      <OutputHistoryDialog open={!!history} onClose={() => setHistory(null)} outputId={history} />
    </Page>
  );
}

