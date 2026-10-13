import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Briefcase, CheckCircle2, CircleDashed, FileText, FolderOpen, ListTodo, Palette, Plus, Building2 } from 'lucide-react';
import { Button, ColorSwatch, EmptyState, ErrorState, MetaRow, SkeletonRows } from '@/components/ui';
import { ActivityFeed, FileThumb, JobStatusBadge, TaskStatusBadge, TaskTypeBadge } from '@/components/data-display';
import { useFiles, useJobs, useTasks } from '@/hooks';
import { formatDate, timeAgo } from '@/lib/utils';
import { Section, websiteHref } from './helpers';

function StatTile({ icon: Icon, label, value, to, tone = 'text-brand bg-brand-soft' }) {
  const inner = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon size={17} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[20px] font-semibold leading-6 tabular-nums text-ink">{value}</span>
        <span className="block truncate text-xs text-muted">{label}</span>
      </span>
    </>
  );
  const cls = 'card flex items-center gap-3 p-4';
  return to ? (
    <Link to={to} className={`${cls} transition-[border,box-shadow] hover:border-line-strong focus-ring`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function ListState({ query, empty }) {
  if (query.isLoading) return <SkeletonRows rows={3} className="p-5" />;
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (!query.data?.length) return empty;
  return null;
}

export function OverviewTab({ client }) {
  const jobs = useJobs({ clientId: client.id });
  const tasks = useTasks({ clientId: client.id });
  const files = useFiles({ clientId: client.id, sort: 'created' });
  const brand = client.brand || {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Briefcase} label={`Jobs · ${client.activeJobCount} active`} value={client.jobCount} to={`/clients/${client.id}/jobs`} />
        <StatTile icon={ListTodo} label="Tasks" value={client.taskCount} to={`/tasks?clientId=${client.id}`} tone="text-info bg-info-soft" />
        <StatTile icon={CircleDashed} label="Draft outputs" value={client.draftCount} tone="text-warning bg-warning-soft" />
        <StatTile icon={CheckCircle2} label="Approved outputs" value={client.approvedCount} to="/approved" tone="text-success bg-success-soft" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Section icon={Building2} title="Business details" action={<Button as={Link} to={`/clients/${client.id}/edit`} size="xs" variant="ghost">Edit</Button>}>
            {client.description ? (
              <p className="text-[14px] leading-6 text-ink">{client.description}</p>
            ) : (
              <p className="text-[13px] text-muted">No business description yet.</p>
            )}
            <dl className="mt-4 grid gap-x-8 divide-line sm:grid-cols-2">
              <MetaRow label="Address">{client.address || '—'}</MetaRow>
              <MetaRow label="Primary contact">{client.contactName || '—'}</MetaRow>
              <MetaRow label="Email">{client.email ? <a className="hover:text-brand" href={`mailto:${client.email}`}>{client.email}</a> : '—'}</MetaRow>
              <MetaRow label="Phone">{client.phone || '—'}</MetaRow>
              <MetaRow label="Website">
                {client.website ? (
                  <a className="hover:text-brand" href={websiteHref(client.website)} target="_blank" rel="noreferrer noopener">
                    {client.website}
                  </a>
                ) : (
                  '—'
                )}
              </MetaRow>
              <MetaRow label="Client since">{formatDate(client.createdAt)}</MetaRow>
            </dl>
            {client.notes && (
              <div className="mt-4 rounded-lg border border-[#F7E4B5] bg-warning-soft/60 px-3.5 py-3">
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-warning">Internal notes</p>
                <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-ink">{client.notes}</p>
              </div>
            )}
          </Section>

          <Section
            icon={Briefcase}
            title="Recent jobs"
            bodyClassName="p-0"
            action={
              <>
                <Button as={Link} to={`/jobs/new?clientId=${client.id}`} size="xs" variant="ghost" icon={Plus}>
                  New job
                </Button>
                <Button as={Link} to={`/clients/${client.id}/jobs`} size="xs" variant="ghost" iconRight={ArrowRight}>
                  All jobs
                </Button>
              </>
            }
          >
            {ListState({
              query: jobs,
              empty: (
                <EmptyState
                  compact
                  icon={Briefcase}
                  title="No jobs yet"
                  description="Jobs group related tasks, like a campaign or an event."
                  action={
                    <Button as={Link} to={`/jobs/new?clientId=${client.id}`} size="sm" variant="primary" icon={Plus}>
                      New job
                    </Button>
                  }
                />
              ),
            }) || (
              <ul className="divide-y divide-line">
                {jobs.data.slice(0, 5).map((j) => (
                  <li key={j.id}>
                    <Link to={`/jobs/${j.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-canvas/60 focus-ring">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                        <Briefcase size={15} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{j.title}</span>
                        <span className="block text-xs text-muted">
                          {j.taskCount} {j.taskCount === 1 ? 'task' : 'tasks'} · {j.approvedCount} approved · updated {timeAgo(j.updatedAt)}
                        </span>
                      </span>
                      <JobStatusBadge status={j.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            icon={ListTodo}
            title="Recent tasks"
            bodyClassName="p-0"
            action={
              <Button as={Link} to={`/tasks?clientId=${client.id}`} size="xs" variant="ghost" iconRight={ArrowRight}>
                All tasks
              </Button>
            }
          >
            {ListState({
              query: tasks,
              empty: <EmptyState compact icon={ListTodo} title="No tasks yet" description="Create a job first, then add AI tasks to it." />,
            }) || (
              <ul className="divide-y divide-line">
                {tasks.data.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 transition-colors hover:bg-canvas/60 focus-ring">
                      <span className="min-w-0 flex-1 basis-48">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{t.title}</span>
                        <span className="block truncate text-xs text-muted">
                          {t.job?.title || 'No job'} · updated {timeAgo(t.updatedAt)}
                        </span>
                      </span>
                      <TaskTypeBadge type={t.type} />
                      <TaskStatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-5">
          <Section
            icon={Palette}
            title="Brand summary"
            action={
              <Button as={Link} to={`/clients/${client.id}/brand`} size="xs" variant="ghost" iconRight={ArrowRight}>
                Profile
              </Button>
            }
          >
            <div className="flex overflow-hidden rounded-lg border border-line">
              {[
                ['Primary', brand.primaryColor],
                ['Secondary', brand.secondaryColor],
                ['Accent', brand.accentColor],
                ['Background', brand.backgroundColor],
              ].map(([label, color]) => (
                <div key={label} className="min-w-0 flex-1">
                  <div className="h-12 border-r border-black/5 last:border-r-0" style={{ backgroundColor: color }} />
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[11px] text-muted">{label}</p>
                    <p className="truncate font-mono text-[11px] uppercase text-ink">{color}</p>
                  </div>
                </div>
              ))}
            </div>
            <dl className="mt-3">
              <MetaRow label="Fonts">{[brand.headingFont || brand.fontFamily, brand.bodyFont].filter(Boolean).join(' / ') || '—'}</MetaRow>
              <MetaRow label="Tone">{brand.tone || '—'}</MetaRow>
              <MetaRow label="Formality">{brand.formality || '—'}</MetaRow>
              <MetaRow label="Spelling">{brand.spelling || '—'}</MetaRow>
            </dl>
            {!brand.guidelines && !brand.writingInstructions && (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                <ColorSwatch color={brand.primaryColor} size="sm" />
                Add guidelines and writing rules to improve AI results.
              </p>
            )}
          </Section>

          <Section
            icon={FolderOpen}
            title="Recent files"
            bodyClassName="p-0"
            action={
              <Button as={Link} to={`/clients/${client.id}/reference-files`} size="xs" variant="ghost" iconRight={ArrowRight}>
                Files
              </Button>
            }
          >
            {ListState({
              query: files,
              empty: <EmptyState compact icon={FileText} title="No files yet" description="Upload reference material in the Reference Files tab." />,
            }) || (
              <ul className="divide-y divide-line">
                {files.data.slice(0, 5).map((f) => (
                  <li key={f.id}>
                    <Link to={`/files/${f.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-canvas/60 focus-ring">
                      <FileThumb file={f} className="h-9 w-9 shrink-0 rounded-md border border-line" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{f.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {f.category === 'output' ? 'Generated output' : 'Reference'} · {timeAgo(f.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            icon={Activity}
            title="Recent activity"
            bodyClassName="p-1.5"
            action={
              <Button as={Link} to={`/clients/${client.id}/activity`} size="xs" variant="ghost" iconRight={ArrowRight}>
                All
              </Button>
            }
          >
            <ActivityFeed clientId={client.id} limit={6} compact showContext={false} />
          </Section>
        </div>
      </div>
    </div>
  );
}
