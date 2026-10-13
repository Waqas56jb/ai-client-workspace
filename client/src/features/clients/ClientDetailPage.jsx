import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, ArchiveRestore, ArrowLeft, Briefcase, FolderOpen, Globe, LayoutDashboard, Mail, Palette, Pencil, Phone, Plus, Sparkles, Trash2, Archive, User } from 'lucide-react';
import { Button, Card, ErrorState, Menu, Page, Skeleton, TabPanel, Tabs } from '@/components/ui';
import { ActivityFeed, ClientLogo, ClientStatusBadge } from '@/components/data-display';
import { useBreadcrumbs, useClient, usePageTitle } from '@/hooks';
import { clientHasWork, useClientActions } from './components/useClientActions';
import { OverviewTab } from './components/OverviewTab';
import { JobsTab } from './components/JobsTab';
import { BrandProfileTab } from './components/BrandProfileTab';
import { ReferenceFilesTab } from './components/ReferenceFilesTab';
import { websiteHref } from './components/helpers';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '' },
  { id: 'jobs', label: 'Jobs & Projects', icon: Briefcase, path: '/jobs' },
  { id: 'brand', label: 'Brand Profile', icon: Palette, path: '/brand' },
  { id: 'files', label: 'Reference Files', icon: FolderOpen, path: '/reference-files' },
  { id: 'activity', label: 'Activity', icon: Activity, path: '/activity' },
];

function HeaderSkeleton() {
  return (
    <div className="card mb-6 p-5" role="status" aria-label="Loading">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
      </div>
    </div>
  );
}

export default function ClientDetailPage({ tab = 'overview' }) {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, error, refetch } = useClient(clientId);
  const current = TABS.find((t) => t.id === tab) || TABS[0];

  const actions = useClientActions({
    onRemoved: (res) => {
      if (res.result === 'deleted') navigate('/clients', { replace: true });
    },
  });

  useBreadcrumbs([
    { label: 'Clients', to: '/clients' },
    { label: client?.name || (error ? 'Not found' : '…'), to: `/clients/${clientId}` },
    { label: current.label },
  ]);
  usePageTitle(client ? `${client.name} · ${current.label}` : 'Client');

  if (error && !actions.isRemoving) {
    return (
      <Page>
        <div className="card">
          <ErrorState
            title="Couldn’t load this client"
            error={error.status === 404 ? { status: 404, message: 'This client doesn’t exist or has been deleted.' } : error}
            onRetry={refetch}
          />
          <div className="-mt-8 flex justify-center pb-10">
            <Button as={Link} to="/clients" icon={ArrowLeft}>
              Back to clients
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  const tabs = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    count: client && t.id === 'jobs' ? client.jobCount : undefined,
  }));

  return (
    <Page>
      {isLoading || !client ? <HeaderSkeleton /> : <ClientHeader client={client} actions={actions} />}

      <Tabs
        tabs={tabs}
        value={current.id}
        onChange={(id) => navigate(`/clients/${clientId}${TABS.find((t) => t.id === id).path}`)}
        ariaLabel="Client sections"
        className="mb-6"
      />

      {isLoading || !client ? (
        <div className="grid gap-5 lg:grid-cols-3" role="status" aria-label="Loading">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <TabPanel>
          {current.id === 'overview' && <OverviewTab client={client} />}
          {current.id === 'jobs' && <JobsTab client={client} />}
          {current.id === 'brand' && <BrandProfileTab key={client.id} client={client} />}
          {current.id === 'files' && <ReferenceFilesTab client={client} />}
          {current.id === 'activity' && (
            <Card>
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Activity</h2>
                  <p className="mt-0.5 text-xs text-muted">Everything that happened for {client.name} — edits, AI requests, uploads and approvals.</p>
                </div>
              </div>
              <div className="p-2">
                <ActivityFeed clientId={client.id} limit={40} showContext emptyText={`Work on ${client.name} will be recorded here.`} />
              </div>
            </Card>
          )}
        </TabPanel>
      )}
      {actions.dialog}
    </Page>
  );
}

function ClientHeader({ client, actions }) {
  const navigate = useNavigate();
  const archived = client.status === 'archived';
  const hasWork = clientHasWork(client);
  const menuItems = [
    archived && { label: 'Restore client', icon: ArchiveRestore, onSelect: () => actions.restore(client) },
    archived && hasWork
      ? null
      : { label: hasWork ? 'Archive client' : 'Delete client', icon: hasWork ? Archive : Trash2, danger: true, onSelect: () => actions.requestRemove(client) },
  ].filter(Boolean);

  return (
    <div className="card mb-6 overflow-hidden">
      <div
        className="h-16 sm:h-20"
        style={{ background: `linear-gradient(120deg, ${client.brand?.primaryColor || '#6257E8'} 0%, ${client.brand?.secondaryColor || '#8B7CFF'} 70%, ${client.brand?.accentColor || '#FFC531'} 140%)` }}
        aria-hidden
      />
      <div className="px-5 pb-5">
        <div className="-mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-end gap-4">
            <ClientLogo client={client} size="xl" className="shadow-card ring-4 ring-surface" />
            <div className="min-w-0 pb-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink sm:text-[24px]">{client.name}</h1>
                <ClientStatusBadge status={client.status} />
              </div>
              <p className="mt-0.5 text-[13px] text-muted">
                {client.industry || 'No industry set'}
                <span className="px-1.5 text-subtle">·</span>
                <span className="font-mono text-xs">{client.slug}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {archived && (
              <Button icon={ArchiveRestore} onClick={() => actions.restore(client)} loading={actions.isRestoring}>
                Restore
              </Button>
            )}
            <Button as={Link} to={`/clients/${client.id}/edit`} icon={Pencil}>
              Edit
            </Button>
            <Button as={Link} to={`/jobs/new?clientId=${client.id}`} icon={Plus}>
              New job
            </Button>
            <Button as={Link} to={`/tasks/new?clientId=${client.id}`} variant="ai" icon={Sparkles}>
              Start AI task
            </Button>
            {menuItems.length > 0 && <Menu label="More client actions" items={menuItems} />}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
          {client.contactName && (
            <span className="inline-flex items-center gap-1.5">
              <User size={14} className="text-subtle" aria-hidden />
              {client.contactName}
            </span>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 hover:text-brand focus-ring rounded">
              <Mail size={14} className="text-subtle" aria-hidden />
              {client.email}
            </a>
          )}
          {client.phone && (
            <a href={`tel:${client.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-brand focus-ring rounded">
              <Phone size={14} className="text-subtle" aria-hidden />
              {client.phone}
            </a>
          )}
          {client.website && (
            <a href={websiteHref(client.website)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 hover:text-brand focus-ring rounded">
              <Globe size={14} className="text-subtle" aria-hidden />
              {client.website}
            </a>
          )}
          {!client.contactName && !client.email && !client.phone && !client.website && (
            <Link to={`/clients/${client.id}/edit`} className="text-brand hover:underline focus-ring rounded">
              Add contact details
            </Link>
          )}
        </div>
        {archived && (
          <p className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-muted">
            This client is archived. Its jobs, tasks and files are kept and remain viewable — restore it to show it in the client list again.
          </p>
        )}
      </div>
    </div>
  );
}
