import { useId, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Accessible tabs (controlled). tabs: [{ id, label, icon?, count? }]
 * Render panels yourself using `value`; wrap them in <TabPanel> for aria wiring.
 */
export function Tabs({ tabs, value, onChange, className, variant = 'underline', ariaLabel = 'Sections' }) {
  const baseId = useId();
  const listRef = useRef(null);
  const onKey = (e) => {
    const idx = tabs.findIndex((t) => t.id === value);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
    if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
    if (e.key === 'Home') next = tabs[0];
    if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) {
      e.preventDefault();
      onChange(next.id);
      listRef.current?.querySelector(`[data-tab="${next.id}"]`)?.focus();
    }
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={cn(
        'flex max-w-full items-center overflow-x-auto scrollbar-thin',
        variant === 'underline' ? 'gap-5 border-b border-line' : 'gap-1 rounded-lg border border-line bg-canvas p-0.5',
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            id={`${baseId}-${t.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              variant === 'underline'
                ? cn('-mb-px border-b-2 py-2.5', active ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')
                : cn('h-8 rounded-md px-3', active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'),
            )}
          >
            {Icon && <Icon size={15} aria-hidden />}
            {t.label}
            {t.count != null && <span className={cn('rounded-full px-1.5 text-[11px]', active ? 'bg-brand-soft text-brand' : 'bg-[#EEF0F6] text-muted')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ children, className }) {
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}

/** Lightweight CSS tooltip (shows on hover and keyboard focus). */
export function Tooltip({ content, children, side = 'top', className }) {
  if (!content) return children;
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-[95] w-max max-w-[260px] whitespace-normal rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-pop transition-opacity delay-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
          side === 'bottom' && 'top-full left-1/2 mt-1.5 -translate-x-1/2',
          side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
          side === 'left' && 'right-full top-1/2 mr-2 -translate-y-1/2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
