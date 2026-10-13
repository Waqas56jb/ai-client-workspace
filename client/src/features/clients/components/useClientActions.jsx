import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, Loader2, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui';
import { useServiceMutation } from '@/hooks';
import { clientService } from '@/services';
import { pluralize } from '@/lib/utils';

/** True when removing this client would archive it (it has jobs or files). */
export function clientHasWork(client) {
  return (client?.jobCount || 0) + (client?.taskCount || 0) + (client?.fileCount || 0) > 0;
}

/**
 * Delete / archive / restore flow for a client.
 * Fetches the deletion impact first so the dialog can explain the consequences.
 * Returns `dialog` — render it once in the page.
 */
export function useClientActions({ onRemoved } = {}) {
  const [target, setTarget] = useState(null);

  const impact = useQuery({
    queryKey: ['client-deletion-impact', target?.id],
    queryFn: () => clientService.deletionImpact(target.id),
    enabled: !!target,
    staleTime: 0,
    gcTime: 0,
  });

  const remove = useServiceMutation((client) => clientService.remove(client.id), {
    success: (res, client) =>
      res.result === 'archived' ? `“${client.name}” archived — its jobs, tasks and files were kept` : `“${client.name}” deleted`,
    onSuccess: (res, client) => {
      setTarget(null);
      onRemoved?.(res, client);
    },
  });

  const restore = useServiceMutation((client) => clientService.restore(client.id), {
    success: (data) => `“${data.name}” restored to active clients`,
  });

  const data = impact.data;
  const archiving = data?.strategy === 'archive';
  const counts = data
    ? [
        pluralize(data.jobs, 'job'),
        pluralize(data.tasks, 'task'),
        pluralize(data.files, 'file'),
        pluralize(data.outputs, 'generated output'),
      ]
    : [];

  let title = target ? `Remove “${target.name}”?` : '';
  let description = 'Checking what this client is linked to…';
  if (data && archiving) {
    title = `Archive “${target?.name}”?`;
    description = 'This client already has work in the workspace, so it will be archived instead of deleted. Nothing is lost.';
  } else if (data) {
    title = `Delete “${target?.name}”?`;
    description = 'This client has no jobs, tasks or files, so it will be permanently deleted. This cannot be undone.';
  }

  const dialog = (
    <ConfirmDialog
      open={!!target}
      onClose={() => !remove.isPending && setTarget(null)}
      onConfirm={() => target && data && remove.mutate(target)}
      title={title}
      description={impact.error ? impact.error.message : description}
      tone={archiving ? 'primary' : 'danger'}
      icon={archiving ? Archive : Trash2}
      confirmLabel={archiving ? 'Archive client' : 'Delete client'}
      loading={impact.isLoading || remove.isPending}
    >
      {impact.isLoading ? (
        <p className="inline-flex items-center gap-2 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Looking up jobs, tasks and files…
        </p>
      ) : data && archiving ? (
        <div className="space-y-2.5 text-[13px] text-muted">
          <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Kept with the archived client</p>
            <p className="mt-1 text-ink">{counts.join(' · ')}</p>
          </div>
          <p className="text-xs leading-5">Archived clients are hidden from the client list by default. You can find them with the Archived status filter and restore them at any time.</p>
        </div>
      ) : data ? (
        <p className="text-xs leading-5 text-muted">Any image presets assigned to this client become global presets.</p>
      ) : null}
    </ConfirmDialog>
  );

  return {
    requestRemove: (client) => setTarget(client),
    restore: (client) => restore.mutate(client),
    isRestoring: restore.isPending,
    isRemoving: remove.isPending,
    dialog,
  };
}
