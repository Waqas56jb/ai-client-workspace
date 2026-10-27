import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ImageIcon, Layers, Mail, MessageSquarePlus, Palette, PanelRight, X } from 'lucide-react';
import { Button, ErrorState, Page, Segmented, Sheet, Skeleton, Tabs, Tooltip } from '@/components/ui';
import { ClientLogo } from '@/components/data-display';
import {
  AdvertisingForm,
  BrandContextPanel,
  Composer,
  ContextHeader,
  EmptyConversation,
  ImageControls,
  InactiveToolBanner,
  MessageList,
  MessageOutputs,
  OutputInspector,
  PreparedRequestDialog,
  TaskContextPanel,
  ToolChooser,
  ToolIcon,
  ToolSelector,
  VehicleForm,
  WritingControls,
  dimensionError,
  initialForms,
  isToolId,
  vehicleMissingRequired,
} from '@/components/workspace';
import {
  useBreadcrumbs,
  useClient,
  useConversation,
  useConversations,
  useFiles,
  useInstructions,
  useMediaQuery,
  useOutputs,
  usePageTitle,
  usePreferences,
  usePresets,
  useServiceMutation,
  useTask,
} from '@/hooks';
import { aiService, conversationService, fileService, validateUpload } from '@/services';
import { detectFormat } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { ACCEPT_ATTR, IMAGE_ACCEPT_ATTR, TOOL_BY_ID, WRITING_FORMATS } from '@/lib/constants';
import { cn, createId, pluralize } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

const EMPTY_BY_TOOL = { writing: '', image: '', advertising: '', vehicle: '' };
const EMPTY_LIST_BY_TOOL = { writing: [], image: [], advertising: [], vehicle: [] };
const MAX_ATTACHMENTS = 6;

/* ───────────────────────── helpers ───────────────────────── */

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)));
}

function buildOptions(tool, form, prompt) {
  if (tool === 'writing') return compact({ format: form.format, tone: form.tone, length: form.length });
  if (tool === 'image') {
    return compact({
      presetId: form.presetId,
      width: Number(form.width),
      height: Number(form.height),
      count: form.editOutputId ? 1 : form.count,
      editOutputId: form.editOutputId,
    });
  }
  if (tool === 'advertising' || tool === 'vehicle') {
    return compact({ ...form, features: form.features?.map((f) => f.trim()).filter(Boolean), instructions: prompt.trim() });
  }
  return {};
}

function controlsTitle(tool, form) {
  if (tool === 'writing') {
    const f = WRITING_FORMATS.find((x) => x.id === form.format)?.label || 'Format not selected';
    return `Writing options · ${[f, form.tone, form.length].filter(Boolean).join(' · ')}`;
  }
  if (tool === 'image') return `Image settings · ${form.width || '—'} × ${form.height || '—'}px${form.editOutputId ? ' · editing an image' : ` · ${pluralize(form.count, 'image')}`}`;
  if (tool === 'advertising') return `Campaign brief${form.campaignName ? ` · ${form.campaignName}` : ''}${form.platform ? ` · ${form.platform}` : ''}`;
  if (tool === 'vehicle') {
    const name = [form.year, form.make, form.model, form.variant].filter(Boolean).join(' ');
    return `Vehicle details${name ? ` · ${name}` : ''}`;
  }
  return 'Settings';
}

function submitLabel(tool, form) {
  if (tool === 'image') return form.editOutputId ? 'Apply edit' : form.count > 1 ? `Generate ${form.count} images` : 'Generate image';
  if (tool === 'advertising') return 'Generate ad copy';
  if (tool === 'vehicle') return 'Generate listing';
  return 'Send';
}

/* ───────────────────────── page ───────────────────────── */

export default function AiWorkspacePage() {
  const { taskId } = useParams();
  const taskQ = useTask(taskId);
  const task = taskQ.data;
  const clientQ = useClient(task?.clientId);
  const client = clientQ.data;

  usePageTitle(task ? `${task.title} · AI Workspace` : 'AI Workspace');
  useBreadcrumbs(
    task
      ? [
          { label: 'Clients', to: '/clients' },
          { label: task.client?.name || 'Client', to: `/clients/${task.clientId}` },
          { label: task.job?.title || 'Job', to: `/jobs/${task.jobId}` },
          { label: task.title, to: `/tasks/${task.id}` },
          { label: 'AI Workspace' },
        ]
      : [{ label: 'AI Workspace', to: '/ai-workspace' }],
  );

  if (taskQ.isLoading || (task && clientQ.isLoading)) return <WorkspaceSkeleton />;

  const error = taskQ.error || clientQ.error || (!task ? { status: 404, message: 'Task not found.' } : null);
  if (error || !client) {
    return (
      <Page narrow>
        <ErrorState
          title="The workspace could not be opened"
          error={error?.status === 404 ? { ...error, message: 'This task does not exist or was deleted. Pick another task to open the AI workspace.' } : error}
          onRetry={() => (taskQ.error ? taskQ.refetch() : clientQ.refetch())}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button as={Link} to="/tasks" icon={ArrowLeft}>
            Back to tasks
          </Button>
          <Button as={Link} to="/ai-workspace" variant="ghost">
            AI Workspace home
          </Button>
        </div>
      </Page>
    );
  }

  return <Workspace key={task.id} task={task} client={client} />;
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col" role="status" aria-label="Loading workspace">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-4 w-80 max-w-[60%]" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[280px] space-y-3 border-r border-line bg-surface p-4 xl:block">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="mt-6 h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Skeleton className="h-9 w-96 max-w-full" />
          <Skeleton className="h-20 w-2/3" />
          <Skeleton className="h-40 w-3/4" />
          <div className="flex-1" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="hidden w-[340px] space-y-3 border-l border-line bg-surface p-4 xl:block">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── workspace ───────────────────────── */

function SidePanel({ title, onClose, children }) {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        <Button size="icon-sm" variant="ghost" icon={X} onClick={onClose} aria-label={`Close ${title}`} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
    </div>
  );
}

function Workspace({ task, client, variant = 'task', fixedConversationId = null, initialDraft = null, onNewChat }) {
  const job = task.job || { id: task.jobId, title: 'Job' };
  const isAssistant = variant === 'assistant';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [params, setParams] = useSearchParams();

  // ── layout ── (the assistant keeps its details panel closed until asked, and has no task panel)
  const isXl = useMediaQuery('(min-width: 1280px)');
  const storedPanels = useUiStore((s) => s.workspacePanels);
  const setStoredPanel = useUiStore((s) => s.setWorkspacePanel);
  const [assistantPanels, setAssistantPanels] = useState({ left: false, right: false });
  const panels = isAssistant ? assistantPanels : storedPanels;
  const setPanel = isAssistant ? (side, open) => setAssistantPanels((p) => ({ ...p, [side]: open })) : setStoredPanel;
  const [sheet, setSheet] = useState(null);
  const [rightTab, setRightTab] = useState('output');
  const leftOpen = isAssistant ? false : isXl ? panels.left : sheet === 'left';
  const rightOpen = isXl ? panels.right : sheet === 'right';
  const toggle = (side) => (isXl ? setPanel(side, !panels[side]) : setSheet((s) => (s === side ? null : side)));

  // ── data ──
  const convsQ = useConversations(task.id);
  const conversations = useMemo(() => convsQ.data || [], [convsQ.data]);
  const filesQ = useFiles({ taskId: task.id });
  const outputsQ = useOutputs({ taskId: task.id });
  const presetsQ = usePresets({ forClientId: task.clientId });
  const prefsQ = usePreferences();
  const instructionsQ = useInstructions();

  const inactive = useMemo(() => Object.fromEntries((instructionsQ.data || []).map((i) => [i.toolId, i.active === false])), [instructionsQ.data]);
  const presets = useMemo(() => presetsQ.data || [], [presetsQ.data]);
  const presetsById = useMemo(() => Object.fromEntries(presets.map((p) => [p.id, p])), [presets]);
  const outputsById = useMemo(() => Object.fromEntries((outputsQ.data || []).map((o) => [o.id, o])), [outputsQ.data]);
  const filesById = useMemo(() => Object.fromEntries((filesQ.data || []).map((f) => [f.id, f])), [filesQ.data]);
  const imageOutputs = useMemo(() => (outputsQ.data || []).filter((o) => o.kind === 'image'), [outputsQ.data]);

  // ── tool + conversation selection (URL-driven) ──
  const [assistantTool, setAssistantTool] = useState(null);
  const paramTool = isAssistant ? assistantTool : isToolId(params.get('tool')) ? params.get('tool') : null;
  const paramConv = isAssistant ? fixedConversationId : params.get('conversation');
  const taskTool = isToolId(task.type) ? task.type : null;
  const explicitConv = paramConv ? conversations.find((c) => c.id === paramConv) || null : null;
  const preferredTool = paramTool || explicitConv?.tool || taskTool;
  const autoConv = !paramConv ? conversations.find((c) => !preferredTool || !c.tool || c.tool === preferredTool) || null : null;
  const selectedConv = explicitConv || autoConv;
  const tool = paramTool || selectedConv?.tool || taskTool || (isAssistant ? 'writing' : null);
  const toolMeta = TOOL_BY_ID[tool];

  const updateParams = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const selectConversation = (c) => {
    updateParams({ conversation: c.id, tool: c.tool || paramTool });
    setSheet(null);
  };

  const switchTool = (id) => {
    // Advertising and vehicle requests are filled in through their form, so show it.
    if (id === 'advertising' || id === 'vehicle') setControlsOpen(true);
    // In the assistant a chat can mix messages and images, so switching keeps the conversation.
    if (isAssistant) return setAssistantTool(id);
    const patch = { tool: id };
    if (selectedConv?.tool && selectedConv.tool !== id) patch.conversation = null;
    updateParams(patch);
  };

  const convQ = useConversation(selectedConv?.id);
  const messages = useMemo(() => convQ.data?.messages || [], [convQ.data]);

  // ── output selection ──
  const [selectedOutputId, setSelectedOutputId] = useState(null);
  useEffect(() => setSelectedOutputId(null), [selectedConv?.id]);
  const latestMessageFor = useMemo(() => {
    const map = {};
    messages.forEach((m) => m.outputIds?.forEach((id) => (map[id] = m.id)));
    return map;
  }, [messages]);
  const lastOutputId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].outputIds?.length) return messages[i].outputIds[0];
    return null;
  }, [messages]);
  const activeOutputId = selectedOutputId || lastOutputId;
  const sourceOptions = useMemo(() => {
    const idx = messages.findIndex((m) => m.outputIds?.includes(activeOutputId));
    if (idx < 0) return null;
    return messages.slice(0, idx).reverse().find((m) => m.role === 'user')?.requestOptions || null;
  }, [messages, activeOutputId]);

  const showDetails = (id) => {
    setSelectedOutputId(id);
    setRightTab('output');
    if (isXl) setPanel('right', true);
    else setSheet('right');
  };

  // ── per-tool composer state (kept while switching tools) ──
  const [forms, setForms] = useState(() => initialForms({ client, job, defaultPreset: null }));
  const [prompts, setPrompts] = useState(EMPTY_BY_TOOL);
  const [attachments, setAttachments] = useState(EMPTY_LIST_BY_TOOL);
  const [errors, setErrors] = useState({});
  // Options start collapsed on normal-height screens so the conversation stays readable;
  // the collapsed header still shows the current settings (e.g. "Email · Friendly · medium").
  const [controlsOpen, setControlsOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px) and (min-height: 1000px)').matches,
  );
  const imageTouched = useRef(false);

  useEffect(() => {
    if (imageTouched.current || !presets.length || prefsQ.isLoading) return;
    const def = presets.find((p) => p.id === prefsQ.data?.defaultPresetId) || presets.find((p) => !p.isCustom) || presets[0];
    if (def) setForms((f) => ({ ...f, image: { ...f.image, presetId: def.id, width: def.width, height: def.height } }));
  }, [presets, prefsQ.isLoading, prefsQ.data]);

  const updateForm = (t, patch) => {
    if (t === 'image') imageTouched.current = true;
    setForms((f) => ({ ...f, [t]: { ...f[t], ...patch } }));
    setErrors({});
  };
  const setPrompt = (v) => {
    setPrompts((p) => ({ ...p, [tool]: v }));
    if (errors.prompt) setErrors((e) => ({ ...e, prompt: null }));
  };
  const focusPrompt = () => setTimeout(() => document.getElementById('ws-prompt')?.focus(), 30);

  // ── AI mutations ──
  const handleAiError = (err) => {
    if (err?.code === 'tool_inactive' || err?.code === 'TOOL_INACTIVE') {
      toast.error(err.message, { action: { label: 'AI Instructions', onClick: () => navigate('/ai-instructions') } });
    } else {
      toast.error(err?.message || 'The request could not be sent.');
    }
  };

  const sendMut = useServiceMutation((vars) => aiService.send(vars), {
    silent: true,
    onError: handleAiError,
    onSuccess: (d, vars) => {
      setPrompts((p) => ({ ...p, [vars.tool]: '' }));
      setAttachments((a) => ({ ...a, [vars.tool]: [] }));
      if (vars.options?.editOutputId) setForms((f) => ({ ...f, image: { ...f.image, editOutputId: null } }));
      if (d?.conversation?.id && d.conversation.id !== selectedConv?.id) {
        if (isAssistant) navigate(`/chat/${d.conversation.id}`, { replace: true });
        else updateParams({ conversation: d.conversation.id, tool: vars.tool });
      }
      if (isAssistant) qc.invalidateQueries({ queryKey: ['chat-history'] });
      if (d?.outputs?.length) setSelectedOutputId(d.outputs[0].id);
      if (d?.assistantMessage?.status === 'error') toast.error(isMockMode ? 'The simulated AI service failed — use Retry on the message.' : d.assistantMessage.content || 'The AI request failed — use Retry on the message.');
    },
  });

  const retryMut = useServiceMutation((id) => aiService.retry(id, { generationId: messages.find((m) => m.id === id)?.generationId }), {
    silent: true,
    onError: handleAiError,
    onSuccess: (d) => {
      if (d?.outputs?.length) setSelectedOutputId(d.outputs[0].id);
      if (d?.assistantMessage?.status === 'error') toast.error(isMockMode ? 'The simulated AI service failed again — try once more.' : d.assistantMessage.content || 'The AI request failed again — try once more.');
    },
  });

  const clarifyMut = useServiceMutation(
    ({ message, format }) => aiService.send({ taskId: task.id, conversationId: message.conversationId, tool: 'writing', options: { format }, clarifiesMessageId: message.id }),
    {
      silent: true,
      onError: handleAiError,
      onSuccess: (d) => d?.outputs?.length && setSelectedOutputId(d.outputs[0].id),
    },
  );

  const newConvMut = useServiceMutation(() => conversationService.create({ taskId: task.id, tool, title: 'New conversation' }), {
    success: 'New conversation started',
    onSuccess: (c) => {
      updateParams({ conversation: c.id, tool: c.tool });
      setSheet(null);
      focusPrompt();
    },
  });

  const busy = sendMut.isPending || retryMut.isPending || clarifyMut.isPending || newConvMut.isPending;

  // ── assistant: the first message typed on the start screen is sent once, then forgotten ──
  const draftSent = useRef(false);
  useEffect(() => {
    if (!isAssistant || !initialDraft || draftSent.current || selectedConv?.id !== fixedConversationId) return;
    draftSent.current = true;
    if (initialDraft.tool) setAssistantTool(initialDraft.tool);
    if (initialDraft.tool === 'image' && initialDraft.options?.presetId) {
      imageTouched.current = true;
      setForms((f) => ({ ...f, image: { ...f.image, ...initialDraft.options } }));
    }
    if (initialDraft.tool === 'writing') setForms((f) => ({ ...f, writing: { ...f.writing, ...initialDraft.options } }));
    navigate('.', { replace: true, state: null });
    sendMut.mutate({ taskId: task.id, conversationId: fixedConversationId, ...initialDraft });
  }, [isAssistant, initialDraft, selectedConv?.id, fixedConversationId, task.id, navigate, sendMut]);

  // ── quick changes on a text result: sent as a follow-up in the same chat (the AI remembers the draft) ──
  const quickAction = (output, action) => {
    if (busy) return;
    const format = action.format || (['email', 'sms', 'whatsapp', 'other'].includes(output.format) ? output.format : undefined);
    sendMut.mutate({ taskId: task.id, conversationId: selectedConv?.id, tool: 'writing', prompt: action.prompt, options: format ? { format } : {} });
  };
  const form = tool ? forms[tool] : null;
  const prompt = tool ? prompts[tool] : '';
  const toolAttachments = tool ? attachments[tool] : [];

  const submit = () => {
    if (!tool || busy) return;
    if (inactive[tool]) {
      handleAiError({ code: 'tool_inactive', message: `${toolMeta.name} is turned off in AI Instructions. Re-activate it to generate.` });
      return;
    }
    if (toolAttachments.some((a) => a.status === 'uploading')) return;
    const text = prompt.trim();
    if ((tool === 'writing' || tool === 'image') && !text) {
      setErrors({ prompt: tool === 'image' ? 'Describe the image you want before generating.' : 'Enter a prompt before sending.' });
      focusPrompt();
      return;
    }
    if (tool === 'image') {
      const dimErr = dimensionError(form.width, form.height);
      if (dimErr) {
        setErrors({ prompt: dimErr });
        setControlsOpen(true);
        return;
      }
    }
    if (tool === 'vehicle') {
      const missing = vehicleMissingRequired(form);
      if (missing.length) {
        setErrors({ vehicle: Object.fromEntries(missing.map((k) => [k, 'Required'])), prompt: 'Make, model and year are required before generating a listing.' });
        setControlsOpen(true);
        return;
      }
    }
    if (tool === 'advertising' && !form.outputTypes.length) {
      setErrors({ ad: 'Choose at least one output type.', prompt: 'Choose at least one output type in the campaign brief.' });
      setControlsOpen(true);
      return;
    }
    setErrors({});
    // Give the conversation the space once a writing or image request is on its way.
    if (tool === 'writing' || tool === 'image') setControlsOpen(false);
    sendMut.mutate({
      taskId: task.id,
      conversationId: selectedConv?.id,
      tool,
      prompt: text,
      options: buildOptions(tool, form, text),
      attachmentIds: toolAttachments.filter((a) => a.status === 'ready').map((a) => a.id),
    });
  };

  // ── attachments ──
  const addFiles = async (files, forTool = tool) => {
    if (!forTool) return;
    const room = MAX_ATTACHMENTS - attachments[forTool].length;
    if (files.length > room) toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const problem = validateUpload(file) || (forTool === 'image' && !file.type.startsWith('image/') ? `“${file.name}” is not an image. Reference images must be PNG, JPG or WebP.` : null);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const tempId = createId('tmp');
      const item = { id: tempId, name: file.name, size: file.size, file, status: 'uploading' };
      setAttachments((a) => ({ ...a, [forTool]: [...a[forTool], item] }));
      try {
        const rec = await fileService.upload({
          file,
          clientId: task.clientId,
          jobId: task.jobId,
          taskId: task.id,
          category: 'attachment',
          description: forTool === 'image' ? 'Reference image for an AI image request' : 'AI workspace attachment',
        });
        setAttachments((a) => ({ ...a, [forTool]: a[forTool].map((x) => (x.id === tempId ? { ...x, id: rec.id, status: 'ready' } : x)) }));
        qc.invalidateQueries({ queryKey: ['files'] });
        qc.invalidateQueries({ queryKey: ['task'] });
      } catch (e) {
        setAttachments((a) => ({ ...a, [forTool]: a[forTool].filter((x) => x.id !== tempId) }));
        toast.error(e?.message || `Could not attach “${file.name}”.`);
      }
    }
  };
  const removeAttachment = (id) => setAttachments((a) => ({ ...a, [tool]: a[tool].filter((x) => x.id !== id) }));

  const editImage = (outputId) => {
    if (tool !== 'image') switchTool('image');
    updateForm('image', { editOutputId: outputId });
    setControlsOpen(true);
    focusPrompt();
  };

  // ── tool controls ──
  let controls = null;
  if (tool === 'writing') {
    controls = <WritingControls value={form} onChange={(p) => updateForm('writing', p)} detectedFormat={detectFormat(prompt)} clientTone={client.brand?.tone} />;
  } else if (tool === 'image') {
    controls = (
      <ImageControls
        value={form}
        onChange={(p) => updateForm('image', p)}
        presets={presets}
        presetsLoading={presetsQ.isLoading}
        imageOutputs={imageOutputs}
        client={client}
        references={toolAttachments}
        onAddReferences={(files) => addFiles(files, 'image')}
        accept={IMAGE_ACCEPT_ATTR}
      />
    );
  } else if (tool === 'advertising') {
    controls = <AdvertisingForm value={form} onChange={(p) => updateForm('advertising', p)} clientTone={client.brand?.tone} error={errors.ad} />;
  } else if (tool === 'vehicle') {
    controls = <VehicleForm value={form} onChange={(p) => updateForm('vehicle', p)} errors={errors.vehicle} clientWarranty={client.brand?.warranty} />;
  }

  const pendingVars = sendMut.isPending ? sendMut.variables : null;
  const pendingPrompt = pendingVars ? pendingVars.prompt || (pendingVars.tool === 'vehicle' ? 'Vehicle listing from the supplied details' : pendingVars.tool === 'advertising' ? 'Ad copy from the campaign brief' : '') : null;
  const retryTool = retryMut.isPending ? messages.find((m) => m.id === retryMut.variables)?.tool : null;

  const renderOutputs = (m) => (
    <MessageOutputs
      message={m}
      outputsById={outputsById}
      latestMessageFor={latestMessageFor}
      loading={outputsQ.isLoading || outputsQ.isFetching}
      selectedOutputId={activeOutputId}
      onSelect={setSelectedOutputId}
      onShowDetails={showDetails}
      onEditImage={editImage}
      presetsById={presetsById}
      onQuickAction={busy ? undefined : quickAction}
    />
  );

  const [requestMsg, setRequestMsg] = useState(null);

  // ── panels ──
  const leftPanel = (
    <TaskContextPanel
      task={task}
      client={client}
      job={job}
      conversations={conversations}
      conversationsLoading={convsQ.isLoading}
      selectedConversationId={selectedConv?.id}
      onSelectConversation={selectConversation}
      onNewConversation={() => newConvMut.mutate()}
      creatingConversation={newConvMut.isPending}
      files={filesQ.data}
      filesLoading={filesQ.isLoading}
    />
  );

  const rightPanel = (
    <div className="p-4">
      <Tabs
        variant="pill"
        ariaLabel="Details panel"
        value={rightTab}
        onChange={setRightTab}
        tabs={[
          { id: 'output', label: 'Output', icon: Layers },
          { id: 'brand', label: 'Brand context', icon: Palette },
        ]}
        className="mb-4"
      />
      {rightTab === 'output' ? (
        <OutputInspector outputId={activeOutputId} sourceOptions={sourceOptions} presetsById={presetsById} />
      ) : (
        <BrandContextPanel client={client} variant={tool === 'image' ? 'image' : 'full'} />
      )}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[480px] w-full flex-col overflow-hidden">
      {isAssistant ? (
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
          <ClientLogo client={client} size="sm" />
          <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-0">
            <p className="truncate text-[15px] font-semibold leading-5 text-ink">{selectedConv?.title || 'New chat'}</p>
            <p className="truncate text-[12.5px] leading-4 text-muted">
              {client.name} · only this client’s brand details are used
            </p>
          </div>
          <Segmented
            ariaLabel="What do you need"
            value={tool}
            onChange={(id) => !busy && switchTool(id)}
            options={[
              { value: 'writing', label: 'Write', icon: Mail },
              { value: 'image', label: 'Image', icon: ImageIcon },
            ]}
          />
          <Button size="sm" variant={rightOpen ? 'secondary' : 'ghost'} icon={PanelRight} onClick={() => toggle('right')} aria-pressed={rightOpen}>
            Details
          </Button>
          {/* small screens already have "New chat" in the bar above */}
          <span className="hidden lg:block">
            <Button size="sm" variant="primary" icon={MessageSquarePlus} onClick={onNewChat}>
              New chat
            </Button>
          </span>
        </header>
      ) : (
        <ContextHeader task={task} client={client} job={job} leftOpen={leftOpen} rightOpen={rightOpen} onToggleLeft={() => toggle('left')} onToggleRight={() => toggle('right')} />
      )}

      <div className="flex min-h-0 flex-1">
        {isXl && leftOpen && (
          <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-line bg-surface scrollbar-thin" aria-label="Task context">
            {leftPanel}
          </aside>
        )}

        <section className="flex min-w-0 flex-1 flex-col bg-canvas" aria-label="AI conversation">
          {!isAssistant && (
            <div className="shrink-0 border-b border-line bg-surface px-3 py-2 sm:px-5">
              <ToolSelector value={tool} onChange={switchTool} inactive={inactive} disabled={busy} />
            </div>
          )}

          {tool ? (
            <>
              <div className={cn('flex shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-3 py-1.5 sm:px-5', isAssistant && 'hidden')}>
                <ToolIcon tool={tool} size="xs" />
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                  <span className="font-semibold text-ink">{selectedConv ? selectedConv.title : 'New conversation'}</span>
                  {selectedConv ? ` · ${pluralize(messages.length, 'message')}` : ' · your first message starts it'}
                </p>
                {selectedConv && (
                  <Tooltip content="Start a new conversation" side="left">
                    <Button size="xs" variant="ghost" icon={MessageSquarePlus} onClick={() => newConvMut.mutate()} loading={newConvMut.isPending} disabled={busy && !newConvMut.isPending}>
                      <span className="hidden sm:inline">New conversation</span>
                    </Button>
                  </Tooltip>
                )}
              </div>
              {inactive[tool] && (
                <div className="shrink-0 px-3 pt-2 sm:px-5">
                  <InactiveToolBanner tool={tool} />
                </div>
              )}
              <MessageList
                className="min-h-0 flex-1"
                messages={selectedConv ? messages : []}
                pending={sendMut.isPending}
                pendingTool={pendingVars?.tool || retryTool || (clarifyMut.isPending ? 'writing' : tool)}
                pendingPrompt={pendingPrompt}
                pendingUser={user}
                retryingId={retryMut.isPending ? retryMut.variables : null}
                clarifyingId={clarifyMut.isPending ? clarifyMut.variables?.message?.id : null}
                onRetry={(m) => retryMut.mutate(m.id)}
                onClarify={(m, format) => clarifyMut.mutate({ message: m, format })}
                onViewRequest={setRequestMsg}
                filesById={filesById}
                renderOutputs={renderOutputs}
                empty={
                  selectedConv && convQ.isLoading ? (
                    <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
                      <Skeleton className="h-14 w-2/3" />
                      <Skeleton className="h-28 w-3/4" />
                    </div>
                  ) : (
                    <EmptyConversation
                      tool={tool}
                      client={client}
                      job={isAssistant ? null : job}
                      onPick={(ex) => {
                        setPrompts((p) => ({ ...p, [tool]: ex }));
                        focusPrompt();
                      }}
                    />
                  )
                }
              />
              <Composer
                tool={tool}
                value={prompt}
                onChange={setPrompt}
                onSubmit={submit}
                pending={sendMut.isPending}
                disabled={busy || inactive[tool]}
                attachments={toolAttachments}
                onAttach={(files) => addFiles(files)}
                onRemoveAttachment={removeAttachment}
                accept={tool === 'image' ? IMAGE_ACCEPT_ATTR : ACCEPT_ATTR}
                attachLabel={tool === 'image' ? 'Add reference images' : 'Attach files'}
                controls={controls}
                controlsTitle={controlsTitle(tool, form)}
                controlsOpen={controlsOpen}
                onToggleControls={() => setControlsOpen((v) => !v)}
                submitLabel={submitLabel(tool, form)}
                promptLabel={tool === 'advertising' || tool === 'vehicle' ? 'Additional instructions' : 'Prompt'}
                error={errors.prompt}
              />
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              <ToolChooser onChoose={switchTool} inactive={inactive} />
            </div>
          )}
        </section>

        {isXl && rightOpen && (
          <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-line bg-surface scrollbar-thin" aria-label="Output details and brand context">
            {rightPanel}
          </aside>
        )}
      </div>

      {!isXl && (
        <>
          <Sheet open={sheet === 'left'} onClose={() => setSheet(null)} side="left" title="Task context" width="max-w-[320px]">
            <SidePanel title="Task context" onClose={() => setSheet(null)}>
              {leftPanel}
            </SidePanel>
          </Sheet>
          <Sheet open={sheet === 'right'} onClose={() => setSheet(null)} side="right" title="Output details" width="max-w-[380px]">
            <SidePanel title="Output & brand" onClose={() => setSheet(null)}>
              {rightPanel}
            </SidePanel>
          </Sheet>
        </>
      )}

      <PreparedRequestDialog open={!!requestMsg} onClose={() => setRequestMsg(null)} message={requestMsg} messages={messages} taskId={task.id} />
    </div>
  );
}
