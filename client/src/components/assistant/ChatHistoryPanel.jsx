import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { CalendarDays, History, ImageIcon, Mail, Plus, Search, X } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { useChatHistory, useDebounce } from '@/hooks';
import { dayRange, groupByRecency, shortWhen } from '@/lib/chatDates';
import { cn } from '@/lib/utils';

/**
 * AI Assistant sidebar: New chat, search, "pick a date" and the chat history
 * grouped by date (Today, Yesterday, Previous 7 days, months…).
 */
export function ChatHistoryPanel({ activeId, onNewChat, className }) {
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const q = useDebounce(search.trim(), 250);
  const params = useMemo(() => ({ search: q || undefined, ...dayRange(date), limit: 100 }), [q, date]);
  const { data, isLoading, isError } = useChatHistory(params);
  const groups = useMemo(() => groupByRecency(data?.items || []), [data]);
  const filtered = !!q || !!date;

  return (
    <div className={cn('flex h-full flex-col bg-surface', className)}>
      <div className="space-y-3 border-b border-line p-4">
        <Button variant="primary" icon={Plus} className="w-full justify-center" size="lg" onClick={onNewChat}>
          New chat
        </Button>
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-subtle focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <CalendarDays size={16} aria-hidden />
          <span className="shrink-0">Date</span>
          <input
            type="date"
            value={date}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Show chats from a date"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 text-[13px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
          {date && (
            <button type="button" onClick={() => setDate('')} className="rounded p-1 text-subtle hover:text-ink focus-ring" aria-label="Clear date">
              <X size={15} />
            </button>
          )}
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 scrollbar-thin" aria-label="Chat history">
        {isLoading ? (
          <div className="space-y-2 px-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">Chat history could not be loaded.</p>
        ) : !groups.length ? (
          <p className="px-3 py-6 text-center text-[13px] leading-5 text-muted">
            {filtered ? 'No chats match. Try another word or date.' : 'Your chats will appear here. Start one with “New chat”.'}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-4">
              <h3 className="px-3 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.label}</h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/assistant/c/${c.id}`}
                      aria-current={c.id === activeId ? 'page' : undefined}
                      className={cn(
                        'group flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors focus-ring',
                        c.id === activeId ? 'bg-brand-soft text-ink' : 'hover:bg-canvas',
                      )}
                    >
                      {c.tool === 'image' ? (
                        <ImageIcon size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                      ) : (
                        <Mail size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium leading-5 text-ink">{c.title}</span>
                        <span className="block truncate text-[12px] leading-4 text-muted">
                          {c.client?.name} · {shortWhen(c.lastActivityAt || c.updatedAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <div className="border-t border-line p-3">
        <Link to="/history" className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium text-brand hover:bg-brand-soft focus-ring">
          <History size={16} aria-hidden />
          All chat history
        </Link>
      </div>
    </div>
  );
}
