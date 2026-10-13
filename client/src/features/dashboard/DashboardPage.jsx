import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BarChart3, Briefcase, CheckCircle2, CircleDashed, FileStack, FolderKanban, FolderOpen, Activity, ListTodo, Plus, Sparkles, Users } from 'lucide-react';
import { ApprovalBadge, Button, Card, CardHeader, EmptyState, ErrorState, Page, Skeleton, SkeletonRows } from '@/components/ui';
import { ActivityFeed, ClientChip, FileThumb } from '@/components/data-display';
import { useBreadcrumbs, useDashboard, usePageTitle, usePreferences } from '@/hooks';
import { useAuthStore } from '@/store/authStore';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import { ActivityChart } from './ActivityChart';

const METRICS = [
  { key: 'clients', label: 'Total clients', icon: Users, to: '/clients', tone: 'bg-brand-soft text-brand' },
  { key: 'activeJobs', label: 'Active jobs', icon: Briefcase, to: '/jobs?status=active', tone: 'bg-info-soft text-info' },
  { key: 'openTasks', label: 'Open tasks', icon: ListTodo, to: '/tasks?status=open', tone: 'bg-[#E6F6FA] text-[#0E7490]' },
  { key: 'files', label: 'Files created', icon: FileStack, to: '/files', tone: 'bg-[#FFF1E8] text-[#C2410C]' },
  { key: 'drafts', label: 'Draft items', icon: CircleDashed, to: '/files?status=draft', tone: 'bg-warning-soft text-warning' },
  { key: 'approved', label: 'Approved items', icon: CheckCircle2, to: '/approved', tone: 'bg-success-soft text-success' },
];

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  usePageTitle('Dashboard');
  useBreadcrumbs([{ label: 'Dashboard' }]);
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, error, refetch } = useDashboard();
  const { data: prefs } = usePreferences();
  const dateFormat = prefs?.dateFormat || 'd MMM yyyy';
  const firstName = user?.name?.split(' ')[0] || 'there';

  return (
    <Page>
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-muted">{formatDate(new Date(), 'EEEE, d MMMM yyyy')}</p>
          <h1 className="mt-1 font-display text-[24px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">Here’s what’s moving across your clients today — pick up a draft, review what’s waiting, or start something new.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button as={Link} to="/clients/new" icon={Plus}>
            New client
          </Button>
          <Button as={Link} to="/jobs/new" icon={FolderKanban}>
            New job
          </Button>
          <Button as={Link} to="/ai-workspace" variant="ai" icon={Sparkles}>
            Start AI task
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : (
        <>
          <section aria-label="Summary" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {METRICS.map((m) => (
              <MetricCard key={m.key} metric={m} data={data?.metrics?.[m.key]} loading={isLoading} />
            ))}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              <Card>
                <CardHeader title="Output activity" description="Versions generated vs approved per day, last 14 days" icon={BarChart3} />
                {isLoading ? (
                  <div className="p-5">
                    <Skeleton className="h-[260px] w-full" />
                  </div>
                ) : (
                  <ActivityChart data={data.chart} />
                )}
              </Card>

              <RecentProjects jobs={data?.recentJobs} loading={isLoading} dateFormat={dateFormat} />
              <RecentFiles files={data?.recentFiles} loading={isLoading} dateFormat={dateFormat} />
            </div>

            <Card className="h-fit min-w-0">
              <CardHeader title="Recent activity" description="Across all clients and the team" icon={Activity} />
              <div className="py-2">
                <ActivityFeed limit={8} compact />
              </div>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

function MetricCard({ metric, data, loading }) {
  const Icon = metric.icon;
  return (
    <Link
      to={metric.to}
      className="group card flex min-w-0 flex-col gap-3 p-4 transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40 focus-ring"
      aria-label={loading ? metric.label : `${metric.label}: ${data?.value ?? 0}. ${data?.hint || ''}`}
    >
      <div className="flex items-center justify-between">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', metric.tone)}>
          <Icon size={16} aria-hidden />
        </span>
        <ArrowUpRight size={15} className="text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : (
        <div className="min-w-0">
          <div className="font-display text-[26px] font-bold leading-none tracking-tight tabular-nums text-ink">{data?.value ?? 0}</div>
          <div className="mt-1.5 text-[13px] font-medium text-ink">{metric.label}</div>
          <div className="mt-0.5 truncate text-xs text-muted" title={data?.hint}>
            {data?.hint}
          </div>
        </div>
      )}
    </Link>
  );
}

function RecentProjects({ jobs, loading, dateFormat }) {
  return (
    <Card>
      <CardHeader
        title="Recent projects"
        description="Jobs with the latest changes"
        icon={FolderKanban}
        action={
          <Button as={Link} to="/jobs" variant="ghost" size="sm" iconRight={ArrowRight}>
            All jobs
          </Button>
        }
      />
      {loading ? (
        <SkeletonRows rows={4} className="p-5" />
      ) : !jobs?.length ? (
        <EmptyState compact icon={FolderKanban} title="No active jobs" description="Create a job to group tasks for a client campaign or project." action={<Button as={Link} to="/jobs/new" icon={Plus}>New job</Button>} />
      ) : (
        <ul className="divide-y divide-line">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${j.id}`} className="block truncate rounded text-[14px] font-semibold text-ink hover:text-brand focus-ring">
                  {j.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <ClientChip client={j.client} className="text-xs" />
                  <span aria-hidden>·</span>
                  <span title={formatDate(j.updatedAt, `${dateFormat}, HH:mm`)}>Updated {timeAgo(j.updatedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <Count label="tasks" value={j.taskCount} />
                <Count label="drafts" value={j.draftCount} tone="text-warning" />
                <Count label="approved" value={j.approvedCount} tone="text-success" />
                <Button as={Link} to={`/jobs/${j.id}`} size="xs" variant="secondary" aria-label={`Open ${j.title}`}>
                  Open
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Count({ label, value, tone = 'text-ink' }) {
  return (
    <span className="flex min-w-[44px] flex-col items-center leading-tight">
      <span className={cn('text-[14px] font-semibold tabular-nums', tone)}>{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

function RecentFiles({ files, loading, dateFormat }) {
  return (
    <Card>
      <CardHeader
        title="Recent files"
        description="Latest generated outputs and uploads"
        icon={FolderOpen}
        action={
          <Button as={Link} to="/files" variant="ghost" size="sm" iconRight={ArrowRight}>
            All files
          </Button>
        }
      />
      {loading ? (
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[170px] w-full rounded-xl" />
          ))}
        </div>
      ) : !files?.length ? (
        <EmptyState compact icon={FolderOpen} title="No files yet" description="Generated outputs and uploaded files will show up here." />
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => (
            <li key={f.id} className="min-w-0">
              <Link to={`/files/${f.id}`} className="group block overflow-hidden rounded-xl border border-line bg-surface transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40 focus-ring">
                <FileThumb file={f} className="h-[110px] w-full border-b border-line" />
                <div className="p-3">
                  <div className="truncate text-[13px] font-semibold text-ink group-hover:text-brand" title={f.name}>
                    {f.name}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {f.client?.name || 'No client'} · <span className="capitalize">{f.kind || 'file'}</span> · {formatDate(f.updatedAt, dateFormat)}
                  </div>
                  <div className="mt-2 flex h-[22px] items-center">{f.status ? <ApprovalBadge status={f.status} pending={f.status === 'approved' && f.output?.currentVersionId !== f.output?.approvedVersionId} /> : <ApprovalBadge status={null} />}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
