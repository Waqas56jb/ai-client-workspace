import { useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConversation, qk } from '@/hooks';
import { chatOutputs, getFile, getGeneration } from '@/services/chatApi';
import { buildImageIndex, messageVersions } from '@/lib/imageReferences';

const TERMINAL = new Set(['succeeded', 'failed']);
export const chatKeys = {
  outputs: (conversationId) => ['chat-outputs', conversationId],
  file: (id) => ['chat-file', id],
  generation: (id) => ['generation', id],
};

/**
 * The answer still being written in this chat, worked out from the stored
 * messages (so it survives a reload): the latest prompt that started a run and
 * has no answer yet — or whose failed answer was retried.
 */
export function pendingGenerationOf(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (!m.generationId) return null;
    const answers = messages.slice(i + 1).filter((x) => x.role === 'assistant' && x.generationId === m.generationId);
    const open = !answers.some((a) => a.status === 'complete' || (a.status === 'error' && !a.resolved));
    return open ? { generationId: m.generationId, tool: m.tool, intent: m.intent, promptMessageId: m.id, startedAt: m.createdAt } : null;
  }
  return null;
}

/** Follows one AI run until it finishes, then refreshes the chat. */
export function useGeneration(generationId, conversationId) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chatKeys.generation(generationId),
    queryFn: () => getGeneration(generationId),
    enabled: !!generationId,
    refetchInterval: (query) => (TERMINAL.has(query.state.data?.status) ? false : query.state.dataUpdateCount < 10 ? 1500 : 3000),
    refetchIntervalInBackground: true,
    retry: 3,
  });
  const status = q.data?.status;
  useEffect(() => {
    if (!TERMINAL.has(status)) return;
    qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
    qc.invalidateQueries({ queryKey: chatKeys.outputs(conversationId) });
    qc.invalidateQueries({ queryKey: ['chat-history'] });
  }, [status, conversationId, qc]);
  return q;
}

/**
 * Everything one chat needs: its messages (active part only), outputs with every
 * version, the uploaded files they mention, image numbers and the run in progress.
 */
export function useChatThread(conversationId) {
  const convQ = useConversation(conversationId);
  const outputsQ = useQuery({ queryKey: chatKeys.outputs(conversationId), queryFn: () => chatOutputs(conversationId), enabled: !!conversationId });

  // A failed answer that was retried is replaced by the new attempt.
  const messages = useMemo(() => (convQ.data?.messages || []).filter((m) => !(m.status === 'error' && m.resolved)), [convQ.data]);
  const outputsById = useMemo(() => Object.fromEntries((outputsQ.data || []).map((o) => [o.id, o])), [outputsQ.data]);

  const fileIds = useMemo(() => [...new Set(messages.flatMap((m) => (m.role === 'user' ? m.attachmentIds || [] : [])))], [messages]);
  const fileQs = useQueries({
    queries: fileIds.map((id) => ({ queryKey: chatKeys.file(id), queryFn: () => getFile(id), staleTime: 4 * 60_000, retry: 1 })),
  });
  const filesById = useMemo(() => Object.fromEntries(fileQs.filter((q) => q.data).map((q) => [q.data.id, q.data])), [fileQs]);

  const versionsByMessage = useMemo(() => messageVersions(messages, outputsById), [messages, outputsById]);
  const images = useMemo(() => buildImageIndex(messages, outputsById, filesById, versionsByMessage), [messages, outputsById, filesById, versionsByMessage]);
  const pending = useMemo(() => pendingGenerationOf(messages), [messages]);
  const generationQ = useGeneration(pending?.generationId, conversationId);

  return {
    conversation: convQ.data || null,
    conversationQ: convQ,
    outputsQ,
    messages,
    outputsById,
    filesById,
    versionsByMessage,
    images,
    pending: pending ? { ...pending, status: generationQ.data?.status || 'queued' } : null,
  };
}
