import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Braces, Copy, Info, LockKeyhole } from 'lucide-react';
import { Badge, Button, Dialog, ErrorState, SkeletonRows } from '@/components/ui';
import { aiService } from '@/services';
import { copyToClipboard } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

/**
 * Shows the structured request the backend would send to the model for a
 * given assistant message. Seeded messages don't store their request, so it is
 * rebuilt from the preceding user message with the current instructions.
 */
export function PreparedRequestDialog({ open, onClose, message, messages = [], taskId }) {
  const source = useMemo(() => {
    if (!message) return null;
    const idx = messages.findIndex((m) => m.id === message.id);
    return messages
      .slice(0, idx < 0 ? messages.length : idx)
      .reverse()
      .find((m) => m.role === 'user');
  }, [message, messages]);

  const stored = message?.request || null;
  const rebuilt = useQuery({
    queryKey: ['prepared-request', message?.id],
    enabled: !!open && !!message && !stored,
    staleTime: Infinity,
    queryFn: () =>
      aiService.previewRequest({
        taskId,
        tool: message.tool,
        prompt: source?.generationPrompt || source?.content || '',
        options: source?.requestOptions || {},
        conversationId: message.conversationId,
        attachmentIds: source?.attachmentIds || [],
      }),
  });

  const request = stored || rebuilt.data;
  const json = request ? JSON.stringify(request, null, 2) : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Prepared AI request"
      description="This is the structured payload the Node.js backend would forward to the model provider for this response."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={Copy} disabled={!json} onClick={async () => (await copyToClipboard(json)) && toast.success('Request JSON copied')}>
            Copy JSON
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] leading-5 text-muted">
            <Info size={15} className="mt-0.5 shrink-0 text-info" aria-hidden />
            <span>{isMockMode ? 'In demo mode nothing is sent — a local template generator simulates the reply. The request shape is what the real backend receives.' : 'Built by the server from the saved client, job, task and instructions. This is what is sent to OpenAI.'}</span>
          </div>
          <div className="flex gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] leading-5 text-muted">
            <LockKeyhole size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
            <span>The browser never holds model API keys. Only the selected client’s profile, task context and tool instructions are included.</span>
          </div>
        </div>
        {request && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand" icon={Braces}>
              {request.tool?.name || request.tool?.id}
            </Badge>
            {request.instructions?.version != null && <Badge>Instructions v{request.instructions.version}</Badge>}
            <Badge>{request.history?.length || 0} history messages</Badge>
            {request.attachments?.length > 0 && <Badge>{request.attachments.length} attachments</Badge>}
            {!stored && <Badge tone="warning">Rebuilt with current instructions</Badge>}
          </div>
        )}
        {!stored && rebuilt.isLoading ? (
          <SkeletonRows rows={4} />
        ) : !stored && rebuilt.error ? (
          <ErrorState error={rebuilt.error} onRetry={rebuilt.refetch} />
        ) : (
          <pre className="max-h-[52vh] overflow-auto rounded-xl border border-line bg-[#14152A] p-4 font-mono text-[11.5px] leading-[1.55] text-[#D8DAF0] scrollbar-thin">{json}</pre>
        )}
      </div>
    </Dialog>
  );
}
