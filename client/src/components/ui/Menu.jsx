import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';

/**
 * Dropdown menu with keyboard support.
 * items: [{ label, icon?, onSelect, danger?, disabled?, separator?, hint? }]
 */
export function Menu({ items, trigger, align = 'end', label = 'More actions', className, width = 200 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const id = useId();

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = menuRef.current?.offsetHeight || 0;
    const top = r.bottom + 6 + h > window.innerHeight && r.top - h - 6 > 0 ? r.top - h - 6 : r.bottom + 6;
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    setTimeout(() => menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const onMenuKey = (e) => {
    const els = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
    const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const toggle = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen((o) => !o);
  };

  return (
    <>
      {trigger ? (
        <span ref={btnRef} className={cn('inline-flex', className)} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}>
          {trigger}
        </span>
      ) : (
        <Button ref={btnRef} variant="ghost" size="icon-sm" icon={MoreHorizontal} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={className} />
      )}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, width }}
            className="fixed z-[90] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop"
          >
            {items.filter(Boolean).map((item, idx) =>
              item.separator ? (
                <div key={`sep-${idx}`} className="my-1 h-px bg-line" role="separator" />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    item.danger ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'text-ink hover:bg-canvas focus:bg-canvas',
                  )}
                >
                  {item.icon && <item.icon size={15} className={item.danger ? '' : 'text-muted'} aria-hidden />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="text-[11px] text-subtle">{item.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
