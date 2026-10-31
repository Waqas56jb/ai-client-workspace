import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConversation, qk } from '@/hooks';
import { chatOutputs, getFile, getGeneration, streamGeneration } from '@/services/chatApi';
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

  // The answer being written stays on screen until the typewriter has shown all of
  // it — even if the finished message arrives first — so it never jumps.
  const [stickyState, setSticky] = useState(null);
  useEffect(() => {
    if (pending && pending.tool !== 'image') setSticky({ conversationId, generationId: pending.generationId, tool: pending.tool, intent: pending.intent, promptMessageId: pending.promptMessageId });
  }, [conversationId, pending?.generationId, pending?.tool, pending?.intent, pending?.promptMessageId]); // eslint-disable-line react-hooks/exhaustive-deps
  // only ever for the chat that is open
  const sticky = stickyState?.conversationId === conversationId ? stickyState : null;
  const live = useLiveText(sticky?.generationId || null);
  const finishing = !!sticky && !pending && live.shown.length < live.full.length;
  const shownMessages = useMemo(
    () => (finishing ? messages.filter((m) => !(m.role === 'assistant' && m.generationId === sticky.generationId)) : messages),
    [finishing, messages, sticky],
  );

  let shownPending = null;
  if (pending) shownPending = { ...pending, status: live.shown ? 'running' : generationQ.data?.status || 'queued', liveText: pending.tool === 'image' ? '' : live.shown };
  else if (finishing) shownPending = { ...sticky, status: 'running', liveText: live.shown };

  return {
    conversation: convQ.data || null,
    conversationQ: convQ,
    outputsQ,
    messages: shownMessages,
    outputsById,
    filesById,
    versionsByMessage,
    images,
    pending: shownPending,
  };
}

/** Typewriter speed: a comfortable reading pace, faster when a lot is waiting (it catches up in ~2 s). */
const BASE_CHARS_PER_SECOND = 280;
const CATCH_UP_SECONDS = 2;

/**
 * The text of an answer while the AI writes it, token by token.
 *  full  — everything received so far from GET /ai/generations/:id/stream
 *  shown — what is on screen: it follows `full` like a typewriter, so the answer
 *          is written out even when the model delivers it in a burst.
 * Empty when streaming is unavailable: the chat then waits for the finished answer, as before.
 */
export function useLiveText(generationId) {
  const [full, setFull] = useState('');
  const [shown, setShown] = useState('');
  const fullRef = useRef('');

  useEffect(() => {
    setFull('');
    setShown('');
    fullRef.current = '';
    if (!generationId) return undefined;
    const ctrl = new AbortController();
    streamGeneration(generationId, {
      signal: ctrl.signal,
      onText: (t) => {
        fullRef.current = t;
        setFull(t);
      },
    }).catch(() => {});
    return () => ctrl.abort();
  }, [generationId]);

  useEffect(() => {
    if (shown.length >= full.length) return undefined;
    let frame;
    let last = performance.now();
    let count = shown.length;
    const step = (now) => {
      const target = fullRef.current;
      const backlog = target.length - count;
      if (backlog <= 0) return;
      const speed = Math.max(BASE_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS);
      count = Math.min(target.length, count + Math.max(1, Math.round(((now - last) / 1000) * speed)));
      last = now;
      setShown(target.slice(0, count));
      if (count < target.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  return { full, shown };
}
