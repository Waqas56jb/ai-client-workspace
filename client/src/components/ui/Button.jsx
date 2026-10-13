import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-[0_1px_2px_rgba(81,69,208,0.35)] disabled:bg-brand/50',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas hover:border-line-strong shadow-card disabled:text-subtle',
  ghost: 'text-muted hover:text-ink hover:bg-canvas disabled:text-subtle',
  soft: 'bg-brand-soft text-brand hover:bg-[#e4e0ff] disabled:opacity-60',
  danger: 'bg-danger text-white hover:bg-[#bf3838] disabled:opacity-60',
  'danger-ghost': 'text-danger hover:bg-danger-soft disabled:opacity-60',
  success: 'bg-success text-white hover:bg-[#127050] disabled:opacity-60',
  ai: 'ai-gradient text-white shadow-glow hover:brightness-105 disabled:opacity-60 disabled:shadow-none',
};

const SIZES = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-lg',
  lg: 'h-10 px-4 text-sm gap-2 rounded-[10px]',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
  'icon-xs': 'h-7 w-7 rounded-md',
};

/**
 * @param {{ variant?: keyof VARIANTS, size?: keyof SIZES, loading?: boolean, icon?: import('react').ElementType, iconRight?: import('react').ElementType, as?: import('react').ElementType }} props
 */
export const Button = forwardRef(function Button(
  { as: Comp = 'button', variant = 'secondary', size = 'md', loading = false, icon: Icon, iconRight: IconRight, className, children, disabled, type, ...props },
  ref,
) {
  const isIconOnly = size.startsWith('icon');
  const iconSize = size === 'xs' || size === 'icon-xs' ? 14 : 16;
  return (
    <Comp
      ref={ref}
      type={Comp === 'button' ? type || 'button' : undefined}
      disabled={Comp === 'button' ? disabled || loading : undefined}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,border,box-shadow,filter] duration-150 focus-ring disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        isIconOnly && 'p-0',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden /> : Icon ? <Icon size={iconSize} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} aria-hidden /> : null}
    </Comp>
  );
});
