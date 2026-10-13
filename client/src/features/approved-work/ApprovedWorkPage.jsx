import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData } from '@tanstack/react-query';
import { BadgeCheck, SearchX } from 'lucide-react';
import { Button, EmptyState, ErrorState, FilterSelect, Page, PageHeader, ResultCount, SearchInput, Select, SkeletonCards, SkeletonRows, Toolbar, ViewToggle } from '@/components/ui';
import { OutputHistoryDialog } from '@/components/approvals';
import { ContextFilters, useUrlFilters, useViewPreference } from '@/components/files';
import { useApproved, useBreadcrumbs, useDebounce, usePageTitle, useUsers } from '@/hooks';
import { DATE_RANGES } from '@/lib/constants';
import { ApprovedGrid, ApprovedTable } from './components/ApprovedViews';

const DEFAULTS = { q: '', clientId: 'all', jobId: 'all', taskId: 'all', kind: 'all', dateRange: 'all', approvedBy: 'all', sort: 'approved' };

const SORTS = [
  { value: 'approved', label: 'Sort: Recently approved' },
  { value: 'title', label: 'Sort: Title (A–Z)' },
  { value: 'client', label: 'Sort: Client (A–Z)' },
];

export default function ApprovedWorkPage() {
  useBreadcrumbs([{ label: 'Approved Work' }]);
  usePageTitle('Approved Work');
  const { values, set, reset, isFiltered } = useUrlFilters(DEFAULTS);
  const [view, setView] = useViewPreference('approved');
  const [history, setHistory] = useState({ open: false, outputId: null, versionId: null });
  const search = useDebounce(values.q.trim(), 200);
  const { data: users = [] } = useUsers();

  const { data: outputs = [], isLoading, error, refetch, isPlaceholderData } = useApproved(
    {
      search: search || undefined,
      clientId: values.clientId,
      jobId: values.jobId,
      taskId: values.taskId,
      kind: values.kind,
      approvedBy: values.approvedBy,
      dateRange: values.dateRange,
      sort: values.sort,
    },
    { placeholderData: keepPreviousData },
  );
  const filtered = isFiltered(['sort']);
  const openHistory = (o) => setHistory({ open: true, outputId: o.id, versionId: o.approvedVersionId });

  return (
    <Page wide>
      <PageHeader
        title="Approved Work"
        description="Every explicitly approved output, ready to download or reuse. Newer drafts never replace an approved version until they’re approved themselves."
        actions={
          <Button as={Link} to="/files?status=approved">
            View in Files
          </Button>
        }
      />

      <Toolbar>
        <SearchInput value={values.q} onChange={(q) => set({ q })} placeholder="Search titles and approved content…" className="w-full sm:w-72" ariaLabel="Search approved work" />
        <ContextFilters clientId={values.clientId} jobId={values.jobId} taskId={values.taskId} onChange={set} />
        <FilterSelect
          label="Type"
          value={values.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: 'image', label: 'Images' },
            { value: 'text', label: 'Text' },
          ]}
        />
        <FilterSelect label="Approved" allLabel="Any time" value={values.dateRange} onChange={(dateRange) => set({ dateRange })} options={DATE_RANGES.filter((d) => d.id !== 'all').map((d) => ({ value: d.id, label: d.label }))} />
        <FilterSelect label="Approved by" allLabel="Anyone" value={values.approvedBy} onChange={(approvedBy) => set({ approvedBy })} options={users.map((u) => ({ value: u.id, label: u.name }))} />
        <div className="ml-auto flex items-center gap-2">
          <Select size="sm" aria-label="Sort approved work" value={values.sort} onChange={(e) => set({ sort: e.target.value })} options={SORTS} className="min-w-[190px]" />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </Toolbar>

      <div className="mb-4">
        <ResultCount count={outputs.length} noun="approved output" showClear={filtered} onClear={() => reset(['sort'])} />
      </div>

      <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {isLoading ? (
          view === 'grid' ? (
            <SkeletonCards count={8} className="lg:grid-cols-3 2xl:grid-cols-4" />
          ) : (
            <div className="card p-5">
              <SkeletonRows rows={6} />
            </div>
          )
        ) : error ? (
          <div className="card">
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : outputs.length === 0 ? (
          <div className="card">
            {filtered ? (
              <EmptyState
                icon={SearchX}
                title="No approved work matches"
                description="Try another search term, widen the date range or clear the filters."
                action={<Button onClick={() => reset(['sort'])}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={BadgeCheck}
                title="Nothing approved yet"
                description="When a version of an output is marked approved in the AI workspace or Files, it appears here for quick retrieval."
                action={
                  <Button as={Link} to="/ai-workspace" variant="primary">
                    Go to AI workspace
                  </Button>
                }
              />
            )}
          </div>
        ) : view === 'grid' ? (
          <ApprovedGrid outputs={outputs} onHistory={openHistory} />
        ) : (
          <ApprovedTable outputs={outputs} onHistory={openHistory} />
        )}
      </div>

      <OutputHistoryDialog open={history.open} onClose={() => setHistory((h) => ({ ...h, open: false }))} outputId={history.outputId} initialVersionId={history.versionId} />
    </Page>
  );
}
