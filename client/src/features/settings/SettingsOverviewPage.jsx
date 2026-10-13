import { Link } from 'react-router-dom';
import { ArrowRight, Database, DatabaseBackup, FolderSync, LifeBuoy } from 'lucide-react';
import { Badge, Card, CardHeader } from '@/components/ui';
import { useBreadcrumbs, usePageTitle } from '@/hooks';
import { SETTINGS_SECTIONS } from './sections';
import { isMockMode } from '@/lib/config';

const BACKUP_ITEMS = [
  {
    icon: Database,
    title: 'Database backups',
    body: 'Client, job, task, output and version records will live in Supabase Postgres, covered by Supabase’s automated daily backups, with point-in-time recovery (PITR) available on supported plans.',
  },
  {
    icon: FolderSync,
    title: 'File backups',
    body: 'Uploaded references and generated images will be stored in Supabase Storage. A scheduled job will replicate or export buckets to a second location so files can be restored independently of the database.',
  },
  {
    icon: LifeBuoy,
    title: 'Recovery procedures',
    body: 'A documented runbook will cover restoring the database to a point in time, re-linking stored files, verifying record counts, and test restores on a regular schedule.',
  },
];

export default function SettingsOverviewPage() {
  usePageTitle('Settings');
  useBreadcrumbs([{ label: 'Settings' }]);

  return (
    <div className="space-y-8">
      <section aria-label="Settings sections" className="grid gap-3 sm:grid-cols-2">
        {SETTINGS_SECTIONS.filter((s) => !s.end).map((s) => (
          <Link key={s.to} to={s.to} className="group card flex items-start gap-3.5 p-4 transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40 focus-ring">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <s.icon size={17} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2 text-[14px] font-semibold text-ink">
                {s.label}
                <ArrowRight size={15} className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
              </span>
              <span className="mt-0.5 block text-[13px] leading-5 text-muted">{s.description}</span>
            </span>
          </Link>
        ))}
      </section>

      <Card>
        <CardHeader
          title="Backups"
          description={isMockMode ? 'How workspace data will be protected once the backend is connected' : 'How workspace data is protected'}
          icon={DatabaseBackup}
          action={
            <Badge tone="neutral" dot>
              {isMockMode ? 'Not available until backend integration' : 'Managed in Supabase'}
            </Badge>
          }
        />
        <div className="divide-y divide-line">
          {BACKUP_ITEMS.map((b) => (
            <div key={b.title} className="flex gap-3.5 px-5 py-4">
              <b.icon size={17} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <div>
                <h3 className="text-[14px] font-semibold text-ink">{b.title}</h3>
                <p className="mt-1 text-[13px] leading-5 text-muted">{b.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-line bg-canvas/60 px-5 py-3 text-xs leading-5 text-muted">
          <span className="font-medium text-ink">Backup status:</span>{' '}
          {isMockMode ? (
            <>
              not available until backend integration. This demo keeps its data in this browser only, so there are no backup records to show. Use{' '}
              <Link to="/settings/storage" className="font-medium text-brand hover:underline">Storage</Link> to see what is held locally.
            </>
          ) : (
            <>backups are managed by your administrator in the Supabase project dashboard (daily backups / PITR depending on the plan).</>
          )}
        </div>
      </Card>
    </div>
  );
}
