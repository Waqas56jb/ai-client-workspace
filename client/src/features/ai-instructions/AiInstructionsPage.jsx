import { useState } from 'react';
import { Info, ServerCog } from 'lucide-react';
import { Card, ConfirmDialog, ErrorState, Page, PageHeader, Skeleton, Tabs, TabPanel, UnsavedChangesDialog } from '@/components/ui';
import { useBreadcrumbs, useInstructions, usePageTitle, useUnsavedChanges } from '@/hooks';
import { AI_TOOLS } from '@/lib/constants';
import { InstructionForm } from './InstructionForm';
import { isMockMode } from '@/lib/config';

export default function AiInstructionsPage() {
  usePageTitle('AI instructions');
  useBreadcrumbs([{ label: 'AI instructions' }]);
  const { data: instructions, isLoading, error, refetch } = useInstructions();
  const [active, setActive] = useState(AI_TOOLS[0].id);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);
  const blocker = useUnsavedChanges(dirty);

  const changeTab = (id) => {
    if (id === active) return;
    if (dirty) setPendingTab(id);
    else setActive(id);
  };

  const current = instructions?.find((i) => i.toolId === active);

  return (
    <Page>
      <PageHeader
        title="AI instructions"
        description="Control how each AI tool behaves. Instructions are combined with the client’s brand profile and the task context in every prepared request."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <div className="flex gap-2.5 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-[13px] leading-5 text-[#1F4E9E]">
          <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
          <p>
            Saved instructions apply <strong className="font-semibold">immediately</strong> to the next {isMockMode ? 'simulated ' : ''}request — they’re included in the prepared request you can
            inspect in the AI workspace.
          </p>
        </div>
        <div className="flex gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-5 text-muted">
          <ServerCog size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          <p>
            In production, instructions are stored in Supabase and sent to OpenAI by the Node.js server. API keys never live in the frontend.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-[480px] w-full rounded-xl" />
        </div>
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : (
        <>
          <Tabs
            ariaLabel="AI tools"
            value={active}
            onChange={changeTab}
            className="mb-6"
            tabs={AI_TOOLS.map((t) => {
              const ins = instructions.find((i) => i.toolId === t.id);
              return { id: t.id, label: ins?.active === false ? `${t.name} (off)` : t.name, icon: t.icon };
            })}
          />
          <TabPanel>
            {current ? (
              <InstructionForm key={`${current.toolId}:${current.version}:${current.updatedAt}`} instruction={current} onDirtyChange={setDirty} />
            ) : (
              <Card>
                <ErrorState error={{ status: 404, message: 'This tool has no instruction set.' }} />
              </Card>
            )}
          </TabPanel>
        </>
      )}

      <ConfirmDialog
        open={!!pendingTab}
        onClose={() => setPendingTab(null)}
        onConfirm={() => {
          setDirty(false);
          setActive(pendingTab);
          setPendingTab(null);
        }}
        tone="danger"
        title="Discard unsaved changes?"
        description="You have unsaved changes to these instructions. Switching tools will discard them."
        confirmLabel="Discard and switch"
        cancelLabel="Keep editing"
      />
      <UnsavedChangesDialog blocker={blocker} />
    </Page>
  );
}
