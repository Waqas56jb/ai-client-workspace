import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CloudOff, Database, HardDrive, RotateCcw, Server } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, MetaRow, ProgressBar, Skeleton } from '@/components/ui';
import { useBreadcrumbs, usePageTitle, useStorageInfo } from '@/hooks';
import { settingsService } from '@/services';
import { config, isMockMode } from '@/lib/config';
import { useAuthStore } from '@/store/authStore';
import { formatBytes, formatDateTime } from '@/lib/utils';

const STORAGE_TYPES = {
  bundled: { label: 'Bundled samples', hint: 'Small sample assets shipped with the app' },
  generated: { label: 'Generated outputs', hint: 'Demo outputs rendered from version data' },
  browser: { label: 'Browser uploads', hint: 'Held in IndexedDB in this browser (temporary)' },
  'record-only': { label: 'Record only', hint: 'Metadata only — no file content in demo mode' },
};

const COUNT_LABELS = { clients: 'Clients', jobs: 'Jobs', tasks: 'Tasks', conversations: 'Conversations', messages: 'Messages', outputs: 'Outputs', versions: 'Versions' };

export default function StorageSettingsPage() {
  usePageTitle('Storage');
  useBreadcrumbs([{ label: 'Settings', to: '/settings' }, { label: 'Storage' }]);
  const { data, isLoading, error, refetch } = useStorageInfo();
  const qc = useQueryClient();
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const doReset = async () => {
    setResetting(true);
    try {
      await settingsService.resetWorkspace();
      await qc.invalidateQueries();
      await refreshUser();
      toast.success('Demo workspace restored to its original data');
      setConfirm(false);
    } catch (err) {
      toast.error(err?.message || 'The workspace could not be reset.');
    } finally {
      setResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full rounded-xl" />
        <Skeleton className="h-[260px] w-full rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={refetch} />
      </Card>
    );
  }

  if (!isMockMode) return <ApiStorage data={data || {}} />;

  const used = (data.workspaceBytes || 0) + (data.browserFileBytes || 0);
  const pct = data.quotaBytes ? (used / data.quotaBytes) * 100 : 0;
  const isMock = data.mode === 'mock';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Demo storage in this browser" description="Local data only — nothing here is stored in the cloud" icon={HardDrive} />
        <div className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="font-display text-[26px] font-bold leading-none tracking-tight tabular-nums text-ink">{formatBytes(used)}</div>
              <div className="mt-1.5 text-xs text-muted">of {formatBytes(data.quotaBytes)} demo quota</div>
            </div>
            <span className="text-[13px] font-medium tabular-nums text-ink">{pct < 0.1 && used > 0 ? '<0.1' : pct.toFixed(1)}%</span>
          </div>
          <ProgressBar value={used} max={data.quotaBytes} tone={pct > 85 ? 'danger' : pct > 65 ? 'warning' : 'brand'} className="mt-3 h-2" label="Demo storage used" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <UsageItem color="bg-brand" label="Workspace records" sub="JSON in localStorage" value={formatBytes(data.workspaceBytes)} />
            <UsageItem color="bg-[#C2410C]" label="Browser file uploads" sub="Blobs in IndexedDB" value={formatBytes(data.browserFileBytes)} />
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">The demo quota is an app-level limit for this prototype, not your browser’s actual quota. Clearing site data removes everything.</p>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Files by storage type" description={`${data.fileCount} file records`} icon={Database} />
          <dl className="divide-y divide-line px-5">
            {Object.keys(STORAGE_TYPES).map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">{STORAGE_TYPES[k].label}</div>
                  <div className="text-xs text-muted">{STORAGE_TYPES[k].hint}</div>
                </dt>
                <dd className="text-[14px] font-semibold tabular-nums text-ink">{data.byStorage?.[k] || 0}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Workspace records" description={data.seededAt ? `Demo data seeded ${formatDateTime(data.seededAt)}` : undefined} icon={Database} />
          <dl className="grid grid-cols-2 gap-px bg-line">
            {Object.entries(COUNT_LABELS).map(([k, label]) => (
              <div key={k} className="bg-surface px-5 py-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">{data.counts?.[k] ?? 0}</dd>
              </div>
            ))}
            <div className="bg-surface px-5 py-3">
              <dt className="text-xs text-muted">Files</dt>
              <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">{data.fileCount}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader title="Configuration" icon={Server} />
        <dl className="divide-y divide-line px-5">
          <MetaRow label="Data mode">
            <Badge tone={isMock ? 'warning' : 'success'} dot>
              {isMock ? 'Mock (in-browser)' : 'API'}
            </Badge>
          </MetaRow>
          <MetaRow label="API base URL">
            <code className="break-all font-mono text-xs">{config.apiBaseUrl}</code>
          </MetaRow>
          <MetaRow label="Simulated latency">{config.mockLatencyMs} ms</MetaRow>
          <MetaRow label="Max upload size">{formatBytes(config.maxUploadBytes)}</MetaRow>
        </dl>
        <div className="flex gap-2.5 border-t border-line bg-canvas/60 px-5 py-3 text-xs leading-5 text-muted">
          <CloudOff size={15} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            Cloud storage is not connected. In production, files will be stored in Supabase Storage and usage will be reported by the backend — no cloud usage is shown
            here because none exists yet.
          </p>
        </div>
      </Card>

      <Card className="border-danger/30">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle size={17} aria-hidden />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Reset demo workspace</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-muted">Restores the original demo clients, jobs, tasks, outputs and settings for everyone using this browser. Your changes will be lost.</p>
            </div>
          </div>
          <Button variant="danger" icon={RotateCcw} onClick={() => setConfirm(true)} disabled={!isMock} title={!isMock ? 'Only available in demo mode' : undefined}>
            Reset workspace
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={doReset}
        loading={resetting}
        tone="danger"
        title="Reset the demo workspace?"
        description="All clients, jobs, tasks, AI outputs, approvals, presets, instructions and preferences will return to the original demo data. This can’t be undone."
        confirmLabel="Reset workspace"
      />
    </div>
  );
}

function UsageItem({ color, label, sub, value }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${color}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/* ───────────────────────── API mode ───────────────────────── */

const CATEGORY_LABELS = { reference: 'Reference files', attachment: 'Task attachments', output: 'Generated outputs', logo: 'Logos' };
const KIND_LABELS = { image: 'Images', document: 'Documents', text: 'Text', other: 'Other' };

function numberOr(...values) {
  return values.find((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Breakdown map → rows. Accepts `{ key: count }` or `{ key: { count, bytes } }`. */
function BreakdownCard({ title, map, labels }) {
  const entries = Object.entries(map || {});
  if (!entries.length) return null;
  return (
    <Card>
      <CardHeader title={title} icon={Database} />
      <dl className="divide-y divide-line px-5">
        {entries.map(([k, v]) => {
          const count = typeof v === 'object' && v ? v.count ?? v.files ?? 0 : v;
          const bytes = typeof v === 'object' && v ? v.bytes ?? v.sizeBytes : null;
          return (
            <div key={k} className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-[13px] font-medium text-ink">{labels[k] || k}</dt>
              <dd className="text-right text-[14px] font-semibold tabular-nums text-ink">
                {count}
                {typeof bytes === 'number' && <span className="ml-2 text-xs font-normal text-muted">{formatBytes(bytes)}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function ApiStorage({ data }) {
  const used = numberOr(data.totalBytes, data.usedBytes, data.storageBytes, data.bytes) ?? 0;
  const quota = numberOr(data.quotaBytes, data.limitBytes);
  const pct = quota ? (used / quota) * 100 : 0;
  const fileCount = numberOr(data.fileCount, data.files, data.totalFiles) ?? 0;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Cloud storage" description="Files stored privately in Supabase Storage for this workspace" icon={HardDrive} />
        <div className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="font-display text-[26px] font-bold leading-none tracking-tight tabular-nums text-ink">{formatBytes(used)}</div>
              <div className="mt-1.5 text-xs text-muted">
                across {fileCount} file{fileCount === 1 ? '' : 's'}
                {quota ? ` · of ${formatBytes(quota)}` : ''}
              </div>
            </div>
            {quota ? <span className="text-[13px] font-medium tabular-nums text-ink">{pct < 0.1 && used > 0 ? '<0.1' : pct.toFixed(1)}%</span> : null}
          </div>
          {quota ? <ProgressBar value={used} max={quota} tone={pct > 85 ? 'danger' : pct > 65 ? 'warning' : 'brand'} className="mt-3 h-2" label="Storage used" /> : null}
          {data.bucket && <p className="mt-4 text-xs text-muted">Bucket: <code className="font-mono">{data.bucket}</code></p>}
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <BreakdownCard title="Files by category" map={data.byCategory} labels={CATEGORY_LABELS} />
        <BreakdownCard title="Files by type" map={data.byKind} labels={KIND_LABELS} />
        {data.counts && (
          <Card>
            <CardHeader title="Workspace records" icon={Database} />
            <dl className="grid grid-cols-2 gap-px bg-line">
              {Object.entries(data.counts).map(([k, v]) => (
                <div key={k} className="bg-surface px-5 py-3">
                  <dt className="text-xs text-muted">{COUNT_LABELS[k] || k}</dt>
                  <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">{v ?? 0}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Configuration" icon={Server} />
        <dl className="divide-y divide-line px-5">
          <MetaRow label="Data mode">
            <Badge tone="success" dot>
              API
            </Badge>
          </MetaRow>
          <MetaRow label="API base URL">
            <code className="break-all font-mono text-xs">{config.apiBaseUrl}</code>
          </MetaRow>
          <MetaRow label="Max upload size">{formatBytes(numberOr(data.maxUploadBytes) ?? config.maxUploadBytes)}</MetaRow>
        </dl>
      </Card>
    </div>
  );
}
