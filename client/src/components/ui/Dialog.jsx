import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-[min(1200px,95vw)]' };

function useFocusTrap(open, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const previously = document.activeElement;
    const node = ref.current;
    const focusables = () => node?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') || [];
    const t = setTimeout(() => {
      const auto = node?.querySelector('[data-autofocus]');
      (auto || focusables()[0] || node)?.focus();
    }, 30);
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const els = Array.from(focusables());
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      node?.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previously?.focus?.();
    };
  }, [open, ref]);
}

/**
 * Accessible modal dialog.
 * @param {{ open: boolean, onClose: () => void, title?: string, description?: string, size?: keyof SIZES, footer?: React.ReactNode, bodyClassName?: string, hideClose?: boolean }} props
 */
export function Dialog({ open, onClose, title, description, size = 'md', children, footer, bodyClassName, hideClose, className }) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(open, ref);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div className="absolute inset-0 bg-[#17182B]/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className={cn('relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop outline-none sm:rounded-2xl', SIZES[size], className)}
          >
            {(title || !hideClose) && (
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  {title && (
                    <h2 id={titleId} className="text-base font-semibold text-ink">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descId} className="mt-1 text-[13px] text-muted">
                      {description}
                    </p>
                  )}
                </div>
                {!hideClose && <Button variant="ghost" size="icon-sm" icon={X} onClick={onClose} aria-label="Close dialog" className="-mr-1.5 -mt-1" />}
              </div>
            )}
            <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin', bodyClassName)}>{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Confirmation dialog. Replaces window.confirm everywhere.
 * @param {{ open, onClose, onConfirm, title, description?, confirmLabel?, tone?: 'danger'|'primary'|'success', loading?, children? }} props
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', loading, children, icon: Icon }) {
  const ToneIcon = Icon || (tone === 'danger' ? AlertTriangle : null);
  return (
    <Dialog
      open={open}
      onClose={loading ? () => {} : onClose}
      size="sm"
      hideClose
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary'} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3.5 pt-1">
        {ToneIcon && (
          <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'success' ? 'bg-success-soft text-success' : 'bg-brand-soft text-brand')}>
            <ToneIcon size={18} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-1.5 text-[13px] leading-5 text-muted">{description}</p>}
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </Dialog>
  );
}

/** Use with useUnsavedChanges(isDirty): renders when navigation is blocked. */
export function UnsavedChangesDialog({ blocker }) {
  return (
    <ConfirmDialog
      open={blocker?.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      tone="danger"
      title="Discard unsaved changes?"
      description="You have changes that haven’t been saved. If you leave this page, they will be lost."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
    />
  );
}

/** Slide-over panel from the right (or left). */
export function Sheet({ open, onClose, title, side = 'right', children, className, width = 'max-w-md' }) {
  const ref = useRef(null);
  useFocusTrap(open, ref);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.div className="absolute inset-0 bg-[#17182B]/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            className={cn('absolute top-0 flex h-full w-full flex-col overflow-hidden shadow-pop outline-none', width, side === 'right' ? 'right-0' : 'left-0', className)}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
