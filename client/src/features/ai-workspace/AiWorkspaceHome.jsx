import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList, MessagesSquare, Plus, Sparkles } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, FilterSelect, Page, PageHeader, ResultCount, SearchInput, SkeletonCards, SkeletonRows, Toolbar } from '@/components/ui';
import { ClientLogo, TaskStatusBadge, TaskTypeBadge } from '@/components/data-display/Entities';
import { DemoIndicator, ToolIcon } from '@/components/workspace';
import { useBreadcrumbs, useClients, useDebounce, useInstructions, usePageTitle, useTasks } from '@/hooks';
import { AI_TOOLS, TASK_TYPES } from '@/lib/constants';
import { pluralize, timeAgo } from '@/lib/utils';
import { TaskPickerDialog } from './components/TaskPickerDialog';
import { isMockMode } from '@/lib/config';

const TOOL_BULLETS = {
  writing: ['Email, SMS, WhatsApp & other text', 'Client tone, spelling and terms applied', 'Asks for the format when unclear'],
  image: ['Presets or exact custom dimensions', 'Brand colours, fonts & logo guidance', 'PNG export at the exact pixel size'],
  advertising: ['Headlines, social, search & CTAs', 'Structured, individually editable sections', 'Platform-aware character guidance'],
  vehicle: ['Built only from supplied details', 'Missing information flagged, never invented', 'Dealer warranty & disclaimers included'],
};

function ToolCard({ tool, inactive, onStart }) {
  return (
    <Card as="article" className="group relative flex flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop">
      <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${tool.color}, ${tool.color}55)` }} aria-hidden />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <ToolIcon tool={tool} size="lg" />
          {inactive ? (
            <Badge tone="danger">Turned off</Badge>
          ) : (
            <Badge tone="neutral" icon={Sparkles}>
              {isMockMode ? 'Simulated' : 'OpenAI'}
            </Badge>
          )}
        </div>
        <h2 className="mt-4 text-[15.5px] font-semibold text-ink">{tool.name}</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">{tool.description}</p>
        <ul className="mt-3 flex-1 space-y-1.5">
          {TOOL_BULLETS[tool.id].map((b) => (
            <li key={b} className="flex items-start gap-2 text-[12.5px] text-ink/80">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: tool.color }} aria-hidden />
              {b}
            </li>
          ))}
        </ul>
        <Button className="mt-5 w-full" variant="secondary" iconRight={ArrowRight} onClick={() => onStart(tool.id)}>
          Start {tool.short.toLowerCase()} task
        </Button>
      </div>
    </Card>
  );
}

function TaskRow({ task }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/ai-workspace/${task.id}`} className="truncate text-[13.5px] font-semibold text-ink hover:text-brand focus-ring rounded">
            {task.title}
          </Link>
          <TaskTypeBadge type={task.type} />
          <TaskStatusBadge status={task.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          <Link to={`/jobs/${task.jobId}`} className="hover:text-brand focus-ring rounded">
            {task.job?.title}
          </Link>{' '}
          · {pluralize(task.conversationCount || 0, 'conversation')} · {pluralize(task.outputCount || 0, 'output')}
          {task.approvedCount ? ` · ${task.approvedCount} approved` : ''} · updated {timeAgo(task.updatedAt)}
        </p>
      </div>
      <Button as={Link} to={`/ai-workspace/${task.id}`} size="sm" variant="soft" iconRight={ArrowRight} className="self-start sm:self-auto">
        Open workspace
      </Button>
    </li>
  );
}

export default function AiWorkspaceHome() {
  usePageTitle('AI Workspace');
  useBreadcrumbs([{ label: 'AI Workspace' }]);

  const [pickerTool, setPickerTool] = useState(null);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('all');
  const [type, setType] = useState('all');
  const q = useDebounce(search, 200);

  const { data: tasks, isLoading, error, refetch } = useTasks({ search: q, clientId, type, sort: 'updated' });
  const { data: clients } = useClients({ sort: 'name' });
  const { data: instructions } = useInstructions();
  const inactive = useMemo(() => Object.fromEntries((instructions || []).map((i) => [i.toolId, i.active === false])), [instructions]);

  const groups = useMemo(() => {
    const map = new Map();
    (tasks || []).forEach((t) => {
      const key = t.clientId;
      if (!map.has(key)) map.set(key, { client: t.client, tasks: [] });
      map.get(key).tasks.push(t);
    });
    return [...map.values()];
  }, [tasks]);

  const filtered = !!search || clientId !== 'all' || type !== 'all';

  return (
    <Page wide>
      <PageHeader
        eyebrow={<DemoIndicator />}
        title="AI Workspace"
        description="Start AI work inside a task so every conversation, output and approval stays linked to the right client and job."
        actions={
          <Button as={Link} to="/tasks/new" variant="primary" icon={Plus}>
            New task
          </Button>
        }
      />

      <section aria-labelledby="ai-tools-heading" className="mb-10">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="ai-tools-heading" className="text-[16px] font-semibold text-ink">
              Start an AI task
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">Choose a tool, then pick the task it belongs to.</p>
          </div>
          <Link to="/ai-instructions" className="hidden text-[13px] font-medium text-brand hover:underline focus-ring rounded sm:inline">
            Configure AI instructions
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {AI_TOOLS.map((t) => (
            <ToolCard key={t.id} tool={t} inactive={inactive[t.id]} onStart={setPickerTool} />
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-tasks-heading">
        <div className="mb-3">
          <h2 id="recent-tasks-heading" className="text-[16px] font-semibold text-ink">
            Recent tasks
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Jump back into a task’s workspace, grouped by client.</p>
        </div>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search tasks, clients, jobs…" className="w-full sm:w-72" />
          <FilterSelect label="Client" value={clientId} onChange={setClientId} options={(clients || []).map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect label="Type" value={type} onChange={setType} options={TASK_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
          <div className="sm:ml-auto">
            <ResultCount
              count={tasks?.length || 0}
              noun="task"
              showClear={filtered}
              onClear={() => {
                setSearch('');
                setClientId('all');
                setType('all');
              }}
            />
          </div>
        </Toolbar>

        {isLoading ? (
          <div className="space-y-4">
            <SkeletonCards count={2} className="xl:grid-cols-2" />
            <SkeletonRows rows={3} />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !groups.length ? (
          <Card>
            <EmptyState
              icon={filtered ? ClipboardList : MessagesSquare}
              title={filtered ? 'No tasks match these filters' : 'No tasks yet'}
              description={filtered ? 'Try a different search or clear the filters.' : 'Create a task under a client job to start working with the AI tools.'}
              action={
                <Button as={Link} to="/tasks/new" variant="primary" icon={Plus}>
                  New task
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <Card key={g.client?.id || 'none'} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line bg-canvas/50 px-4 py-2.5">
                  <ClientLogo client={g.client} size="sm" />
                  <Link to={`/clients/${g.client?.id}`} className="min-w-0 truncate text-[14px] font-semibold text-ink hover:text-brand focus-ring rounded">
                    {g.client?.name || 'Unknown client'}
                  </Link>
                  <span className="text-xs text-muted">{pluralize(g.tasks.length, 'task')}</span>
                </div>
                <ul className="divide-y divide-line">
                  {(clientId === 'all' ? g.tasks.slice(0, 8) : g.tasks).map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
                {clientId === 'all' && g.tasks.length > 8 && (
                  <div className="border-t border-line px-4 py-2 text-xs">
                    <button type="button" onClick={() => setClientId(g.client.id)} className="font-medium text-brand hover:underline focus-ring rounded">
                      Show all {g.tasks.length} tasks for {g.client?.name}
                    </button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <TaskPickerDialog open={!!pickerTool} onClose={() => setPickerTool(null)} toolId={pickerTool} />
    </Page>
  );
}
