import { motion } from 'framer-motion';
import { AlertCircle, LayoutGrid, List, RotateCw, Search, X } from 'lucide-react';
import { Button } from './Button';
import { Segmented, Select } from './Form';
import { cn } from '@/lib/utils';

/** Standard page container with consistent padding and an optional max width. */
export function Page({ children, className, narrow, wide }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-7', narrow ? 'max-w-3xl' : wide ? 'max-w-[1600px]' : 'max-w-[1400px]', className)}
    >
      {children}
    </motion.div>
  );
}

export function PageHeader({ title, description, actions, eyebrow, className, children }) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-[24px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[14px] text-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      {Icon && (
        <div className={cn('mb-4 flex items-center justify-center rounded-2xl border border-line bg-gradient-to-b from-white to-canvas text-brand shadow-card', compact ? 'h-10 w-10' : 'h-12 w-12')}>
          <Icon size={compact ? 18 : 22} aria-hidden />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, action, className }) {
  const notFound = error?.status === 404;
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)} role="alert">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <AlertCircle size={22} aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{notFound ? 'Not found' : title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted">{error?.message || 'We could not load this content. Please try again.'}</p>
      {onRetry && !notFound && (
        <Button className="mt-5" icon={RotateCw} onClick={onRetry}>
          Try again
        </Button>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus, ariaLabel }) {
  return (
    <div className={cn('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-8 text-[13px] text-ink placeholder:text-subtle outline-none transition-colors focus:border-brand focus:ring-3 focus:ring-brand/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-ink focus-ring" aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function ViewToggle({ value, onChange }) {
  return (
    <Segmented
      ariaLabel="View"
      value={value}
      onChange={onChange}
      options={[
        { value: 'grid', label: '', icon: LayoutGrid, ariaLabel: 'Grid view', title: 'Grid view' },
        { value: 'list', label: '', icon: List, ariaLabel: 'List view', title: 'List view' },
      ]}
    />
  );
}

/** Compact labelled select for filter bars. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All', className }) {
  return (
    <Select
      size="sm"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('min-w-[140px]', className)}
      options={[{ value: 'all', label: `${label}: ${allLabel}` }, ...options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))]}
    />
  );
}

/** Container for list-page toolbars: search + filters + view toggles. */
export function Toolbar({ children, className }) {
  return <div className={cn('mb-5 flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

export function ResultCount({ count, noun = 'result', onClear, showClear }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span>
        {count} {count === 1 ? noun : `${noun}s`}
      </span>
      {showClear && (
        <button type="button" onClick={onClear} className="font-medium text-brand hover:underline focus-ring rounded">
          Clear filters
        </button>
      )}
    </div>
  );
}

/** Horizontally scrollable table wrapper with consistent styling. */
export function Table({ children, className, minWidth = 720 }) {
  return (
    <div className={cn('card overflow-hidden', className)}>
      <div className="relative overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse text-left text-[13px]" style={{ minWidth }}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({ children, className }) {
  return <th className={cn('border-b border-line bg-canvas/70 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted', className)}>{children}</th>;
}

export function Td({ children, className, ...props }) {
  return (
    <td className={cn('border-b border-line px-4 py-3 align-middle', className)} {...props}>
      {children}
    </td>
  );
}
