import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import { dayRange, monthRange, MONTHS, recentYears } from '@/lib/chatDates';
import { cn } from '@/lib/utils';

/** { from, to } for the chosen filter, and a short label for the button. */
export function dateFilterRange(f) {
  if (f?.day) return dayRange(f.day);
  if (f?.year) return monthRange(f.year, f.month);
  return {};
}
export function dateFilterLabel(f) {
  if (f?.day) return format(new Date(`${f.day}T12:00:00`), 'd MMM yyyy');
  if (f?.year) return f.month ? `${MONTHS[Number(f.month) - 1].label} ${f.year}` : String(f.year);
  return '';
}

const field = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15';

/** "Find a chat from a date" — closed until needed: an exact day, or a month and year. */
export function DateFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const label = dateFilterLabel(value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-xl px-3 text-[14.5px] font-medium transition-colors focus-ring',
            label ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface hover:text-ink',
          )}
        >
          <CalendarDays size={17} aria-hidden />
          {label ? `Date: ${label}` : 'Find by date'}
        </button>
        {label && (
          <button type="button" onClick={() => onChange({})} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-ink focus-ring" aria-label="Clear date filter">
            <X size={17} />
          </button>
        )}
      </div>
      {open && (
        <div role="dialog" aria-label="Find chats by date" className="absolute left-0 right-0 top-full z-40 mt-2 space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-pop">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink">A day</span>
            <input type="date" className={field} value={value?.day || ''} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => onChange(e.target.value ? { day: e.target.value } : {})} />
          </label>
          <div>
            <span className="mb-1.5 block text-[14px] font-semibold text-ink">Or a month</span>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Month" className={field} value={value?.month || ''} onChange={(e) => onChange({ year: value?.year || String(new Date().getFullYear()), month: e.target.value })}>
                <option value="">Whole year</option>
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select aria-label="Year" className={field} value={value?.year || ''} onChange={(e) => onChange(e.target.value ? { year: e.target.value, month: value?.month || '' } : {})}>
                <option value="">Year…</option>
                {recentYears().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="h-11 w-full rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-hover focus-ring">
            Show chats
          </button>
        </div>
      )}
    </div>
  );
}
