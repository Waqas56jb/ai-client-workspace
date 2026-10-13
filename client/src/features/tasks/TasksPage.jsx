import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, Plus, SearchX } from 'lucide-react';
import { Button, EmptyState, ErrorState, FilterSelect, Page, PageHeader, ResultCount, Select, SkeletonCards, SkeletonRows, Toolbar, ViewToggle } from '@/components/ui';
import { useBreadcrumbs, useClients, useJobs, usePageTitle, useTasks, useUsers } from '@/hooks';
import { useUiStore } from '@/store/uiStore';
import { DATE_RANGES, TASK_STATUSES, TASK_TYPES } from '@/lib/constants';
import { useUrlFilters, UrlSearchInput } from './components/urlFilters';
import { TaskCard, TaskTable } from './components/TaskParts';

const DEFAULTS = { q: '', clientId: 'all', jobId: 'all', type: 'all', date: 'all', status: 'all', approval: 'all', assignee: 'all', sort: 'updated' };

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'client', label: 'Client (A–Z)' },
];

const APPROVALS = [
  { value: 'none', label: 'No outputs yet' },
  { value: 'draft', label: 'Has drafts' },
  { value: 'approved', label: 'All approved' },
];

export default function TasksPage() {
  useBreadcrumbs([{ label: 'Tasks' }]);
  usePageTitle('Tasks');
  const view = useUiStore((s) => s.views.tasks || 'list');
  const setView = useUiStore((s) => s.setView);
  const { values: f, set, clear, activeCount } = useUrlFilters(DEFAULTS);

  const { data: clients = [] } = useClients({ includeArchived: true, sort: 'name' });
  const { data: jobs = [] } = useJobs({ clientId: f.clientId, sort: 'name' });
  const { data: users = [] } = useUsers();

  const openOnly = f.status === 'open';
  const params = {
    search: f.q || undefined,
    clientId: f.clientId,
    jobId: f.jobId,
    type: f.type,
    status: openOnly ? 'all' : f.status,
    approval: f.approval,
    assigneeId: f.assignee,
    dateRange: f.date,
    sort: f.sort,
  };
  const { data, isLoading, error, refetch } = useTasks(params);
  const tasks = useMemo(() => (openOnly ? (data || []).filter((t) => t.status !== 'done') : data || []), [data, openOnly]);

  const jobOptions = jobs.map((j) => ({ value: j.id, label: f.clientId === 'all' ? `${j.title} · ${j.client?.name || ''}` : j.title }));
  // Keep a deep-linked job visible even before jobs load / if archived.
  if (f.jobId !== 'all' && !jobOptions.some((o) => o.value === f.jobId)) jobOptions.unshift({ value: f.jobId, label: 'Selected job' });

  const newTaskHref = `/tasks/new${f.clientId !== 'all' || f.jobId !== 'all' ? `?${new URLSearchParams({ ...(f.clientId !== 'all' && { clientId: f.clientId }), ...(f.jobId !== 'all' && { jobId: f.jobId }) })}` : ''}`;

  return (
    <Page wide>
      <PageHeader
        title="Tasks"
        description="Every piece of work across clients and jobs. Open a task’s AI workspace to generate and revise outputs."
        actions={
          <Button as={Link} to={newTaskHref} variant="primary" icon={Plus}>
            New task
          </Button>
        }
      />

      <Toolbar>
        <UrlSearchInput value={f.q} onCommit={(q) => set({ q })} placeholder="Search tasks, clients, jobs…" className="w-full sm:w-64" />
        <FilterSelect
          label="Client"
          value={f.clientId}
          onChange={(clientId) => set({ clientId, jobId: 'all' })}
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect label="Job" value={f.jobId} onChange={(jobId) => set({ jobId })} options={jobOptions} className="max-w-[240px]" />
        <FilterSelect label="Type" value={f.type} onChange={(type) => set({ type })} options={TASK_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
        <FilterSelect
          label="Status"
          value={f.status}
          onChange={(status) => set({ status })}
          options={[{ value: 'open', label: 'Open (not done)' }, ...TASK_STATUSES.map((s) => ({ value: s.id, label: s.label }))]}
        />
        <FilterSelect label="Approval" value={f.approval} onChange={(approval) => set({ approval })} options={APPROVALS} />
        <FilterSelect label="Owner" value={f.assignee} onChange={(assignee) => set({ assignee })} options={users.map((u) => ({ value: u.id, label: u.name }))} allLabel="Anyone" />
        <FilterSelect label="Updated" value={f.date} onChange={(date) => set({ date })} options={DATE_RANGES.filter((d) => d.id !== 'all').map((d) => ({ value: d.id, label: d.label }))} allLabel="Any time" />
        <div className="ml-auto flex items-center gap-2">
          <Select size="sm" aria-label="Sort tasks" value={f.sort} onChange={(e) => set({ sort: e.target.value })} options={SORTS.map((o) => ({ value: o.value, label: `Sort: ${o.label}` }))} className="min-w-[180px]" />
          <ViewToggle value={view === 'grid' ? 'grid' : 'list'} onChange={(v) => setView('tasks', v)} />
        </div>
      </Toolbar>

      {!isLoading && !error && (
        <div className="mb-3">
          <ResultCount count={tasks.length} noun="task" showClear={activeCount > 0} onClear={clear} />
        </div>
      )}

      {isLoading ? (
        view === 'grid' ? <SkeletonCards /> : <div className="card p-5"><SkeletonRows rows={6} /></div>
      ) : error ? (
        <div className="card">
          <ErrorState error={error} onRetry={refetch} />
        </div>
      ) : !tasks.length ? (
        <div className="card">
          {activeCount > 0 ? (
            <EmptyState icon={SearchX} title="No tasks match these filters" description="Try a different search or clear the filters to see all tasks." action={<Button onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              description="Tasks live inside jobs. Create one to start generating copy, images and listings with AI."
              action={
                <Button as={Link} to={newTaskHref} variant="primary" icon={Plus}>
                  New task
                </Button>
              }
            />
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      ) : (
        <TaskTable tasks={tasks} />
      )}
    </Page>
  );
}
