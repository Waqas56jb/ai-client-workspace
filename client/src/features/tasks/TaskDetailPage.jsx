import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, FileText, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Avatar, Button, Card, CardHeader, ErrorState, Menu, MetaRow, Page, Skeleton, SkeletonRows } from '@/components/ui';
import { ActivityFeed, ClientChip, ContextPath, TaskTypeBadge } from '@/components/data-display';
import { OutputHistoryDialog } from '@/components/approvals';
import { useBreadcrumbs, useOutputs, usePageTitle, useTask } from '@/hooks';
import { formatDate, formatDateTime, timeAgo } from '@/lib/utils';
import { DeleteTaskDialog, TaskStatusMenu, workspaceHref } from './components/TaskParts';
import { ApprovalHistoryCard, ConversationsCard, OutputsCard, RevisionHistoryCard, TaskFilesCard, useAllVersions } from './components/TaskDetailParts';
import { isMockMode } from '@/lib/config';

function Stat({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3.5 py-2.5">
      <p className="text-[11.5px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { data: task, isLoading, error, refetch } = useTask(taskId);
  const outputsQuery = useOutputs({ taskId }, { enabled: !!task });
  const { versions, loading: versionsLoading } = useAllVersions(outputsQuery.data);
  const [history, setHistory] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useBreadcrumbs(
    task
      ? [
          { label: 'Clients', to: '/clients' },
          ...(task.client ? [{ label: task.client.name, to: `/clients/${task.client.id}` }] : []),
          ...(task.job ? [{ label: task.job.title, to: `/jobs/${task.job.id}` }] : []),
          { label: task.title },
        ]
      : [{ label: 'Tasks', to: '/tasks' }, { label: isLoading ? 'Loading…' : 'Not found' }],
  );
  usePageTitle(task?.title || 'Task');

  if (isLoading) {
    return (
      <Page>
        <Skeleton className="mb-3 h-3.5 w-48" />
        <Skeleton className="mb-6 h-8 w-80" />
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="card p-5">
            <SkeletonRows rows={6} />
          </div>
          <div className="card p-5">
            <SkeletonRows rows={4} />
          </div>
        </div>
      </Page>
    );
  }

  if (error || !task) {
    return (
      <Page narrow>
        <div className="card pb-8">
          <ErrorState error={error} onRetry={refetch} />
          <div className="text-center">
            <Button as={Link} to="/tasks" icon={ArrowLeft}>
              Back to tasks
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  const openHistory = (outputId, versionId) => setHistory({ outputId, versionId });

  return (
    <Page>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <ContextPath client={task.client} job={task.job} className="mb-2" />
          <h1 className="font-display text-[24px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">{task.title}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <TaskTypeBadge type={task.type} />
            <TaskStatusMenu task={task} />
            <span aria-hidden>·</span>
            <span>Created {formatDate(task.createdAt)}</span>
            <span aria-hidden>·</span>
            <span title={formatDateTime(task.updatedAt)}>Updated {timeAgo(task.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button as={Link} to={`/tasks/${task.id}/edit`} icon={Pencil}>
            Edit
          </Button>
          <Menu
            label="More task actions"
            items={[{ label: isMockMode ? 'Delete task' : 'Archive task', icon: Trash2, danger: true, onSelect: () => setConfirmDelete(true) }]}
          />
          <Button as={Link} to={workspaceHref(task.id)} variant="ai" size="lg" icon={Sparkles}>
            Open AI Workspace
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Conversations" value={task.conversationCount} />
        <Stat label="Messages" value={task.messageCount} />
        <Stat label="Outputs" value={task.outputCount} />
        <Stat label="Drafts" value={task.draftCount} />
        <Stat label="Approved" value={task.approvedCount} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader icon={FileText} title="Brief" />
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Description</p>
                <p className={`mt-1 whitespace-pre-line text-[14px] leading-6 ${task.description ? 'text-ink' : 'text-subtle'}`}>{task.description || 'No description yet.'}</p>
              </div>
              {task.notes && (
                <div className="rounded-lg border border-line bg-canvas/60 px-3.5 py-3">
                  <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Internal notes</p>
                  <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-ink">{task.notes}</p>
                </div>
              )}
            </div>
          </Card>

          <ConversationsCard task={task} />
          <OutputsCard task={task} outputs={outputsQuery.data} isLoading={outputsQuery.isLoading} error={outputsQuery.error} refetch={outputsQuery.refetch} onHistory={(id) => openHistory(id)} />
          <div className="grid gap-5 xl:grid-cols-2">
            <RevisionHistoryCard versions={versions} loading={outputsQuery.isLoading || versionsLoading} onOpen={openHistory} />
            <ApprovalHistoryCard versions={versions} loading={outputsQuery.isLoading || versionsLoading} onOpen={openHistory} />
          </div>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-line px-5 py-1.5">
              <MetaRow label="Status">
                <TaskStatusMenu task={task} />
              </MetaRow>
              <MetaRow label="Type">
                <TaskTypeBadge type={task.type} />
              </MetaRow>
              <MetaRow label="Client">
                <ClientChip client={task.client} />
              </MetaRow>
              <MetaRow label="Job">
                {task.job ? (
                  <Link to={`/jobs/${task.job.id}`} className="hover:text-brand focus-ring rounded">
                    {task.job.title}
                  </Link>
                ) : (
                  '—'
                )}
              </MetaRow>
              <MetaRow label="Responsible">
                <span className="inline-flex items-center gap-1.5">
                  <Avatar user={task.assignee} size="xs" />
                  {task.assignee?.name || 'Unassigned'}
                </span>
              </MetaRow>
              <MetaRow label="Created by">
                <span className="inline-flex items-center gap-1.5">
                  <Avatar user={task.createdByUser} size="xs" />
                  {task.createdByUser?.name || 'Unknown'}
                </span>
              </MetaRow>
              <MetaRow label="Created">{formatDateTime(task.createdAt)}</MetaRow>
              <MetaRow label="Last updated">{formatDateTime(task.updatedAt)}</MetaRow>
            </dl>
          </Card>

          <TaskFilesCard taskId={task.id} />

          <Card>
            <CardHeader icon={Activity} title="Activity" />
            <div className="py-1.5">
              <ActivityFeed taskId={task.id} limit={15} compact showContext={false} emptyText="Edits, AI requests and approvals on this task will appear here." />
            </div>
          </Card>
        </aside>
      </div>

      <OutputHistoryDialog open={!!history} onClose={() => setHistory(null)} outputId={history?.outputId} initialVersionId={history?.versionId} />
      <DeleteTaskDialog task={task} open={confirmDelete} onClose={() => setConfirmDelete(false)} onDeleted={() => navigate(task.job ? `/jobs/${task.job.id}` : '/tasks', { replace: true })} />
    </Page>
  );
}
