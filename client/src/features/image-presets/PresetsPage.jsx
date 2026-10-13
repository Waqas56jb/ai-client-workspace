import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Copy, Frame, Globe2, Info, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, FilterSelect, Menu, Page, PageHeader, ResultCount, SearchInput, SkeletonCards, Switch, Toolbar } from '@/components/ui';
import { ClientChip } from '@/components/data-display';
import { useBreadcrumbs, useClients, useDebounce, usePageTitle, usePresets, useServiceMutation } from '@/hooks';
import { presetService } from '@/services';
import { cn } from '@/lib/utils';
import { AspectShape } from './components';

export default function PresetsPage() {
  usePageTitle('Image presets');
  useBreadcrumbs([{ label: 'Image presets' }]);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [clientId, setClientId] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const debounced = useDebounce(search);

  const params = { search: debounced, scope, clientId, includeArchived: showArchived };
  const { data: presets, isLoading, error, refetch } = usePresets(params);
  const { data: clients } = useClients();

  const duplicate = useServiceMutation((id) => presetService.duplicate(id), {
    success: (p) => `Created “${p.name}”`,
    onSuccess: (p) => navigate(`/image-presets/${p.id}/edit`),
  });
  const setArchived = useServiceMutation(({ id, archived }) => presetService.setArchived(id, archived), {
    success: (p) => (p.archived ? `Archived “${p.name}”` : `Restored “${p.name}”`),
    onSuccess: () => setArchiveTarget(null),
  });

  const filtered = !!search || scope !== 'all' || clientId !== 'all' || showArchived;
  const clear = () => {
    setSearch('');
    setScope('all');
    setClientId('all');
    setShowArchived(false);
  };

  return (
    <Page>
      <PageHeader
        title="Image presets"
        description="Reusable sizes and layout guidance for the image tool. Global presets are available for every client; client presets only appear for that client."
        actions={
          <Button as={Link} to="/image-presets/new" variant="primary" icon={Plus}>
            New preset
          </Button>
        }
      />

      <div className="mb-5 flex gap-2.5 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-[13px] leading-5 text-[#1F4E9E]">
        <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
        <p>
          Starter sizes are <strong className="font-semibold">editable examples</strong>, not universal platform requirements — check each platform’s current specs and adjust or duplicate a preset as needed.
        </p>
      </div>

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search presets…" className="w-full sm:w-64" />
        <FilterSelect
          label="Scope"
          value={scope}
          onChange={(v) => {
            setScope(v);
            if (v === 'global') setClientId('all');
          }}
          options={[
            { value: 'global', label: 'Scope: Global' },
            { value: 'client', label: 'Scope: Client-specific' },
          ]}
        />
        <FilterSelect
          label="Client"
          value={clientId}
          onChange={(v) => {
            setClientId(v);
            if (v !== 'all') setScope('client');
          }}
          options={(clients || []).map((c) => ({ value: c.id, label: `Client: ${c.name}` }))}
        />
        <div className="rounded-lg border border-line bg-surface px-3 py-1.5">
          <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />
        </div>
        <div className="ml-auto">
          <ResultCount count={presets?.length ?? 0} noun="preset" showClear={filtered} onClear={clear} />
        </div>
      </Toolbar>

      {isLoading ? (
        <SkeletonCards count={6} />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : !presets.length ? (
        <Card>
          <EmptyState
            icon={Frame}
            title={filtered ? 'No presets match your filters' : 'No image presets yet'}
            description={filtered ? 'Try a different search or clear the filters.' : 'Create a preset to save a size and layout guidance for the image tool.'}
            action={
              filtered ? (
                <Button onClick={clear}>Clear filters</Button>
              ) : (
                <Button as={Link} to="/image-presets/new" variant="primary" icon={Plus}>
                  New preset
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {presets.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              onEdit={() => navigate(`/image-presets/${p.id}/edit`)}
              onDuplicate={() => duplicate.mutate(p.id)}
              onArchive={() => setArchiveTarget(p)}
              onRestore={() => setArchived.mutate({ id: p.id, archived: false })}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => setArchived.mutate({ id: archiveTarget.id, archived: true })}
        loading={setArchived.isPending}
        tone="danger"
        icon={Archive}
        title={`Archive “${archiveTarget?.name}”?`}
        description="Archived presets are hidden from the image tool. Existing images keep their dimensions, and you can restore the preset at any time."
        confirmLabel="Archive preset"
      />
    </Page>
  );
}

function PresetCard({ preset: p, onEdit, onDuplicate, onArchive, onRestore }) {
  const color = p.client?.primaryColor || '#6257E8';
  return (
    <Card className={cn('flex flex-col overflow-hidden', p.archived && 'opacity-75')}>
      <div className="relative flex h-[136px] items-center justify-center border-b border-line bg-gradient-to-b from-canvas to-white">
        <AspectShape width={p.width} height={p.height} color={color} box={96} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1">
          {p.isStarter && <Badge tone="brand">Starter</Badge>}
          {p.archived && <Badge tone="neutral" icon={Archive}>Archived</Badge>}
        </div>
        <div className="absolute right-2 top-2">
          <Menu
            label={`Actions for ${p.name}`}
            items={[
              { label: 'Edit preset', icon: Pencil, onSelect: onEdit, disabled: p.archived },
              { label: 'Duplicate', icon: Copy, onSelect: onDuplicate },
              { separator: true },
              p.archived ? { label: 'Restore', icon: ArchiveRestore, onSelect: onRestore } : { label: 'Archive', icon: Archive, onSelect: onArchive, danger: true },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="truncate text-[15px] font-semibold text-ink" title={p.name}>
          {p.name}
        </h2>
        <p className="mt-1 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-muted">{p.description || 'No description.'}</p>
        <div className="mb-4 mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md bg-[#F1F2F7] px-1.5 py-0.5 font-mono font-medium tabular-nums text-ink">
            {p.width} × {p.height} px
          </span>
          <span className="rounded-md bg-[#F1F2F7] px-1.5 py-0.5 font-mono text-muted">{p.aspectRatio}</span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
          {p.scope === 'client' ? (
            <ClientChip client={p.client} className="text-xs" />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted">
              <Globe2 size={14} aria-hidden /> Global
            </span>
          )}
          {p.archived ? (
            <Button size="xs" icon={ArchiveRestore} onClick={onRestore}>
              Restore
            </Button>
          ) : (
            <Button size="xs" icon={Pencil} onClick={onEdit}>
              Edit
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
