import { Info } from 'lucide-react';
import { Badge, FilterSelect, Tooltip } from '@/components/ui';
import { useClients, useJobs, useTasks } from '@/hooks';
import { cn } from '@/lib/utils';
import { STORAGE_INFO } from './fileMeta';

/**
 * Cascading Client → Job → Task filter selects. Values use 'all' for "no filter".
 * Picking a job/task also fills in its parent client/job so the selects stay consistent.
 * @param {{ clientId, jobId, taskId, onChange: (patch) => void, showTask?: boolean }} props
 */
export function ContextFilters({ clientId = 'all', jobId = 'all', taskId = 'all', onChange, showTask = true }) {
  const { data: clients = [] } = useClients({ includeArchived: true, sort: 'name' });
  const { data: jobs = [] } = useJobs(clientId !== 'all' ? { clientId, sort: 'name' } : { sort: 'name' });
  const taskParams = jobId !== 'all' ? { jobId } : clientId !== 'all' ? { clientId } : {};
  const { data: tasks = [] } = useTasks(taskParams, { enabled: showTask });

  const onClient = (v) => onChange({ clientId: v, jobId: 'all', taskId: 'all' });
  const onJob = (v) => {
    const job = jobs.find((j) => j.id === v);
    onChange({ jobId: v, taskId: 'all', ...(job ? { clientId: job.clientId } : {}) });
  };
  const onTask = (v) => {
    const task = tasks.find((t) => t.id === v);
    onChange({ taskId: v, ...(task ? { jobId: task.jobId, clientId: task.clientId } : {}) });
  };

  return (
    <>
      <FilterSelect label="Client" value={clientId} onChange={onClient} options={clients.map((c) => ({ value: c.id, label: c.name }))} className="max-w-[200px]" />
      <FilterSelect
        label="Job"
        value={jobId}
        onChange={onJob}
        options={jobs.map((j) => ({ value: j.id, label: clientId === 'all' && j.client?.name ? `${j.title} · ${j.client.name}` : j.title }))}
        className="max-w-[220px]"
      />
      {showTask && (
        <FilterSelect
          label="Task"
          value={taskId}
          onChange={onTask}
          options={tasks.map((t) => ({ value: t.id, label: jobId === 'all' && t.job?.title ? `${t.title} · ${t.job.title}` : t.title }))}
          className="max-w-[220px]"
        />
      )}
    </>
  );
}

/** Small honest note about demo-mode limitations. */
export function DemoNote({ children, className }) {
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border border-line bg-canvas/70 px-3 py-2 text-xs leading-5 text-muted', className)}>
      <Info size={14} className="mt-0.5 shrink-0 text-info" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Badge describing where a file's content lives (bundled / generated / browser / record-only). */
export function StorageBadge({ storage, withTooltip = true }) {
  const info = STORAGE_INFO[storage] || STORAGE_INFO['record-only'];
  const badge = <Badge tone={info.tone}>{info.label}</Badge>;
  if (!withTooltip) return badge;
  return (
    <Tooltip content={<span className="block max-w-[260px] whitespace-normal">{info.description}</span>} side="bottom">
      <span tabIndex={0} className="rounded focus-ring">
        {badge}
      </span>
    </Tooltip>
  );
}
