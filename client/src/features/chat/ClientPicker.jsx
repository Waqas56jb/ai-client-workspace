import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export function clientColor(client) {
  return client?.brand?.primaryColor || client?.primaryColor || '#6257e8';
}

export function ClientDot({ client, className }) {
  return <span className={cn('inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-surface', className)} style={{ background: clientColor(client) }} aria-hidden />;
}

/**
 * Big, obvious "which client is this for?" control with a searchable list.
 * Keyboard: ↑ ↓ to move, Enter to choose, Escape to close, type to search.
 */
export function ClientPicker({ clients, loading, error, value, onChange, onRetry, className, compact = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const listId = useId();
  const selected = clients.find((c) => c.id === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.max(r.width, 280);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width, maxHeight: Math.max(220, window.innerHeight - r.bottom - 24) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActive(Math.max(0, clients.findIndex((c) => c.id === value)));
    const onDown = (e) => !pop.current?.contains(e.target) && !btn.current?.contains(e.target) && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
    };
  }, [open, clients, value]);

  const choose = (c) => {
    setOpen(false);
    btn.current?.focus();
    if (c && c.id !== value) onChange(c.id);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Client: ${selected.name}. Change client` : 'Choose a client'}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border bg-surface text-left transition-colors focus-ring',
          compact ? 'min-h-11 px-3 py-2' : 'min-h-14 px-3.5 py-2.5',
          selected ? 'border-line hover:border-line-strong' : 'border-brand/50 bg-brand-soft/50 hover:bg-brand-soft',
          className,
        )}
      >
        {selected ? <ClientDot client={selected} className="h-3.5 w-3.5" /> : <Users size={18} className="shrink-0 text-brand" aria-hidden />}
        <span className="min-w-0 flex-1">
          {!compact && <span className="block text-[13px] font-medium leading-4 text-muted">Client</span>}
          <span className={cn('block truncate font-semibold text-ink', compact ? 'text-[15px]' : 'text-[16px] leading-6')}>
            {selected ? selected.name : loading ? 'Loading clients…' : 'Choose a client'}
          </span>
        </span>
        <ChevronDown size={18} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={pop} className="fixed z-[95] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            <label className="flex items-center gap-2 border-b border-line px-3.5">
              <Search size={17} className="shrink-0 text-muted" aria-hidden />
              <span className="sr-only">Search clients</span>
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                placeholder="Search clients…"
                role="combobox"
                aria-controls={listId}
                aria-expanded="true"
                aria-activedescendant={shown[active] ? `${listId}-${shown[active].id}` : undefined}
                className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-subtle"
              />
            </label>
            <ul id={listId} role="listbox" aria-label="Clients" className="overflow-y-auto p-1.5 scrollbar-thin" style={{ maxHeight: Math.min(360, pos.maxHeight) }}>
              {error ? (
                <li className="px-3 py-4 text-[15px] text-muted">
                  Clients could not be loaded.{' '}
                  <button type="button" onClick={onRetry} className="font-semibold text-brand underline focus-ring">
                    Try again
                  </button>
                </li>
              ) : loading ? (
                <li className="px-3 py-4 text-[15px] text-muted">Loading clients…</li>
              ) : !shown.length ? (
                <li className="px-3 py-4 text-[15px] text-muted">{clients.length ? 'No client matches that name.' : 'No clients yet. Add one under More → Clients.'}</li>
              ) : (
                shown.map((c, i) => (
                  <li
                    key={c.id}
                    id={`${listId}-${c.id}`}
                    role="option"
                    aria-selected={c.id === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(c)}
                    className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-[15.5px] text-ink', i === active && 'bg-canvas')}
                  >
                    <ClientDot client={c} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.id === value && <Check size={17} className="text-brand" aria-hidden />}
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
