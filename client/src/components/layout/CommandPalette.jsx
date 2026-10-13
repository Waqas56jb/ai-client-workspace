import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, CornerDownLeft, FileText, FolderKanban, ListChecks, Loader2, MessageSquare, Search, Users, FileImage } from 'lucide-react';
import { Kbd } from '@/components/ui';
import { NAV_SECTIONS } from './navigation';
import { searchService, SEARCH_GROUPS } from '@/services';
import { useDebounce, useHotkey } from '@/hooks';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

export const RESULT_ICONS = {
  client: Users,
  job: FolderKanban,
  task: ListChecks,
  conversation: MessageSquare,
  file: FileText,
  approved: BadgeCheck,
};

export function resultIcon(r) {
  if (r.type === 'file' && r.kind === 'image') return FileImage;
  return RESULT_ICONS[r.type] || Search;
}

/** Highlights occurrences of `query` inside `text`. */
export function Highlight({ text = '', query = '' }) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-brand-soft px-0.5 text-brand">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

/** Ctrl/⌘+K command palette over the workspace search service. */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const q = useDebounce(query.trim(), 120);

  useHotkey('mod+k', (e) => {
    e.preventDefault();
    setOpen(!useUiStore.getState().commandOpen);
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['palette-search', q],
    queryFn: () => searchService.search(q, { limit: 5 }),
    enabled: open && q.length > 0,
    placeholderData: (prev) => prev,
  });

  const flat = useMemo(() => {
    if (!q) {
      return NAV_SECTIONS.flatMap((s) => s.items).map((i) => ({ type: 'page', id: i.to, title: i.label, href: i.to, icon: i.icon, group: 'Go to' }));
    }
    const list = [];
    SEARCH_GROUPS.forEach((g) => (data?.[g.id] || []).forEach((r) => list.push({ ...r, group: g.label })));
    return list;
  }, [q, data]);

  useEffect(() => setActive(0), [q]);

  const go = (item) => {
    if (!item) return;
    setOpen(false);
    navigate(item.href);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active === flat.length && q) {
        setOpen(false);
        navigate(`/search?q=${encodeURIComponent(q)}`);
      } else go(flat[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastGroup = null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[85] flex items-start justify-center px-3 pt-[10vh]">
          <motion.div className="absolute inset-0 bg-[#17182B]/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="relative w-full max-w-[640px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              {isFetching ? <Loader2 size={18} className="animate-spin text-brand" aria-hidden /> : <Search size={18} className="text-subtle" aria-hidden />}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search clients, jobs, tasks, conversations, files…"
                className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-activedescendant={`palette-item-${active}`}
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} id="palette-results" role="listbox" className="max-h-[56vh] overflow-y-auto p-2 scrollbar-thin">
              {q && !isFetching && flat.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-muted">No results for “{q}”.</p>}
              {flat.map((item, idx) => {
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                const Icon = item.icon || resultIcon(item);
                return (
                  <div key={`${item.type}-${item.id}`}>
                    {header && <p className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle first:pt-1">{header}</p>}
                    <button
                      type="button"
                      id={`palette-item-${idx}`}
                      data-idx={idx}
                      role="option"
                      aria-selected={active === idx}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => go(item)}
                      className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', active === idx ? 'bg-brand-soft' : 'hover:bg-canvas')}
                    >
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border', active === idx ? 'border-brand/20 bg-surface text-brand' : 'border-line bg-canvas text-muted')}>
                        <Icon size={15} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">
                          <Highlight text={item.title} query={q} />
                        </span>
                        {(item.breadcrumb || item.excerpt) && (
                          <span className="block truncate text-xs text-muted">
                            {item.breadcrumb}
                            {item.excerpt && item.breadcrumb ? ' — ' : ''}
                            {item.excerpt && <Highlight text={item.excerpt} query={q} />}
                          </span>
                        )}
                      </span>
                      {active === idx && <CornerDownLeft size={14} className="text-brand" aria-hidden />}
                    </button>
                  </div>
                );
              })}
              {q && (
                <button
                  type="button"
                  data-idx={flat.length}
                  onMouseMove={() => setActive(flat.length)}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/search?q=${encodeURIComponent(q)}`);
                  }}
                  className={cn('mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium text-brand', active === flat.length ? 'bg-brand-soft' : 'hover:bg-canvas')}
                >
                  <Search size={15} aria-hidden /> See all results with filters for “{q}” <ArrowRight size={14} className="ml-auto" aria-hidden />
                </button>
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-line bg-canvas/60 px-4 py-2 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto">{isMockMode ? 'Searching demo data in this browser' : 'Searching the workspace'}</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
