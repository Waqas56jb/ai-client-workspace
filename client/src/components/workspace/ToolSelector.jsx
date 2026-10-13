import { Link } from 'react-router-dom';
import { ArrowRight, PowerOff } from 'lucide-react';
import { AI_TOOLS, TOOL_BY_ID } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** Coloured tool icon tile. */
export function ToolIcon({ tool, size = 'md', className }) {
  const t = typeof tool === 'string' ? TOOL_BY_ID[tool] : tool;
  if (!t) return null;
  const Icon = t.icon;
  const box = { xs: 'h-5 w-5 rounded', sm: 'h-7 w-7 rounded-md', md: 'h-9 w-9 rounded-lg', lg: 'h-11 w-11 rounded-xl' }[size];
  const icon = { xs: 12, sm: 15, md: 18, lg: 21 }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, className)} style={{ backgroundColor: t.soft, color: t.color }} aria-hidden>
      <Icon size={icon} />
    </span>
  );
}

/** Horizontal tool switcher shown at the top of the centre column. */
export function ToolSelector({ value, onChange, inactive = {}, disabled }) {
  return (
    <div role="radiogroup" aria-label="AI tool" className="flex gap-1.5 overflow-x-auto scrollbar-thin">
      {AI_TOOLS.map((t) => {
        const active = value === t.id;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(t.id)}
            title={t.description}
            className={cn(
              'group inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-all focus-ring disabled:opacity-60',
              active ? 'shadow-card' : 'border-transparent text-muted hover:bg-canvas hover:text-ink',
            )}
            style={active ? { backgroundColor: t.soft, borderColor: `${t.color}40`, color: t.color } : undefined}
          >
            <Icon size={16} aria-hidden style={active ? undefined : { color: t.color }} />
            <span className="hidden sm:inline">{t.name}</span>
            <span className="sm:hidden">{t.short}</span>
            {inactive[t.id] && (
              <span className="inline-flex items-center gap-0.5 rounded bg-danger-soft px-1 text-[10.5px] font-semibold text-danger" title="Turned off in AI Instructions">
                <PowerOff size={10} aria-hidden /> Off
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Large tool cards used when no tool is selected yet (e.g. general tasks). */
export function ToolChooser({ onChoose, inactive = {}, title = 'Choose an AI tool to start', description }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6 text-center">
        <p className="ai-gradient-text text-xs font-semibold uppercase tracking-[0.12em]">AI Workspace</p>
        <h2 className="mt-1.5 font-display text-xl font-bold text-ink">{title}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">
          {description || 'This task is not tied to a specific tool. Pick the one that fits — you can switch at any time without losing your conversations.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {AI_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChoose(t.id)}
            className="card group flex items-start gap-3.5 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop focus-ring"
          >
            <ToolIcon tool={t} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                {t.name}
                {inactive[t.id] && <span className="rounded bg-danger-soft px-1 text-[10.5px] font-semibold text-danger">Off</span>}
              </span>
              <span className="mt-1 block text-[12.5px] leading-5 text-muted">{t.description}</span>
            </span>
            <ArrowRight size={16} className="mt-1 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Banner shown when the selected tool is switched off in AI Instructions. */
export function InactiveToolBanner({ tool }) {
  const t = TOOL_BY_ID[tool];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12.5px] text-danger" role="status">
      <PowerOff size={14} aria-hidden />
      <span className="flex-1">{t?.name} is turned off in AI Instructions — generation is disabled until it is re-activated.</span>
      <Link to="/ai-instructions" className="font-semibold underline-offset-2 hover:underline focus-ring rounded">
        Open AI Instructions
      </Link>
    </div>
  );
}
