import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronRight, History, ImageIcon, Mail, MessageSquareText, Plus, Search, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, Page, PageHeader, Select, Skeleton } from '@/components/ui';
import { ClientLogo } from '@/components/data-display';
import { useBreadcrumbs, useChatHistory, useClients, useDebounce, usePageTitle } from '@/hooks';
import { dayRange, groupByDay, monthRange, MONTHS, recentYears } from '@/lib/chatDates';

/**
 * Every AI chat in the workspace, grouped by day. Find a chat by words in it,
 * by client, by type, or by the exact day / month and year it happened.
 */
export default function ChatHistoryPage() {
  usePageTitle('Chat history');
  useBreadcrumbs([{ label: 'Chat history' }]);
  const clientsQ = useClients();
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [tool, setTool] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 250);

  const range = day ? dayRange(day) : monthRange(year, month);
  const params = useMemo(
    () => ({ search: q || undefined, clientId: clientId || undefined, tool: tool || undefined, ...range, page, limit: 50 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, clientId, tool, day, year, month, page],
  );
  const { data, isLoading, isFetching, error, refetch } = useChatHistory(params);
  const items = data?.items || [];
  const meta = data?.meta;
  const groups = useMemo(() => groupByDay(items), [items]);
  const filtered = !!(q || clientId || tool || day || year);

  const reset = () => {
    setSearch('');
    setClientId('');
    setTool('');
    setDay('');
    setYear('');
    setMonth('');
    setPage(1);
  };
  const change = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };

  return (
    <Page>
      <PageHeader
        title="Chat history"
        description="Every email, message and image you created with the AI — find any chat by words, client or date."
        actions={
          <Button as={Link} to="/" variant="primary" icon={Plus}>
            New chat
          </Button>
        }
      />

      <div className="card mb-5 grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1fr_1.1fr_1fr_1fr]">
        <label className="relative block md:col-span-2 xl:col-span-1">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Search</span>
          <Search size={16} className="pointer-events-none absolute bottom-2.5 left-3 text-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={change(setSearch)}
            placeholder="Words in the chat or email…"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-subtle focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Client</span>
          <Select value={clientId} onChange={change(setClientId)} options={(clientsQ.data || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="All clients" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Type</span>
          <Select
            value={tool}
            onChange={change(setTool)}
            placeholder="All types"
            options={[
              { value: 'writing', label: 'Messages' },
              { value: 'image', label: 'Images' },
              { value: 'advertising', label: 'Ad copy' },
              { value: 'vehicle', label: 'Vehicle listings' },
            ]}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Exact day</span>
          <input
            type="date"
            value={day}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={(e) => {
              setDay(e.target.value);
              setYear('');
              setMonth('');
              setPage(1);
            }}
            className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[14px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Month</span>
          <Select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              if (e.target.value && !year) setYear(String(new Date().getFullYear()));
              setDay('');
              setPage(1);
            }}
            options={MONTHS}
            placeholder="Any month"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Year</span>
          <Select
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              if (!e.target.value) setMonth('');
              setDay('');
              setPage(1);
            }}
            options={recentYears()}
            placeholder="Any year"
          />
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-muted" aria-live="polite">
          {isLoading ? 'Loading…' : `${meta?.total ?? items.length} chat${(meta?.total ?? items.length) === 1 ? '' : 's'}${filtered ? ' found' : ''}`}
          {isFetching && !isLoading ? ' · updating…' : ''}
        </p>
        {filtered && (
          <Button size="sm" variant="ghost" icon={X} onClick={reset}>
            Clear filters
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={filtered ? Search : History}
          title={filtered ? 'No chats match these filters' : 'No chats yet'}
          description={filtered ? 'Try another word, client or date.' : 'Start a chat in the AI Assistant — it will be saved here automatically.'}
          action={
            filtered ? (
              <Button onClick={reset}>Clear filters</Button>
            ) : (
              <Button as={Link} to="/" variant="primary" icon={Plus}>
                New chat
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.label}</h2>
              <ul className="card divide-y divide-line overflow-hidden">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <Link to={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-canvas focus-ring">
                      <ClientLogo client={c.client} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {c.tool === 'image' ? <ImageIcon size={15} className="shrink-0 text-subtle" aria-hidden /> : <Mail size={15} className="shrink-0 text-subtle" aria-hidden />}
                          <span className="truncate text-[15px] font-semibold text-ink">{c.title}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-muted">
                          {c.client?.name}
                          {c.task?.title && c.task.title !== 'AI Assistant chats' ? ` · ${c.task.title}` : ''}
                          {c.lastMessage?.content ? ` — ${c.lastMessage.content}` : ''}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-right sm:block">
                        <span className="block text-[13px] font-medium tabular-nums text-ink">{format(new Date(c.lastActivityAt || c.updatedAt), 'HH:mm')}</span>
                        <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                          <MessageSquareText size={12} aria-hidden />
                          {c.messageCount}
                        </span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {meta && meta.pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Newer
              </Button>
              <span className="text-[13px] text-muted">
                Page {page} of {meta.pages}
              </span>
              <Button size="sm" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>
                Older
              </Button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
