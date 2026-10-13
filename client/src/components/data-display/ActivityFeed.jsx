import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle2, FilePlus2, FolderPlus, GitBranch, Pencil, Settings2, Sparkles, Trash2, UserPlus, Upload, Archive, Palette } from 'lucide-react';
import { Avatar, EmptyState, ErrorState, SkeletonRows } from '@/components/ui';
import { useActivity } from '@/hooks';
import { ACTIVITY_TYPES } from '@/lib/constants';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

const ICONS = {
  client_created: UserPlus,
  client_updated: Pencil,
  client_archived: Archive,
  brand_updated: Palette,
  job_created: FolderPlus,
  job_updated: Pencil,
  job_deleted: Trash2,
  task_created: FilePlus2,
  task_updated: Pencil,
  task_deleted: Trash2,
  ai_request: Sparkles,
  file_uploaded: Upload,
  file_renamed: Pencil,
  file_deleted: Trash2,
  output_revised: GitBranch,
  output_approved: CheckCircle2,
  instructions_updated: Settings2,
  preset_updated: Settings2,
  team_updated: Pencil,
};

const TONE_CLASSES = {
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-[#F1F2F7] text-[#4E5168]',
};

/** Where clicking an activity should take the user. */
export function activityHref(a) {
  if (a.file && a.resourceExists) return `/files/${a.file.id}`;
  if (a.resourceType === 'task' && a.task) return a.type === 'ai_request' ? `/ai-workspace/${a.task.id}` : `/tasks/${a.task.id}`;
  if (a.task) return `/tasks/${a.task.id}`;
  if (a.resourceType === 'job' && a.job) return `/jobs/${a.job.id}`;
  if (a.job) return `/jobs/${a.job.id}`;
  if (a.resourceType === 'instruction') return '/ai-instructions';
  if (a.resourceType === 'preset') return '/image-presets';
  if (a.resourceType === 'user') return '/team';
  if (a.client) return `/clients/${a.client.id}`;
  return null;
}

/**
 * Reusable activity timeline reading from the central activity service.
 * @param {{ clientId?, jobId?, taskId?, limit?, compact?, showContext? }} props
 */
export function ActivityFeed({ clientId, jobId, taskId, limit = 12, compact, showContext = true, className, emptyText }) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useActivity({ clientId, jobId, taskId, limit });

  if (isLoading) return <SkeletonRows rows={Math.min(limit, 5)} className="p-5" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data?.length) return <EmptyState compact icon={Activity} title="No activity yet" description={emptyText || 'Changes, AI requests and approvals will appear here.'} />;

  return (
    <ol className={cn('relative', className)}>
      {data.map((a, i) => {
        const Icon = ICONS[a.type] || Activity;
        const meta = ACTIVITY_TYPES[a.type] || { label: a.type, tone: 'neutral' };
        const href = activityHref(a);
        const Comp = href ? 'button' : 'div';
        return (
          <li key={a.id} className="relative">
            {i < data.length - 1 && <span className="absolute left-[29px] top-11 bottom-0 w-px bg-line" aria-hidden />}
            <Comp
              type={href ? 'button' : undefined}
              onClick={href ? () => navigate(href) : undefined}
              className={cn('flex w-full gap-3 px-4 text-left', compact ? 'py-2.5' : 'py-3', href && 'transition-colors hover:bg-canvas/70 focus-ring rounded-lg')}
            >
              <span className={cn('relative z-[1] mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[meta.tone])}>
                <Icon size={14} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-5 text-ink">{a.description}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar user={a.user} size="xs" />
                    {a.user?.name?.split(' ')[0] || 'Someone'}
                  </span>
                  <span aria-hidden>·</span>
                  <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                    {timeAgo(a.createdAt)}
                  </time>
                  {showContext && (a.client || a.job) && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{[a.client?.name, a.job?.title, a.task?.title].filter(Boolean).join(' / ')}</span>
                    </>
                  )}
                  {!compact && <span className="rounded bg-[#F1F2F7] px-1.5 py-px text-[10.5px] font-medium text-[#4E5168]">{meta.label}</span>}
                </span>
              </span>
            </Comp>
          </li>
        );
      })}
    </ol>
  );
}
