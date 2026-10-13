import { forwardRef, useId, cloneElement, isValidElement } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-lg border bg-surface text-ink placeholder:text-subtle transition-colors outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-canvas disabled:text-muted';

const INPUT_SIZES = { sm: 'h-8 text-[13px]', md: 'h-9 text-[14px]' };

export const Input = forwardRef(function Input({ className, invalid, icon: Icon, size = 'md', ...props }, ref) {
  const sizeCls = INPUT_SIZES[size] || INPUT_SIZES.md;
  if (Icon) {
    return (
      <div className="relative">
        <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <input ref={ref} className={cn(fieldBase, sizeCls, 'pl-9 pr-3', invalid ? 'border-danger' : 'border-line', className)} aria-invalid={invalid || undefined} {...props} />
      </div>
    );
  }
  return <input ref={ref} className={cn(fieldBase, sizeCls, 'px-3', invalid ? 'border-danger' : 'border-line', className)} aria-invalid={invalid || undefined} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(fieldBase, 'px-3 py-2 text-[14px] leading-6 resize-y scrollbar-thin', invalid ? 'border-danger' : 'border-line', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

/**
 * Native select styled to match. `options` = [{ value, label }] or strings.
 */
export const Select = forwardRef(function Select({ className, invalid, options, placeholder, children, size = 'md', ...props }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className={cn(fieldBase, 'appearance-none pl-3 pr-8', size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-[14px]', invalid ? 'border-danger' : 'border-line')}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          );
        })}
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
    </div>
  );
});

export function Label({ htmlFor, children, required, className }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[13px] font-medium text-ink', className)}>
      {children}
      {required && (
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

/**
 * Field wrapper: label + control + hint/error, wiring ids and aria attributes.
 * Pass a single input element as child.
 */
export function Field({ label, error, hint, required, children, className, id: idProp }) {
  const auto = useId();
  const id = idProp || auto;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const child = isValidElement(children)
    ? cloneElement(children, { id: children.props.id || id, 'aria-describedby': describedBy, invalid: children.props.invalid ?? !!error, required: undefined })
    : children;
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      )}
      {child}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Checkbox = forwardRef(function Checkbox({ label, className, id: idProp, ...props }, ref) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink', className)}>
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <input ref={ref} id={id} type="checkbox" className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-line-strong bg-surface checked:border-brand checked:bg-brand focus-ring" {...props} />
        <Check size={12} strokeWidth={3} className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100" aria-hidden />
      </span>
      {label}
    </label>
  );
});

/** Accessible toggle switch. */
export function Switch({ checked, onChange, label, description, disabled, id: idProp }) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <div className="min-w-0">
          {label && (
            <label htmlFor={id} className="block text-[13px] font-medium text-ink">
              {label}
            </label>
          )}
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={!!checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-ring disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

/** Hex colour picker + text input. */
export function ColorInput({ value, onChange, invalid, id, ...props }) {
  return (
    <div className={cn('flex h-9 items-center gap-2 rounded-lg border bg-surface pl-1.5 pr-2 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/15', invalid ? 'border-danger' : 'border-line')}>
      <input
        type="color"
        aria-label="Pick colour"
        value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <input
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase outline-none"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        {...props}
      />
    </div>
  );
}

/** Segmented control for small option sets. */
export function Segmented({ value, onChange, options, size = 'md', className, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-lg border border-line bg-canvas p-0.5', className)}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel || (typeof opt.label === 'string' ? opt.label : undefined)}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-ring',
              size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
              active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {Icon && <Icon size={15} aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
