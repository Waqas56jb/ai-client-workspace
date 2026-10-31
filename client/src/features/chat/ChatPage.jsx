import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmDialog, ErrorState, Sheet, Skeleton } from '@/components/ui';
import { qk, useClient, useClients, useMediaQuery, usePageTitle, usePresets } from '@/hooks';
import { conversationService } from '@/services';
import { newIdempotencyKey } from '@/services/apiClient';
import { regenerateOutput, retryGeneration, sendMessage, startSession, startWriting } from '@/services/chatApi';
import { mentionsPhoto, suggestImageReference } from '@/lib/imageReferences';
import { isMockMode } from '@/lib/config';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { ChatSidebar, RenameDialog, useArchiveChat } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { ChatThread } from './ChatThread';
import { ChatEmptyState } from './ChatEmptyState';
import { ClientPicker } from './ClientPicker';
import { MemoryDialog, memoryKey } from './MemoryDialog';
import { Composer, FORMATS } from './Composer';
import { chatKeys, useChatThread } from './useChatData';
import { useUploads } from './useUploads';

/** Applies the chosen theme while the chat is open (other pages keep the light theme). */
function useChatTheme() {
  const theme = useChatStore((s) => s.theme);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    return () => delete root.dataset.theme;
  }, [resolved]);
}

const compact = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== '' && v != null));

/**
 * The chat workspace (ChatGPT-style): sidebar with clients and chat history, one
 * thread, one composer. Jobs and tasks stay behind the scenes: each client has an
 * "AI Assistant" place on the server that holds its chats and files.
 */
export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const user = useAuthStore((s) => s.user);
  const { clientId: storedClientId, format, tone, presetId: storedPresetId, sidebarOpen } = useChatStore();
  const { setClientId, setWriting, setPresetId, setSidebarOpen } = useChatStore.getState();
  useChatTheme();

  // ── who the chat is for ──
  const clientsQ = useClients();
  const clients = useMemo(() => (clientsQ.data || []).filter((c) => c.status !== 'archived'), [clientsQ.data]);
  const thread = useChatThread(conversationId);
  const conv = thread.conversation;
  useEffect(() => {
    if (conv?.clientId && conv.clientId !== storedClientId) setClientId(conv.clientId); // the open chat's client shows in the picker
  }, [conv?.clientId, storedClientId, setClientId]);
  useEffect(() => {
    if (clientsQ.isSuccess && storedClientId && !conversationId && !clients.some((c) => c.id === storedClientId)) setClientId('');
  }, [clientsQ.isSuccess, clients, storedClientId, conversationId, setClientId]);
  const clientId = conversationId ? conv?.clientId || '' : clients.some((c) => c.id === storedClientId) ? storedClientId : '';
  const archivedClientQ = useClient(conv && !clients.some((c) => c.id === conv.clientId) ? conv.clientId : null);
  const client = clients.find((c) => c.id === clientId) || archivedClientQ.data || null;

  const sessionQ = useQuery({
    queryKey: ['assistant-session', clientId],
    queryFn: () => startSession(clientId),
    enabled: !!clientId && !conversationId && !isMockMode,
    staleTime: Infinity,
    retry: 1,
  });
  const scope = conv
    ? { clientId: conv.clientId, jobId: conv.jobId, taskId: conv.taskId }
    : sessionQ.data && clientId
      ? { clientId, jobId: sessionQ.data.jobId, taskId: sessionQ.data.taskId }
      : null;

  usePageTitle(conv?.title || 'Chat');

  // ── composer state ──
  const uploads = useUploads(scope, 'any', clientId);
  const [draft, setDraft] = useState('');
  const [reference, setReference] = useState(null); // { entry, note } chosen with "Use" / "Edit this image"
  const [dismissedKey, setDismissedKey] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(null);
  const [confirmClient, setConfirmClient] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef(null);
  const textRef = useRef(null);
  const fileRef = useRef(null);
  const { clear: clearUploads } = uploads;

  const resetComposer = useCallback(() => {
    setDraft('');
    setReference(null);
    setDismissedKey(null);
    setError('');
    clearUploads();
  }, [clearUploads]);
  useEffect(() => {
    setReference(null);
    setDismissedKey(null);
    setError('');
  }, [conversationId]);
  // Text typed for one client never travels to another client's chat (files are cleared by useUploads).
  const lastClient = useRef(clientId);
  useEffect(() => {
    if (lastClient.current && clientId && lastClient.current !== clientId) setDraft('');
    lastClient.current = clientId || lastClient.current;
  }, [clientId]);

  const presetsQ = usePresets({ forClientId: clientId || undefined }, { enabled: !!clientId });
  const presets = useMemo(() => (presetsQ.data || []).filter((p) => !p.archived), [presetsQ.data]);
  const preset = presets.find((p) => p.id === storedPresetId) || presets.find((p) => !p.isCustom) || presets[0] || null;

  // "use Image 2…" / "the image above" → a visible, removable chip (never a silent guess)
  const suggestion = useMemo(() => (!reference ? suggestImageReference(draft, thread.images) : null), [reference, draft, thread.images]);
  const autoRef = suggestion && suggestion.entry.key !== dismissedKey ? suggestion : null;
  const activeRef = reference?.entry || autoRef?.entry || null;
  const refNote = reference
    ? reference.note
    : autoRef
      ? `You wrote “${autoRef.entry.label}”, so this picture will be used.`
      : null;
  const hint =
    mentionsPhoto(draft) && !activeRef && !uploads.items.length && !thread.images.list.length
      ? 'Did you mean to add a photo? Tap “Add photo or file” to add it — the AI can only use pictures you add.'
      : null;

  const blockedReason = isMockMode
    ? 'The chat needs the live server. Open it with the API connected.'
    : !clientId
      ? 'Choose the client first.'
      : !scope
        ? sessionQ.isError
          ? 'This client’s chat could not be opened. Reload the page and try again.'
          : 'Getting ready…'
        : thread.pending
          ? 'Please wait — the answer above is still being made.'
          : null;

  // ── sending ──
  const refreshChat = async (convId) => {
    if (!convId) return;
    await qc.fetchQuery({ queryKey: qk.conversation(convId), queryFn: () => conversationService.get(convId), staleTime: 0 });
    qc.invalidateQueries({ queryKey: chatKeys.outputs(convId) });
  };

  /** One request at a time; the text stays in the box until the server has accepted it. */
  const startRequest = async ({ display, attachmentCount = 0, call, fromComposer = false }) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setError('');
    setSending({ text: display || null, attachmentCount });
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    try {
      const res = await call(keyRef.current);
      keyRef.current = null;
      if (fromComposer) resetComposer();
      const convId = res?.conversation?.id;
      const mem = res?.memoryUpdates;
      if (mem?.added?.length || mem?.removed?.length) {
        qc.invalidateQueries({ queryKey: memoryKey(clientId) });
        toast.success(mem.added.length ? `Remembered: ${mem.added.join(' · ')}` : `Forgotten: ${mem.removed.join(' · ')}`, { action: { label: 'View', onClick: () => setMemoryOpen(true) } });
      }
      await refreshChat(convId);
      qc.invalidateQueries({ queryKey: ['chat-history'] });
      if (convId && convId !== conversationId) navigate(`/chat/${convId}`);
      return res;
    } catch (e) {
      // Same key again only when the server may not have heard us (network); otherwise a fresh one.
      if (e?.status !== 0) keyRef.current = null;
      const msg = e?.message || 'Something went wrong. Please try again.';
      setError(msg);
      if (!fromComposer) toast.error(msg);
      throw e;
    } finally {
      inFlight.current = false;
      setSending(null);
    }
  };

  // The user's preferences travel with every message; the server uses them only when they apply.
  const preferences = compact({ format, tone, presetId: preset?.id, width: preset?.width, height: preset?.height });
  const refOf = (e) => (e.kind === 'generated' ? { outputId: e.outputId, versionId: e.versionId } : { fileId: e.fileId });

  const send = () => {
    const text = draft.trim();
    if (!text && !uploads.readyIds.length) return setError('Type a message or add a file first.');
    if (blockedReason || uploads.uploading || uploads.failed) return;
    const attachmentIds = [...uploads.readyIds];
    startRequest({
      display: text || (attachmentIds.length === 1 ? '(1 file)' : `(${attachmentIds.length} files)`),
      attachmentCount: attachmentIds.length + (activeRef ? 1 : 0),
      fromComposer: true,
      call: (key) =>
        sendMessage({
          taskId: scope.taskId,
          conversationId: conversationId || undefined,
          prompt: text,
          attachmentIds,
          imageRefs: activeRef ? [refOf(activeRef)] : [],
          options: preferences,
          idempotencyKey: key,
        }),
    }).catch(() => {});
  };

  const handlers = {
    onClarify: (m, f) =>
      startRequest({
        display: FORMATS.find((x) => x.value === f)?.label || f,
        call: (key) => startWriting({ taskId: conv.taskId, conversationId, options: { format: f }, clarifiesMessageId: m.id, idempotencyKey: key }),
      }).catch(() => {}),
    onRetry: (generationId) =>
      startRequest({
        display: null,
        call: async (key) => {
          const res = await retryGeneration(generationId, key);
          qc.setQueryData(chatKeys.generation(generationId), (old) => ({ ...(old || {}), status: 'queued' }));
          qc.invalidateQueries({ queryKey: chatKeys.generation(generationId) });
          return res;
        },
      }).catch(() => {}),
    onQuickChange: (output, action) =>
      startRequest({
        display: action.prompt,
        call: (key) =>
          sendMessage({ taskId: conv.taskId, conversationId, prompt: action.prompt, options: compact({ ...preferences, format: action.format || output.format }), idempotencyKey: key }),
      }).catch(() => {}),
    onRegenerate: (output) => startRequest({ display: output.kind === 'image' ? 'Make another like it' : 'Write it again', call: (key) => regenerateOutput(output.id, key) }).catch(() => {}),
    onUseImage: (entry) => {
      if (!entry) return;
      setReference({ entry, note: entry.kind === 'generated' ? 'Your next message changes this picture. It keeps its size.' : 'Your next picture will be made from this photo.' });
      setTimeout(() => textRef.current?.focus(), 30);
    },
    // The changed message is understood again from scratch (with the part of the chat before it).
    onSaveEdit: (m, text) =>
      startRequest({
        display: text,
        call: (key) =>
          sendMessage({ taskId: conv.taskId, conversationId, prompt: text, attachmentIds: m.attachmentIds, options: preferences, replacesMessageId: m.id, idempotencyKey: key }),
      }),
    onImagesExpired: (() => {
      let last = 0;
      return () => {
        if (Date.now() - last < 60_000) return;
        last = Date.now();
        qc.invalidateQueries({ queryKey: chatKeys.outputs(conversationId) });
        qc.invalidateQueries({ queryKey: ['chat-file'] });
      };
    })(),
  };

  // ── navigation ──
  const newChat = () => {
    setSidebarOpen(false);
    resetComposer();
    navigate('/');
    setTimeout(() => textRef.current?.focus(), 50);
  };
  const applyClient = (id) => {
    setClientId(id);
    resetComposer();
    setSidebarOpen(false);
    if (conversationId) navigate('/');
  };
  const changeClient = (id) => {
    if (id === clientId) return;
    if (draft.trim() || uploads.items.length) setConfirmClient(id);
    else applyClient(id);
  };
  const archive = useArchiveChat(() => navigate('/'));

  const starter = (s) => {
    if (s.format) setWriting({ format: s.format });
    setDraft(s.prompt);
    setTimeout(() => {
      const el = textRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }, 30);
    if (s.pickPhoto) {
      if (!scope) toast.error('Choose the client first, then add your photo.');
      else setTimeout(() => fileRef.current?.click(), 60);
    }
  };

  // ── drag and drop anywhere on the chat ──
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropProps = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => hasFiles(e) && e.preventDefault(),
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      uploads.add(e.dataTransfer.files);
    },
  };

  const sidebar = (
    <ChatSidebar
      activeId={conversationId}
      clients={clients}
      clientsQ={clientsQ}
      clientId={clientId}
      onClientChange={changeClient}
      onNewChat={newChat}
      onNavigate={() => setSidebarOpen(false)}
      onClose={isDesktop ? undefined : () => setSidebarOpen(false)}
    />
  );

  const convError = thread.conversationQ.error;
  let body;
  if (!conversationId) {
    body = (
      <ChatEmptyState
        firstName={(user?.name || '').split(' ')[0]}
        onStarter={starter}
        clientPicker={
          !clientId ? (
            <ClientPicker clients={clients} loading={clientsQ.isLoading} error={clientsQ.isError} onRetry={() => clientsQ.refetch()} value={clientId} onChange={changeClient} />
          ) : null
        }
      />
    );
  } else if (convError) {
    body = (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorState
          title="This chat could not be opened"
          error={convError.status === 404 ? { ...convError, message: 'This chat no longer exists. Pick another one or start a new chat.' } : convError}
          onRetry={() => thread.conversationQ.refetch()}
          action={
            <Link to="/" className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-white focus-ring">
              New chat
            </Link>
          }
        />
      </div>
    );
  } else if (!conv) {
    body = (
      <div className="mx-auto w-full max-w-[920px] flex-1 space-y-6 px-4 py-8 sm:px-8" role="status" aria-label="Loading chat">
        <Skeleton className="ml-auto h-16 w-2/3 rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  } else {
    body = <ChatThread thread={thread} sending={sending} busy={!!sending} handlers={handlers} />;
  }

  return (
    <div className="flex h-dvh min-h-[480px] w-full overflow-hidden bg-canvas text-ink">
      <a href="#chat-input" className="sr-only z-[100] rounded-lg bg-brand px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to the message box
      </a>
      {isDesktop ? (
        <aside className="h-full w-[300px] shrink-0 border-r border-line" aria-label="Chats and clients">
          {sidebar}
        </aside>
      ) : (
        <Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} side="left" title="Chats and clients" width="max-w-[340px]">
          {sidebar}
        </Sheet>
      )}
      <main id="main" className="relative flex min-w-0 flex-1 flex-col bg-surface" {...dropProps}>
        <ChatHeader
          client={client}
          title={conv?.title || (conversationId ? '' : 'New chat')}
          onOpenMenu={isDesktop ? undefined : () => setSidebarOpen(true)}
          onRename={conv ? () => setRenaming(conv) : undefined}
          onArchive={conv ? () => archive(conv) : undefined}
          onMemory={client ? () => setMemoryOpen(true) : undefined}
        />
        {body}
        <Composer
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (error) setError('');
          }}
          onSubmit={send}
          sending={!!sending}
          blockedReason={blockedReason}
          writing={{ format, tone }}
          onWriting={setWriting}
          presets={presets}
          presetsLoading={presetsQ.isLoading}
          presetId={preset?.id || ''}
          onPreset={setPresetId}
          uploads={uploads}
          reference={activeRef}
          referenceNote={refNote}
          onClearReference={() => (reference ? setReference(null) : autoRef && setDismissedKey(autoRef.entry.key))}
          hint={hint}
          error={error}
          textareaRef={textRef}
          fileInputRef={fileRef}
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-3xl border-4 border-dashed border-brand bg-brand-soft/80">
            <p className="text-[20px] font-semibold text-brand">Drop your photo or file to add it</p>
          </div>
        )}
      </main>
      <ConfirmDialog
        open={!!confirmClient}
        onClose={() => setConfirmClient(null)}
        onConfirm={() => {
          applyClient(confirmClient);
          setConfirmClient(null);
        }}
        title="Start a new chat for this client?"
        description="Your unsent message and added files will be cleared, so nothing from this client goes to the other one."
        confirmLabel="Yes, start new chat"
      />
      <RenameDialog key={renaming?.id || 'none'} chat={renaming} onClose={() => setRenaming(null)} />
      <MemoryDialog open={memoryOpen} onClose={() => setMemoryOpen(false)} client={client} />
    </div>
  );
}
