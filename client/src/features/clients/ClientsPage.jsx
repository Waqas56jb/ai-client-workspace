import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, SearchX } from 'lucide-react';
import { Button, EmptyState, ErrorState, Page, PageHeader, ResultCount, SearchInput, Select, SkeletonCards, SkeletonRows, Table, Th, Toolbar, ViewToggle } from '@/components/ui';
import { useBreadcrumbs, useClients, useDebounce, usePageTitle } from '@/hooks';
import { useUiStore } from '@/store/uiStore';
import { CLIENT_STATUSES } from '@/lib/constants';
import { ClientCard, ClientRow } from './components/ClientCard';
import { useClientActions } from './components/useClientActions';

const STATUS_OPTIONS = [
  { value: 'current', label: 'Status: Active & prospects' },
  ...CLIENT_STATUSES.map((s) => ({ value: s.id, label: `Status: ${s.label}` })),
  { value: 'all', label: 'Status: All (incl. archived)' },
];

const SORT_OPTIONS = [
  { value: 'recent', label: 'Sort: Recent activity' },
  { value: 'name', label: 'Sort: Name (A–Z)' },
  { value: 'created', label: 'Sort: Newest first' },
  { value: 'jobs', label: 'Sort: Most jobs' },
];

export default function ClientsPage() {
  useBreadcrumbs([{ label: 'Clients' }]);
  usePageTitle('Clients');

  const view = useUiStore((s) => s.views.clients || 'grid');
  const setView = useUiStore((s) => s.setView);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('current');
  const [sort, setSort] = useState('recent');
  const debounced = useDebounce(search.trim(), 200);

  const params = {
    search: debounced || undefined,
    sort,
    ...(status === 'all' ? { includeArchived: true } : status === 'current' ? {} : { status }),
  };
  const { data: clients, isLoading, error, refetch } = useClients(params);
  const actions = useClientActions();

  const filtered = !!debounced || status !== 'current';
  const clear = () => {
    setSearch('');
    setStatus('current');
  };

  let body;
  if (isLoading) {
    body = view === 'grid' ? <SkeletonCards count={6} /> : <SkeletonRows rows={6} className="card p-5" />;
  } else if (error) {
    body = (
      <div className="card">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  } else if (!clients.length) {
    body = (
      <div className="card">
        {filtered ? (
          <EmptyState
            icon={SearchX}
            title="No clients match"
            description={debounced ? `Nothing matches “${debounced}” with the current filters.` : 'No clients have this status.'}
            action={<Button onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={Building2}
            title="No clients yet"
            description="Add your first client to set up their brand profile, jobs and AI tasks in one place."
            action={
              <Button as={Link} to="/clients/new" variant="primary" icon={Plus}>
                New client
              </Button>
            }
          />
        )}
      </div>
    );
  } else if (view === 'grid') {
    body = (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {clients.map((c) => (
          <ClientCard key={c.id} client={c} onRemove={actions.requestRemove} onRestore={actions.restore} />
        ))}
      </div>
    );
  } else {
    body = (
      <Table>
        <thead>
          <tr>
            <Th>Client</Th>
            <Th>Industry</Th>
            <Th>Status</Th>
            <Th>Jobs</Th>
            <Th>Tasks</Th>
            <Th>Last activity</Th>
            <Th>Brand</Th>
            <Th className="text-right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <ClientRow key={c.id} client={c} onRemove={actions.requestRemove} onRestore={actions.restore} />
          ))}
        </tbody>
      </Table>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Clients"
        description="Every client keeps its own brand profile, reference files, jobs and AI work — separate from every other client."
        actions={
          <Button as={Link} to="/clients/new" variant="primary" icon={Plus}>
            New client
          </Button>
        }
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients by name…" className="w-full sm:w-72" ariaLabel="Search clients" />
        <Select size="sm" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} className="min-w-[200px] flex-1 sm:flex-none" />
        <Select size="sm" aria-label="Sort clients" value={sort} onChange={(e) => setSort(e.target.value)} options={SORT_OPTIONS} className="min-w-[180px] flex-1 sm:flex-none" />
        <div className="ml-auto flex items-center gap-3">
          {!isLoading && !error && <ResultCount count={clients.length} noun="client" showClear={filtered} onClear={clear} />}
          <ViewToggle value={view} onChange={(v) => setView('clients', v)} />
        </div>
      </Toolbar>

      {body}
      {actions.dialog}
    </Page>
  );
}
