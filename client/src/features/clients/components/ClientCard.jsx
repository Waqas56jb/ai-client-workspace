import { Link, useNavigate } from 'react-router-dom';
import { ArchiveRestore, ArrowUpRight, Briefcase, Clock, ListTodo, Pencil, Trash2, Archive } from 'lucide-react';
import { Button, Menu, Td } from '@/components/ui';
import { ClientLogo, ClientStatusBadge } from '@/components/data-display';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import { clientHasWork } from './useClientActions';

/** Menu items shared by the card and the row. */
export function clientMenuItems(client, { navigate, onRemove, onRestore }) {
  const archived = client.status === 'archived';
  const hasWork = clientHasWork(client);
  return [
    { label: 'Open', icon: ArrowUpRight, onSelect: () => navigate(`/clients/${client.id}`) },
    { label: 'Edit details', icon: Pencil, onSelect: () => navigate(`/clients/${client.id}/edit`) },
    archived && { label: 'Restore', icon: ArchiveRestore, onSelect: () => onRestore(client) },
    { separator: true },
    archived
      ? !hasWork && { label: 'Delete', icon: Trash2, danger: true, onSelect: () => onRemove(client) }
      : { label: hasWork ? 'Delete (archives)' : 'Delete', icon: hasWork ? Archive : Trash2, danger: true, onSelect: () => onRemove(client) },
  ].filter((item, i, arr) => item && !(item.separator && !arr.slice(i + 1).some(Boolean)));
}

function BrandStrip({ brand, className }) {
  const colors = [brand?.primaryColor, brand?.secondaryColor, brand?.accentColor].filter(Boolean);
  return (
    <span className={cn('inline-flex items-center gap-1', className)} title="Brand colours" aria-label={`Brand colours ${colors.join(', ')}`} role="img">
      {colors.map((c, i) => (
        <span key={`${c}-${i}`} className="h-3.5 w-3.5 rounded-full border border-black/10 ring-2 ring-surface" style={{ backgroundColor: c }} />
      ))}
    </span>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Icon size={14} className="text-subtle" aria-hidden />
      <span className="font-semibold text-ink">{value}</span> {label}
    </span>
  );
}

export function ClientCard({ client, onRemove, onRestore }) {
  const navigate = useNavigate();
  const archived = client.status === 'archived';
  return (
    <div
      className={cn(
        'card group relative flex flex-col overflow-hidden transition-[border,box-shadow] hover:border-line-strong hover:shadow-pop/40',
        archived && 'opacity-80',
      )}
    >
      <span className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${client.brand?.primaryColor || '#6257E8'}, ${client.brand?.secondaryColor || '#8B7CFF'})` }} aria-hidden />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <ClientLogo client={client} size="lg" />
          <div className="min-w-0 flex-1">
            <Link to={`/clients/${client.id}`} className="block truncate text-[15px] font-semibold text-ink hover:text-brand focus-ring rounded">
              {client.name}
            </Link>
            <p className="mt-0.5 truncate text-[13px] text-muted">{client.industry || 'No industry set'}</p>
          </div>
          <Menu label={`Actions for ${client.name}`} items={clientMenuItems(client, { navigate, onRemove, onRestore })} />
        </div>

        {client.description && <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-muted">{client.description}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Stat icon={Briefcase} value={client.jobCount} label={client.jobCount === 1 ? 'job' : 'jobs'} />
          <Stat icon={ListTodo} value={client.taskCount} label={client.taskCount === 1 ? 'task' : 'tasks'} />
          {client.status !== 'active' && <ClientStatusBadge status={client.status} />}
        </div>

        <div className="mt-auto pt-4">
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted" title={formatDate(client.lastActivityAt, 'd MMM yyyy, HH:mm')}>
            <Clock size={13} className="shrink-0 text-subtle" aria-hidden />
            <span className="truncate">Active {timeAgo(client.lastActivityAt)}</span>
          </span>
          <div className="flex items-center gap-2.5">
            <BrandStrip brand={client.brand} />
            <Button as={Link} to={`/clients/${client.id}`} size="xs" variant="secondary" iconRight={ArrowUpRight}>
              Open
            </Button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export function ClientRow({ client, onRemove, onRestore }) {
  const navigate = useNavigate();
  return (
    <tr className={cn('group cursor-pointer transition-colors hover:bg-canvas/60', client.status === 'archived' && 'opacity-80')} onClick={() => navigate(`/clients/${client.id}`)}>
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <ClientLogo client={client} size="md" />
          <div className="min-w-0">
            <Link to={`/clients/${client.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-ink hover:text-brand focus-ring rounded">
              {client.name}
            </Link>
            <span className="block truncate text-xs text-muted">{client.slug}</span>
          </div>
        </div>
      </Td>
      <Td className="text-muted">{client.industry || '—'}</Td>
      <Td>
        <ClientStatusBadge status={client.status} />
      </Td>
      <Td className="tabular-nums">{client.jobCount}</Td>
      <Td className="tabular-nums">{client.taskCount}</Td>
      <Td className="whitespace-nowrap text-muted">{timeAgo(client.lastActivityAt)}</Td>
      <Td>
        <BrandStrip brand={client.brand} />
      </Td>
      <Td className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Button as={Link} to={`/clients/${client.id}`} size="xs" variant="ghost">
            Open
          </Button>
          <Menu label={`Actions for ${client.name}`} items={clientMenuItems(client, { navigate, onRemove, onRestore })} />
        </div>
      </Td>
    </tr>
  );
}
