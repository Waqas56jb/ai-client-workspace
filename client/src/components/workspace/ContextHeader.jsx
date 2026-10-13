import { Link } from 'react-router-dom';
import { FlaskConical, PanelLeft, PanelRight, Sparkles } from 'lucide-react';
import { Button, Tooltip } from '@/components/ui';
import { ClientLogo, TaskStatusBadge } from '@/components/data-display/Entities';
import { cn } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

function Crumb({ label, to, value }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-muted">{label}:</span>
      <Link to={to} className="truncate font-semibold text-ink hover:text-brand focus-ring rounded">
        {value}
      </Link>
    </span>
  );
}

/** Mode notice. Demo mode: responses are simulated. API mode: generated with OpenAI by the server. */
export function DemoIndicator({ compact, className }) {
  if (!isMockMode) {
    const live = 'Generated with OpenAI — requests are sent by the StudioFlow server';
    return (
      <Tooltip content={compact ? live : null} side="bottom">
        <span className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11.5px] font-medium text-muted', className)} role="note" aria-label={live}>
          <Sparkles size={13} aria-hidden />
          {compact ? 'OpenAI' : live}
        </span>
      </Tooltip>
    );
  }
  const text = 'Demo mode — responses are simulated, no OpenAI call is made';
  return (
    <Tooltip content={compact ? text : null} side="bottom">
      <span
        className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[#F7E4B5] bg-warning-soft px-2.5 text-[11.5px] font-medium text-warning', className)}
        role="note"
        aria-label={text}
      >
        <FlaskConical size={13} aria-hidden />
        {compact ? 'Demo mode' : text}
      </span>
    </Tooltip>
  );
}

/**
 * Persistent context bar: Client · Job · Task (all links), task status, demo
 * indicator and the side-panel toggles.
 */
export function ContextHeader({ task, client, job, leftOpen, rightOpen, onToggleLeft, onToggleRight }) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
      <Tooltip content={leftOpen ? 'Hide task panel' : 'Show task panel'} side="bottom">
        <Button size="icon-sm" variant={leftOpen ? 'soft' : 'ghost'} icon={PanelLeft} onClick={onToggleLeft} aria-label={leftOpen ? 'Hide task panel' : 'Show task panel'} aria-pressed={leftOpen} />
      </Tooltip>
      <ClientLogo client={client} size="sm" className="hidden sm:inline-flex" />
      <nav aria-label="Workspace context" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
        <Crumb label="Client" to={`/clients/${client.id}`} value={client.name} />
        <span className="text-subtle" aria-hidden>·</span>
        <Crumb label="Job" to={`/jobs/${job.id}`} value={job.title} />
        <span className="text-subtle" aria-hidden>·</span>
        <Crumb label="Task" to={`/tasks/${task.id}`} value={task.title} />
        <span className="hidden md:inline-flex">
          <TaskStatusBadge status={task.status} />
        </span>
      </nav>
      <span className="hidden 2xl:inline-flex"><DemoIndicator /></span>
      <span className="inline-flex 2xl:hidden"><DemoIndicator compact /></span>
      <Tooltip content={rightOpen ? 'Hide output panel' : 'Show output panel'} side="bottom">
        <Button size="icon-sm" variant={rightOpen ? 'soft' : 'ghost'} icon={PanelRight} onClick={onToggleRight} aria-label={rightOpen ? 'Hide output panel' : 'Show output panel'} aria-pressed={rightOpen} />
      </Tooltip>
    </header>
  );
}
