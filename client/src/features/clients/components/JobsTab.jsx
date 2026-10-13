import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Briefcase, Plus, SearchX } from 'lucide-react';
import { Button, EmptyState, ErrorState, FilterSelect, ProgressBar, ResultCount, SearchInput, SkeletonRows, Table, Td, Th, Toolbar } from '@/components/ui';
import { JobStatusBadge } from '@/components/data-display';
import { useDebounce, useJobs } from '@/hooks';
import { JOB_STATUSES } from '@/lib/constants';
import { formatDate, timeAgo } from '@/lib/utils';

export function JobsTab({ client }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const debounced = useDebounce(search.trim(), 200);
  const { data: jobs, isLoading, error, refetch } = useJobs({ clientId: client.id, status, search: debounced || undefined });
  const filtered = !!debounced || status !== 'all';
  const newJob = (
    <Button as={Link} to={`/jobs/new?clientId=${client.id}`} variant="primary" icon={Plus}>
      New job
    </Button>
  );

  let body;
  if (isLoading) body = <SkeletonRows rows={4} className="card p-5" />;
  else if (error)
    body = (
      <div className="card">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  else if (!jobs.length)
    body = (
      <div className="card">
        {filtered ? (
          <EmptyState
            icon={SearchX}
            title="No jobs match"
            description="Try a different search or status."
            action={
              <Button
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Briefcase} title={`No jobs for ${client.name} yet`} description="Create a job for a campaign, event or project, then add AI tasks to it." action={newJob} />
        )}
      </div>
    );
  else
    body = (
      <Table>
        <thead>
          <tr>
            <Th>Job</Th>
            <Th>Status</Th>
            <Th>Tasks</Th>
            <Th>Drafts</Th>
            <Th>Approved</Th>
            <Th>Deadline</Th>
            <Th>Updated</Th>
            <Th>
              <span className="sr-only">Open</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="cursor-pointer transition-colors hover:bg-canvas/60" onClick={() => navigate(`/jobs/${j.id}`)}>
              <Td className="max-w-[320px]">
                <Link to={`/jobs/${j.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-ink hover:text-brand focus-ring rounded">
                  {j.title}
                </Link>
                {j.description && <span className="block truncate text-xs text-muted">{j.description}</span>}
              </Td>
              <Td>
                <JobStatusBadge status={j.status} />
              </Td>
              <Td className="min-w-[120px]">
                <span className="text-[13px] tabular-nums text-ink">
                  {j.doneTaskCount}/{j.taskCount} <span className="text-xs text-muted">done</span>
                </span>
                <ProgressBar value={j.doneTaskCount} max={j.taskCount || 1} tone="success" className="mt-1.5 w-20" label={`${j.doneTaskCount} of ${j.taskCount} tasks done`} />
              </Td>
              <Td className="tabular-nums">{j.draftCount ? <span className="font-medium text-warning">{j.draftCount}</span> : <span className="text-muted">0</span>}</Td>
              <Td className="tabular-nums">{j.approvedCount ? <span className="font-medium text-success">{j.approvedCount}</span> : <span className="text-muted">0</span>}</Td>
              <Td className="whitespace-nowrap text-muted">{j.deadline ? formatDate(j.deadline) : '—'}</Td>
              <Td className="whitespace-nowrap text-muted">{timeAgo(j.updatedAt)}</Td>
              <Td className="text-right">
                <Button as={Link} to={`/jobs/${j.id}`} size="icon-xs" variant="ghost" icon={ArrowUpRight} aria-label={`Open ${j.title}`} onClick={(e) => e.stopPropagation()} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    );

  return (
    <div>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search this client’s jobs…" className="w-full sm:w-72" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={JOB_STATUSES.map((s) => ({ value: s.id, label: s.label }))} />
        <div className="ml-auto flex items-center gap-3">
          {!isLoading && !error && <ResultCount count={jobs.length} noun="job" showClear={filtered} onClear={() => { setSearch(''); setStatus('all'); }} />}
          {newJob}
        </div>
      </Toolbar>
      {body}
    </div>
  );
}
