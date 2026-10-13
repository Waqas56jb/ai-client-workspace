import { Link } from 'react-router-dom';
import { FolderKanban, Plus, SearchX } from 'lucide-react';
import { Button, EmptyState, ErrorState, FilterSelect, Page, PageHeader, ResultCount, Select, SkeletonCards, SkeletonRows, Toolbar, ViewToggle } from '@/components/ui';
import { useBreadcrumbs, useClients, useJobs, usePageTitle } from '@/hooks';
import { useUiStore } from '@/store/uiStore';
import { JOB_STATUSES } from '@/lib/constants';
import { useUrlFilters, UrlSearchInput } from '@/features/tasks/components/urlFilters';
import { JobCard, JobTable } from './components/JobParts';

const DEFAULTS = { q: '', clientId: 'all', status: 'all', sort: 'updated' };

const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Created date' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'deadline', label: 'Deadline (soonest)' },
];

export default function JobsPage() {
  useBreadcrumbs([{ label: 'Jobs' }]);
  usePageTitle('Jobs');
  const view = useUiStore((s) => s.views.jobs || 'grid');
  const setView = useUiStore((s) => s.setView);
  const { values: f, set, clear, activeCount } = useUrlFilters(DEFAULTS);

  const { data: clients = [] } = useClients({ includeArchived: true, sort: 'name' });
  const { data: jobs = [], isLoading, error, refetch } = useJobs({ search: f.q || undefined, clientId: f.clientId, status: f.status, sort: f.sort });

  const newJobHref = f.clientId !== 'all' ? `/jobs/new?clientId=${f.clientId}` : '/jobs/new';

  return (
    <Page wide>
      <PageHeader
        title="Jobs"
        description="Campaigns and projects for each client. Jobs group the tasks, outputs and files for one piece of work."
        actions={
          <Button as={Link} to={newJobHref} variant="primary" icon={Plus}>
            New job
          </Button>
        }
      />

      <Toolbar>
        <UrlSearchInput value={f.q} onCommit={(q) => set({ q })} placeholder="Search jobs or clients…" className="w-full sm:w-72" />
        <FilterSelect label="Client" value={f.clientId} onChange={(clientId) => set({ clientId })} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Status" value={f.status} onChange={(status) => set({ status })} options={JOB_STATUSES.map((s) => ({ value: s.id, label: s.label }))} />
        <div className="ml-auto flex items-center gap-2">
          <Select size="sm" aria-label="Sort jobs" value={f.sort} onChange={(e) => set({ sort: e.target.value })} options={SORTS.map((o) => ({ value: o.value, label: `Sort: ${o.label}` }))} className="min-w-[190px]" />
          <ViewToggle value={view} onChange={(v) => setView('jobs', v)} />
        </div>
      </Toolbar>

      {!isLoading && !error && (
        <div className="mb-3">
          <ResultCount count={jobs.length} noun="job" showClear={activeCount > 0} onClear={clear} />
        </div>
      )}

      {isLoading ? (
        view === 'grid' ? (
          <SkeletonCards />
        ) : (
          <div className="card p-5">
            <SkeletonRows rows={6} />
          </div>
        )
      ) : error ? (
        <div className="card">
          <ErrorState error={error} onRetry={refetch} />
        </div>
      ) : !jobs.length ? (
        <div className="card">
          {activeCount > 0 ? (
            <EmptyState icon={SearchX} title="No jobs match these filters" description="Try a different search, or clear the filters to see every job." action={<Button onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={FolderKanban}
              title="No jobs yet"
              description="Create a job for a client campaign or project, then add tasks to it."
              action={
                <Button as={Link} to={newJobHref} variant="primary" icon={Plus}>
                  New job
                </Button>
              }
            />
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      ) : (
        <JobTable jobs={jobs} />
      )}
    </Page>
  );
}
