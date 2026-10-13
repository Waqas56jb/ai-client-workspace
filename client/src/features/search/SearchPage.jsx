import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Command, Loader2, Search, SearchX, X } from 'lucide-react';
import { ApprovalBadge, Badge, Button, EmptyState, ErrorState, FilterSelect, Kbd, Page, PageHeader, SkeletonRows, Tabs, TabPanel, Toolbar } from '@/components/ui';
import { ClientStatusBadge, JobStatusBadge, TaskTypeBadge } from '@/components/data-display/Entities';
import { Highlight, resultIcon } from '@/components/layout/CommandPalette';
import { ContextFilters, DemoNote, FILE_STATUS_OPTIONS, useUrlFilters } from '@/components/files';
import { useBreadcrumbs, useDebounce, usePageTitle } from '@/hooks';
import { searchService, SEARCH_GROUPS } from '@/services';
import { useUiStore } from '@/store/uiStore';
import { DATE_RANGES, FILE_KINDS } from '@/lib/constants';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

const DEFAULTS = { q: '', type: 'all', clientId: 'all', jobId: 'all', taskId: 'all', dateRange: 'all', fileKind: 'all', approval: 'all' };
const TYPE_LABELS = { client: 'Client', job: 'Job', task: 'Task', conversation: 'Conversation', file: 'File', approved: 'Approved output' };
const SUGGESTIONS = ['Cup 2026', 'Register now', 'warranty', 'EV showroom', 'winter menu'];
const GROUP_PREVIEW = 5;

function ResultStatus({ r }) {
  if (r.type === 'file' || r.type === 'approved') return <ApprovalBadge status={r.status} />;
  if (r.type === 'client') return <ClientStatusBadge status={r.status} />;
  if (r.type === 'job') return <JobStatusBadge status={r.status} />;
  if (r.type === 'task') return <TaskTypeBadge type={r.kind} />;
  return null;
}

function ResultItem({ r, q }) {
  const Icon = resultIcon(r);
  return (
    <li>
      <Link to={r.href} className="group flex items-start gap-3.5 rounded-xl px-3 py-3 transition-colors hover:bg-canvas focus-ring">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted group-hover:border-brand/25 group-hover:text-brand">
          <Icon size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-[14px] font-semibold text-ink group-hover:text-brand">
              <Highlight text={r.title} query={q} />
            </span>
            <ResultStatus r={r} />
          </span>
          {r.breadcrumb && <span className="mt-0.5 block truncate text-xs text-muted">{r.breadcrumb}</span>}
          {r.excerpt && (
            <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-ink/80">
              <Highlight text={r.excerpt} query={q} />
            </span>
          )}
        </span>
        <span className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
          <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">{TYPE_LABELS[r.type]}</span>
          {r.date && (
            <time dateTime={r.date} title={formatDateTime(r.date)} className="text-xs text-muted">
              {timeAgo(r.date)}
            </time>
          )}
        </span>
      </Link>
    </li>
  );
}

function ResultGroup({ group, items, q, limit, onShowAll }) {
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <section className="card overflow-hidden" aria-labelledby={`group-${group.id}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 id={`group-${group.id}`} className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {group.label}
          <span className="rounded-full bg-[#EEF0F6] px-1.5 text-[11px] font-medium text-muted">{items.length}</span>
        </h2>
        {limit && items.length > limit && (
          <Button size="xs" variant="ghost" iconRight={ArrowRight} onClick={onShowAll}>
            Show all {items.length}
          </Button>
        )}
      </div>
      <ul className="p-2">
        {shown.map((r) => (
          <ResultItem key={`${r.type}-${r.id}`} r={r} q={q} />
        ))}
      </ul>
    </section>
  );
}

export default function SearchPage() {
  const { values, set, reset, isFiltered } = useUrlFilters(DEFAULTS);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const [input, setInput] = useState(values.q);
  const written = useRef(values.q);
  const inputRef = useRef(null);
  const debounced = useDebounce(input, 250);

  // Push typed text into ?q= (debounced) …
  useEffect(() => {
    if (debounced !== values.q) {
      written.current = debounced;
      set({ q: debounced });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // … and pick up external changes (e.g. the command palette "See all results").
  useEffect(() => {
    if (values.q !== written.current) {
      written.current = values.q;
      setInput(values.q);
    }
  }, [values.q]);

  const q = values.q.trim();
  useBreadcrumbs([{ label: 'Search' }]);
  usePageTitle(q ? `Search: ${q}` : 'Search');

  const filters = { clientId: values.clientId, jobId: values.jobId, taskId: values.taskId, dateRange: values.dateRange, fileKind: values.fileKind, approval: values.approval };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['search', q, filters],
    queryFn: () => searchService.search(q, filters),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });

  const counts = useMemo(() => Object.fromEntries(SEARCH_GROUPS.map((g) => [g.id, data?.[g.id]?.length || 0])), [data]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tab = SEARCH_GROUPS.some((g) => g.id === values.type) ? values.type : 'all';
  const tabs = [{ id: 'all', label: 'All', count: total }, ...SEARCH_GROUPS.map((g) => ({ id: g.id, label: g.label, count: counts[g.id] }))];
  const filtered = isFiltered(['q', 'type']);
  const fileOnly = values.fileKind !== 'all' || values.approval !== 'all';

  const submit = (e) => {
    e.preventDefault();
    written.current = input;
    set({ q: input });
  };

  const clearAll = () => {
    reset(['q']);
  };

  let body;
  if (!q) {
    body = (
      <div className="card">
        <EmptyState
          icon={Search}
          title="Search across your whole workspace"
          description="Find clients, jobs, tasks, AI conversations, files and approved outputs. Matching text is highlighted in each result."
          action={
            <Button icon={Command} onClick={() => setCommandOpen(true)}>
              Quick search
              <span className="ml-1 inline-flex items-center gap-0.5">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </Button>
          }
        />
        <div className="mx-auto max-w-xl px-6 pb-10">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Try searching for</p>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setInput(s);
                  written.current = s;
                  set({ q: s });
                }}
                className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink shadow-card transition-colors hover:border-brand/40 hover:text-brand focus-ring"
              >
                {s}
              </button>
            ))}
          </div>
          <ul className="mt-6 space-y-1.5 text-[13px] text-muted">
            <li>• Search matches names, descriptions, message content and the text of generated outputs.</li>
            <li>• Narrow results with the client, job and task filters — they cascade from client to task.</li>
            <li>• File type and approval status filters limit results to Files and Approved outputs.</li>
            <li>
              • Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> (<Kbd>⌘</Kbd> <Kbd>K</Kbd> on Mac) anywhere to jump straight to a result.
            </li>
          </ul>
        </div>
      </div>
    );
  } else if (isLoading) {
    body = (
      <div className="card p-5">
        <SkeletonRows rows={6} />
      </div>
    );
  } else if (error) {
    body = (
      <div className="card">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  } else if (total === 0) {
    body = (
      <div className="card">
        <EmptyState
          icon={SearchX}
          title={`No results for “${q}”`}
          description={filtered ? 'Nothing matches with the current filters. Try clearing them or using a broader term.' : 'Check the spelling or try a broader term — search looks at names, descriptions, messages and output text.'}
          action={filtered ? <Button onClick={clearAll}>Clear filters</Button> : <Button onClick={() => setCommandOpen(true)}>Open quick search</Button>}
        />
      </div>
    );
  } else {
    const visibleGroups = SEARCH_GROUPS.filter((g) => (tab === 'all' ? counts[g.id] > 0 : g.id === tab));
    body = (
      <TabPanel className={cn('space-y-4 transition-opacity', isFetching && 'opacity-70')}>
        {visibleGroups.map((g) =>
          counts[g.id] ? (
            <ResultGroup key={g.id} group={g} items={data[g.id]} q={q} limit={tab === 'all' ? GROUP_PREVIEW : null} onShowAll={() => set({ type: g.id })} />
          ) : (
            <div key={g.id} className="card">
              <EmptyState compact icon={SearchX} title={`No ${g.label.toLowerCase()} match “${q}”`} action={<Button size="sm" onClick={() => set({ type: 'all' })}>Show all results</Button>} />
            </div>
          ),
        )}
      </TabPanel>
    );
  }

  return (
    <Page>
      <PageHeader title="Search" description="Search clients, jobs, tasks, conversations, files and approved outputs." />

      <form onSubmit={submit} role="search" className="mb-4">
        <div className="relative">
          {isFetching && q ? (
            <Loader2 size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 animate-spin text-brand" aria-hidden />
          ) : (
            <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          )}
          <input
            ref={inputRef}
            type="search"
            value={input}
            autoFocus
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search for a client, campaign, phrase, file name…"
            aria-label="Search the workspace"
            className="h-14 w-full rounded-xl border border-line bg-surface pl-12 pr-12 text-[16px] text-ink shadow-card outline-none transition-colors placeholder:text-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 [&::-webkit-search-cancel-button]:hidden"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput('');
                written.current = '';
                set({ q: '', type: 'all' });
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtle hover:bg-canvas hover:text-ink focus-ring"
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </form>

      <Toolbar className="mb-3">
        <ContextFilters clientId={values.clientId} jobId={values.jobId} taskId={values.taskId} onChange={set} />
        <FilterSelect label="Date" allLabel="Any time" value={values.dateRange} onChange={(dateRange) => set({ dateRange })} options={DATE_RANGES.filter((d) => d.id !== 'all').map((d) => ({ value: d.id, label: d.label }))} />
        <FilterSelect label="File type" value={values.fileKind} onChange={(fileKind) => set({ fileKind })} options={FILE_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        <FilterSelect label="Approval" value={values.approval} onChange={(approval) => set({ approval })} options={FILE_STATUS_OPTIONS} />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clearAll}>
            Clear filters
          </Button>
        )}
      </Toolbar>
      {fileOnly && (
        <p className="mb-3 text-xs text-muted">
          <Badge tone="info" className="mr-1.5">
            Note
          </Badge>
          File type and approval filters only apply to Files and Approved outputs, so other groups are hidden.
        </p>
      )}

      {q && total > 0 && <Tabs tabs={tabs} value={tab} onChange={(type) => set({ type })} className="mb-4" ariaLabel="Result groups" />}

      {body}

      {isMockMode && <DemoNote className="mt-6">Search runs over the demo data in this browser. Full-text search across persisted conversations and files arrives with the backend.</DemoNote>}
    </Page>
  );
}
