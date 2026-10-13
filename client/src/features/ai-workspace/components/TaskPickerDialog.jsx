import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardList, Plus } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, ErrorState, SearchInput, SkeletonRows } from '@/components/ui';
import { ClientLogo, TaskTypeBadge } from '@/components/data-display/Entities';
import { ToolIcon } from '@/components/workspace';
import { useDebounce, useTasks } from '@/hooks';
import { TOOL_BY_ID } from '@/lib/constants';
import { timeAgo } from '@/lib/utils';

/** Choose a task to open in the AI workspace with a pre-selected tool. */
export function TaskPickerDialog({ open, onClose, toolId }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 150);
  const { data, isLoading, error, refetch } = useTasks({ search: q, sort: 'updated' }, { enabled: open });
  const tool = TOOL_BY_ID[toolId];

  const tasks = useMemo(() => {
    const list = data || [];
    const match = list.filter((t) => t.type === toolId);
    const general = list.filter((t) => t.type === 'general');
    const other = list.filter((t) => t.type !== toolId && t.type !== 'general');
    return [...match, ...general, ...other];
  }, [data, toolId]);

  const open_ = (t) => {
    onClose();
    navigate(`/ai-workspace/${t.id}?tool=${toolId}`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={tool ? `Start with ${tool.name}` : 'Choose a task'}
      description="AI work always happens inside a task, so outputs stay linked to the right client and job. Pick a task or create a new one."
      footer={
        <>
          <span className="mr-auto text-xs text-muted">{tasks.length ? `${tasks.length} tasks` : ''}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button as={Link} to={`/tasks/new${toolId ? `?type=${toolId}` : ''}`} variant="primary" icon={Plus} onClick={onClose}>
            Create new task
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {tool && <ToolIcon tool={tool} size="md" />}
          <SearchInput value={search} onChange={setSearch} placeholder="Search tasks, clients or jobs…" className="flex-1" autoFocus />
        </div>
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !tasks.length ? (
          <EmptyState compact icon={ClipboardList} title="No matching tasks" description="Try another search, or create a new task for this work." />
        ) : (
          <ul className="max-h-[52vh] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {tasks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => open_(t)} className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-line hover:bg-canvas focus-ring">
                  <ClientLogo client={t.client} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-ink">{t.title}</span>
                      {t.type === toolId && <Badge tone="brand">Matches tool</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {t.client?.name} · {t.job?.title} · updated {timeAgo(t.updatedAt)}
                    </span>
                  </span>
                  <span className="hidden sm:inline-flex">
                    <TaskTypeBadge type={t.type} />
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
