import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowUp, History, ImageIcon, ImagePlus, Loader2, Mail, Paperclip, Sparkles, X } from 'lucide-react';
import { Button, Select, Sheet } from '@/components/ui';
import { ChatHistoryPanel } from '@/components/assistant/ChatHistoryPanel';
import { AssistantConversation } from '@/features/ai-workspace/AiWorkspacePage';
import { useBreadcrumbs, useClients, useMediaQuery, usePageTitle, usePresets } from '@/hooks';
import { conversationService, fileService, validateUpload } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

/**
 * AI Assistant: a simple, chat-first place to write client emails / SMS /
 * WhatsApp messages and to create or edit images. Every chat belongs to a
 * client (so the AI uses only that client's brand) and is kept in the history.
 */

export const ASSISTANT_TONES = [
  { value: '', label: 'Professional (default)' },
  { value: 'Persuasive', label: 'Persuasive / sales-focused' },
  { value: 'Professional', label: 'Professional / neutral' },
  { value: 'Formal', label: 'Formal' },
  { value: 'Casual', label: 'Casual (plain English)' },
];

const FORMATS = [
  { value: '', label: 'Ask me' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const WRITE_SUGGESTIONS = [
  { title: 'Improve my email', prompt: 'Please improve this email so it is clear, professional and persuasive:\n\n' },
  { title: 'Follow up after a meeting', prompt: 'Write an email to my client following up on our meeting and confirming the next steps.' },
  { title: 'Remind a client', prompt: 'Write a friendly WhatsApp message reminding my client about their campaign review this week.' },
  { title: 'Shorten for SMS', prompt: 'Shorten this message so it works as an SMS:\n\n' },
];
const IMAGE_SUGGESTIONS = [
  { title: 'Product on white', prompt: 'A clean product photo on a plain white background, soft shadow, no text' },
  { title: 'Sale banner', prompt: 'A bright, modern banner for a weekend sale using the brand colours, no text' },
  { title: 'Edit my photo', prompt: 'Make the background of my photo bright and clean, keep everything else the same', upload: true },
  { title: 'Social post', prompt: 'An eye-catching social media image of a happy customer moment, natural light, no text' },
];

const LAST_CLIENT_KEY = 'studioflow.assistant.client';
const readLastClient = () => {
  try {
    return localStorage.getItem(LAST_CLIENT_KEY) || '';
  } catch {
    return '';
  }
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function AssistantPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const [historyOpen, setHistoryOpen] = useState(false);
  usePageTitle('AI Assistant');
  useBreadcrumbs([{ label: 'AI Assistant', to: '/assistant' }, ...(conversationId ? [{ label: 'Chat' }] : [])]);

  useEffect(() => setHistoryOpen(false), [conversationId]);
  const newChat = () => navigate('/assistant');
  const history = <ChatHistoryPanel activeId={conversationId} onNewChat={newChat} />;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[480px] w-full overflow-hidden">
      {isLg && <aside className="w-[300px] shrink-0 border-r border-line">{history}</aside>}
      <div className="flex min-w-0 flex-1 flex-col">
        {!isLg && (
          <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-3 py-2">
            <Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryOpen(true)}>
              Chat history
            </Button>
            {conversationId && (
              <Button size="sm" variant="ghost" icon={Sparkles} onClick={newChat}>
                New chat
              </Button>
            )}
          </div>
        )}
        {conversationId ? (
          <AssistantConversation key={conversationId} conversationId={conversationId} initialDraft={location.state?.draft} onNewChat={newChat} />
        ) : (
          <AssistantHome />
        )}
      </div>
      {!isLg && (
        <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} side="left" title="Chat history" width="max-w-[320px]">
          {history}
        </Sheet>
      )}
    </div>
  );
}

/* ───────────────────────── start a chat ───────────────────────── */

function AssistantHome() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clientsQ = useClients();
  const clients = useMemo(() => (clientsQ.data || []).filter((c) => c.status !== 'archived'), [clientsQ.data]);
  const [clientId, setClientId] = useState(readLastClient);
  const [mode, setMode] = useState('writing');
  const [format, setFormat] = useState('');
  const [tone, setTone] = useState('');
  const [presetId, setPresetId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const textRef = useRef(null);

  const client = clients.find((c) => c.id === clientId);
  useEffect(() => {
    if (!clientsQ.isLoading && clientId && !client) setClientId('');
  }, [clientsQ.isLoading, clientId, client]);

  const presetsQ = usePresets({ forClientId: clientId || undefined }, { enabled: mode === 'image' });
  const presets = useMemo(() => presetsQ.data || [], [presetsQ.data]);
  useEffect(() => {
    if (mode === 'image' && presets.length && !presets.some((p) => p.id === presetId)) setPresetId(presets.find((p) => !p.isCustom)?.id || presets[0].id);
  }, [mode, presets, presetId]);
  const preset = presets.find((p) => p.id === presetId);

  const pickClient = (id) => {
    setClientId(id);
    setError('');
    try {
      localStorage.setItem(LAST_CLIENT_KEY, id);
    } catch {
      /* remembering the client is optional */
    }
  };

  const addFiles = (list) => {
    const next = [];
    for (const f of list) {
      const problem = validateUpload(f) || (mode === 'image' && !f.type.startsWith('image/') ? `“${f.name}” is not an image.` : null);
      if (problem) toast.error(problem);
      else next.push(f);
    }
    setFiles((prev) => [...prev, ...next].slice(0, 4));
  };

  const applySuggestion = (s) => {
    setPrompt(s.prompt);
    if (s.upload) fileRef.current?.click();
    setTimeout(() => {
      const el = textRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 30);
  };

  const send = async () => {
    const text = prompt.trim();
    if (!clientId) return setError('Choose the client this is for — the AI then uses only that client’s brand details.');
    if (!text) return setError(mode === 'image' ? 'Describe the image you want, or what to change in your photo.' : 'Type or paste your message first.');
    if (mode === 'image' && !preset) return setError('Choose an image size.');
    setError('');
    setSending(true);
    try {
      const session = await conversationService.assistantSession(clientId);
      const attachmentIds = [];
      for (const file of files) {
        const rec = await fileService.upload({ file, clientId, jobId: session.jobId, taskId: session.taskId, category: 'attachment', description: 'Added in the AI Assistant' });
        attachmentIds.push(rec.id);
      }
      const title = text.replace(/\s+/g, ' ').slice(0, 60) || (mode === 'image' ? 'Image' : 'Message');
      const conv = await conversationService.create({ taskId: session.taskId, tool: mode, title });
      const options =
        mode === 'image'
          ? { presetId: preset.id, width: preset.width, height: preset.height, count: 1 }
          : Object.fromEntries(Object.entries({ format, tone }).filter(([, v]) => v));
      navigate(`/assistant/c/${conv.id}`, { state: { draft: { tool: mode, prompt: text, options, attachmentIds } } });
    } catch (e) {
      setSending(false);
      toast.error(e?.message || 'The chat could not be started. Please try again.');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!sending) send();
    }
  };

  const firstName = (user?.name || '').split(' ')[0];
  const suggestions = mode === 'image' ? IMAGE_SUGGESTIONS : WRITE_SUGGESTIONS;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas scrollbar-thin">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-16 pt-10 sm:pt-16">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-pop" aria-hidden>
          <Sparkles size={26} />
        </span>
        <h1 className="mt-5 text-center font-display text-[30px] font-bold leading-tight tracking-tight text-ink sm:text-[38px]">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="mt-2 max-w-xl text-center text-[16px] leading-7 text-muted">
          {mode === 'image' ? 'Describe an image to create, or upload a photo and say what to change.' : 'Paste an email to improve, or tell me what to write — email, SMS or WhatsApp.'}
        </p>

        <div className="mt-8 w-full rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
          {/* step 1 — who and what */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink">1. Client</span>
              <Select
                value={clientId}
                onChange={(e) => pickClient(e.target.value)}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={clientsQ.isLoading ? 'Loading clients…' : 'Choose a client'}
                invalid={!!error && !clientId}
              />
            </label>
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-ink">2. What do you need?</span>
              <div role="radiogroup" aria-label="What do you need" className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1">
                {[
                  { id: 'writing', label: 'Write a message', icon: Mail },
                  { id: 'image', label: 'Create an image', icon: ImageIcon },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => {
                      setMode(m.id);
                      setFiles([]);
                      setError('');
                    }}
                    className={cn(
                      'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[13.5px] font-medium transition-colors focus-ring',
                      mode === m.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                    )}
                  >
                    <m.icon size={16} aria-hidden />
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* step 3 — options */}
          {mode === 'writing' ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-ink">3. Format</span>
                <div role="radiogroup" aria-label="Format" className="flex flex-wrap gap-1.5">
                  {FORMATS.map((f) => (
                    <button
                      key={f.value || 'ask'}
                      type="button"
                      role="radio"
                      aria-checked={format === f.value}
                      onClick={() => setFormat(f.value)}
                      className={cn(
                        'h-9 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors focus-ring',
                        format === f.value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink">Tone</span>
                <Select value={tone} onChange={(e) => setTone(e.target.value)} options={ASSISTANT_TONES} />
              </label>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink">3. Image size</span>
                <Select
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                  options={presets.map((p) => ({ value: p.id, label: `${p.name} · ${p.width}×${p.height}` }))}
                  placeholder={presetsQ.isLoading ? 'Loading sizes…' : presets.length ? undefined : 'No sizes yet'}
                />
              </label>
              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-ink">Photo to edit (optional)</span>
                <Button icon={ImagePlus} className="w-full justify-center" onClick={() => fileRef.current?.click()}>
                  Upload a photo
                </Button>
              </div>
            </div>
          )}

          {/* step 4 — the message */}
          <div className={cn('mt-4 rounded-xl border bg-surface transition-colors focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/15', error ? 'border-danger' : 'border-line')}>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached files">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 text-[12.5px] text-ink">
                    <Paperclip size={13} className="shrink-0 text-subtle" aria-hidden />
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="rounded text-subtle hover:text-ink focus-ring" aria-label={`Remove ${f.name}`}>
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="assistant-prompt" className="sr-only">
              Your message
            </label>
            <textarea
              id="assistant-prompt"
              ref={textRef}
              rows={5}
              value={prompt}
              maxLength={8000}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={onKeyDown}
              placeholder={mode === 'image' ? 'Describe the image, or what to change in your photo…' : 'Paste your draft email here to improve it, or describe what you need…'}
              className="block max-h-[45vh] min-h-[132px] w-full resize-y bg-transparent px-4 py-3 text-[15.5px] leading-7 text-ink outline-none placeholder:text-subtle"
            />
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={mode === 'image' ? 'image/png,image/jpeg,image/webp' : undefined}
                className="hidden"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => fileRef.current?.click()}>
                {mode === 'image' ? 'Add photo' : 'Attach file'}
              </Button>
              <span className="hidden text-[12px] text-subtle sm:inline">Enter to send · Shift+Enter for a new line</span>
              <span className="ml-auto text-[12px] tabular-nums text-subtle">{prompt.length} / 8000</span>
              <Button variant="primary" iconRight={sending ? undefined : ArrowUp} onClick={send} disabled={sending} aria-label="Send">
                {sending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden /> Starting…
                  </>
                ) : mode === 'image' ? (
                  'Create image'
                ) : (
                  'Send'
                )}
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}
          {client && (
            <p className="mt-3 text-[12.5px] leading-5 text-muted">
              Only <strong className="font-semibold text-ink">{client.name}</strong>’s brand details are used. This chat is saved in your history.
            </p>
          )}
        </div>

        <h2 className="mt-10 text-center text-[12px] font-semibold uppercase tracking-[0.1em] text-subtle">Not sure where to start? Try one of these</h2>
        <div className="mt-3 grid w-full gap-3 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => applySuggestion(s)}
              className="rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/40 focus-ring"
            >
              <span className="block text-[14.5px] font-semibold text-ink">{s.title}</span>
              <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-muted">{s.prompt.trim() || s.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
