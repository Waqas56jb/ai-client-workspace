import { cn, initials } from '@/lib/utils';
import { CheckCircle2, CircleDashed, GitBranch } from 'lucide-react';

export function Card({ as: Comp = 'div', className, children, interactive, ...props }) {
  return (
    <Comp className={cn('card', interactive && 'transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40', className)} {...props}>
      {children}
    </Comp>
  );
}

export function CardHeader({ title, description, action, className, icon: Icon }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-5 py-3.5', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <Icon size={16} className="shrink-0 text-muted" aria-hidden />}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-[#F1F2F7] text-[#4E5168] border-[#E4E6EF]',
  brand: 'bg-brand-soft text-brand border-[#E1DDFF]',
  success: 'bg-success-soft text-success border-[#CDEEDD]',
  warning: 'bg-warning-soft text-warning border-[#F7E4B5]',
  danger: 'bg-danger-soft text-danger border-[#F7D2D2]',
  info: 'bg-info-soft text-info border-[#D3E2FA]',
  dark: 'bg-ink text-white border-ink',
};

export function Badge({ tone = 'neutral', className, children, icon: Icon, dot }) {
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[11.5px] font-medium', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

/** Draft / Approved badge. `pending` = approved output with a newer draft revision. */
export function ApprovalBadge({ status, pending, className }) {
  if (status === 'approved') {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <Badge tone="success" icon={CheckCircle2}>
          Approved
        </Badge>
        {pending && (
          <Badge tone="warning" icon={GitBranch}>
            Draft revision
          </Badge>
        )}
      </span>
    );
  }
  if (status === 'draft') {
    return (
      <Badge tone="warning" icon={CircleDashed} className={className}>
        Draft
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" className={className}>
      Reference
    </Badge>
  );
}

const AVATAR_SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm', xl: 'h-14 w-14 text-lg' };

export function Avatar({ user, size = 'md', className, ring }) {
  if (!user) {
    return <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-line text-muted', AVATAR_SIZES[size], className)}>?</span>;
  }
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', AVATAR_SIZES[size], ring && 'ring-2 ring-surface', className)}
      style={{ backgroundColor: user.avatarColor || '#6257E8' }}
      title={user.name}
      aria-label={user.name}
      role="img"
    >
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users = [], size = 'sm', max = 3 }) {
  return (
    <span className="flex -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={size} ring />
      ))}
    </span>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('relative overflow-hidden rounded-md bg-[#EEF0F6] before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent', className)} aria-hidden />;
}

export function SkeletonRows({ rows = 5, className }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6, className }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function Kbd({ children, className }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-[10.5px] font-medium text-muted', className)}>{children}</kbd>;
}

/** Labelled metadata row used in detail panels. */
export function MetaRow({ label, children, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2 text-[13px]', className)}>
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export function ColorSwatch({ color, label, size = 'md' }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${label ? `${label}: ` : ''}${color}`}>
      <span className={cn('inline-block rounded-md border border-black/10', size === 'sm' ? 'h-4 w-4' : 'h-6 w-6')} style={{ backgroundColor: color }} aria-hidden />
      {label && <span className="text-xs text-muted">{label}</span>}
    </span>
  );
}

export function ProgressBar({ value = 0, max = 100, tone = 'brand', className, label }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const color = { brand: 'bg-brand', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[#EDEEF5]', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
