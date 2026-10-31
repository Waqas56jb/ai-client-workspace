import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy, FileText, Pencil, RotateCw, Sparkles } from 'lucide-react';
import { Menu, Skeleton } from '@/components/ui';
import { copyToClipboard, cn, formatDateTime } from '@/lib/utils';
import { imageKey } from '@/lib/imageReferences';
import { ChatImage, ImageAnswerCard, TextAnswerCard } from './AnswerCards';
import { RichText } from './RichText';

export function AiMark({ className }) {
  return (
    <span className={cn('ai-gradient inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white', className)} aria-hidden>
      <Sparkles size={17} />
    </span>
  );
}

/** Can this prompt be changed and asked again? (Not regenerate requests or format answers.) */
export function isEditable(m) {
  if (m.role !== 'user' || !['writing', 'image'].includes(m.tool)) return false;
  return !m.generationPrompt || m.generationPrompt === m.content;
}

function Attachments({ message, filesById, images, onUseImage }) {
  if (!message.attachmentIds?.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap justify-end gap-2">
      {message.attachmentIds.map((id) => {
        const f = filesById[id];
        const entry = images.byKey.get(imageKey.file(id));
        if (entry) {
          return (
            <li key={id} className="w-36 overflow-hidden rounded-xl border border-line bg-surface">
              <ChatImage src={entry.src} alt={f?.name || entry.label} ratio="1 / 1" />
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="text-[13.5px] font-semibold text-ink">{entry.label}</span>
                <button type="button" onClick={() => onUseImage(entry)} className="rounded-lg px-1.5 py-1 text-[13.5px] font-semibold text-brand hover:bg-brand-soft focus-ring">
                  Use
                </button>
              </div>
            </li>
          );
        }
        return (
          <li key={id} className="inline-flex max-w-[240px] items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-ink">
            <FileText size={17} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate">{f?.name || 'File'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The user's own message: right-aligned; Edit and Copy are always reachable (hover, focus, or the ⋯ button on touch). */
export function UserMessage({ message: m, filesById, images, canEdit, onSaveEdit, onUseImage }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (editing) {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const copy = async () => (await copyToClipboard(m.content)) ? toast.success('Copied.') : toast.error('Your browser blocked copying.');
  const save = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await onSaveEdit(m, text);
      setEditing(false);
    } catch {
      /* the page shows the error; the edited text stays so the user can try again */
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li className="flex justify-end">
        <div className="w-full max-w-[720px] rounded-2xl border-2 border-brand/40 bg-surface p-3">
          <label htmlFor={`edit-${m.id}`} className="sr-only">
            Change your message
          </label>
          <textarea
            id={`edit-${m.id}`}
            ref={ref}
            value={draft}
            maxLength={8000}
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
            className="block w-full resize-y bg-transparent px-2 py-1.5 text-[17px] leading-[1.6] text-ink outline-none"
          />
          <p className="px-2 pt-1 text-[14px] text-muted">The AI will answer again from here. Later messages in this chat will be hidden (nothing approved is lost).</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="h-11 rounded-xl px-4 text-[15px] font-medium text-muted hover:bg-canvas focus-ring">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving || !draft.trim()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-ring">
              <Check size={18} aria-hidden /> {saving ? 'Sending…' : 'Save & send'}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex flex-col items-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-3 sm:max-w-[720px]">
        <p className="whitespace-pre-wrap break-words text-[17px] leading-[1.6] text-ink">{m.content}</p>
        <Attachments message={m} filesById={filesById} images={images} onUseImage={onUseImage} />
      </div>
      <div className="mt-1 flex items-center gap-1">
        {m.memoryUpdates?.added?.length > 0 && <span className="px-1 text-[13.5px] text-muted">Remembered</span>}
        {m.memoryUpdates?.removed?.length > 0 && <span className="px-1 text-[13.5px] text-muted">Forgotten</span>}
        {m.editedFromId && <span className="px-1 text-[13.5px] text-muted">Edited</span>}
        <time className="px-1 text-[13.5px] text-muted" dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
        <span className="hidden items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:flex">
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[14.5px] font-medium text-muted hover:bg-canvas hover:text-ink focus-ring">
              <Pencil size={16} aria-hidden /> Edit
            </button>
          )}
          <button type="button" onClick={copy} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[14.5px] font-medium text-muted hover:bg-canvas hover:text-ink focus-ring">
            <Copy size={16} aria-hidden /> Copy
          </button>
        </span>
        <span className="md:hidden">
          <Menu
            size="lg"
            width={200}
            label="Message options"
            items={[canEdit && { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true) }, { label: 'Copy', icon: Copy, onSelect: copy }]}
          />
        </span>
      </div>
    </li>
  );
}

/** The AI's turn: a short line, a format question, an error with "Try again", or the answer cards. */
export function AssistantMessage({ message: m, isLast, busy, outputsById, versions, images, latestTextOutputId, onClarify, onRetry, onQuickChange, onEditImage, onRegenerate, onImagesExpired }) {
  const outputs = (m.outputIds || []).map((id, i) => ({ output: outputsById[id], version: versions?.[i] })).filter((x) => x.output);
  const missing = (m.outputIds || []).length > outputs.length;

  if (m.status === 'error') {
    return (
      <li className="flex gap-3">
        <AiMark />
        <div className="min-w-0 flex-1 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3" role="alert">
          <p className="flex items-start gap-2 text-[16px] leading-[1.6] text-ink">
            <AlertTriangle size={19} className="mt-1 shrink-0 text-danger" aria-hidden />
            <span>
              Something went wrong. <span className="text-muted">{m.content}</span>
            </span>
          </p>
          {m.generationId && (
            <button type="button" onClick={() => onRetry(m.generationId)} disabled={busy} className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-surface px-4 text-[15px] font-semibold text-ink shadow-card hover:bg-canvas disabled:opacity-60 focus-ring">
              <RotateCw size={17} aria-hidden /> Try again
            </button>
          )}
        </div>
      </li>
    );
  }

  // A direct answer (no saved draft or picture): the text itself is the result.
  const isAnswer = !(m.outputIds || []).length && m.status !== 'clarify';
  if (isAnswer) {
    const copy = async () => ((await copyToClipboard(m.content)) ? toast.success('Copied.') : toast.error('Your browser blocked copying.'));
    return (
      <li className="flex gap-3">
        <AiMark />
        <div className="min-w-0 flex-1 pt-1">
          <RichText text={m.content} className="break-words text-[17px] leading-[1.65] text-ink" />
          <button type="button" onClick={copy} className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[14.5px] font-medium text-muted hover:bg-canvas hover:text-ink focus-ring">
            <Copy size={16} aria-hidden /> Copy
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex gap-3">
      <AiMark />
      <div className="min-w-0 flex-1 space-y-3">
        {m.content && <p className="whitespace-pre-wrap break-words pt-1.5 text-[16px] leading-[1.6] text-muted">{m.content}</p>}
        {m.status === 'clarify' && !m.resolved && isLast && m.options?.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a format">
            {m.options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={() => onClarify(m, o.id)}
                className="h-11 rounded-full border border-brand/40 bg-surface px-5 text-[15.5px] font-semibold text-brand hover:bg-brand-soft disabled:opacity-60 focus-ring"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {outputs.map(({ output, version }) =>
          output.kind === 'image' ? (
            <ImageAnswerCard
              key={`${output.id}-${version?.id}`}
              output={output}
              version={version}
              entry={version ? images.byKey.get(imageKey.version(version.id)) : null}
              busy={busy}
              onEdit={onEditImage}
              onRegenerate={() => onRegenerate(output)}
              onExpired={onImagesExpired}
            />
          ) : (
            <TextAnswerCard
              key={`${output.id}-${version?.id}`}
              output={output}
              version={version}
              latest={latestTextOutputId === output.id && isLast}
              busy={busy}
              onQuickChange={onQuickChange}
              onRegenerate={() => onRegenerate(output)}
            />
          ),
        )}
        {missing && !outputs.length && <Skeleton className="h-40 w-full max-w-[640px] rounded-2xl" />}
      </div>
    </li>
  );
}

const STATUS_TEXT = {
  queued: 'Waiting to start…',
  answer: 'Thinking…',
  edit_image: 'Editing the picture… This usually takes 30–90 seconds.',
  image: 'Creating your image… This usually takes 30–90 seconds.',
  writing: 'Writing your message…',
};

/** The answer that is still being made. The words follow the real server status and what the assistant decided. */
export function GenerationStatus({ pending }) {
  const running = pending.status === 'running';
  const key = pending.intent === 'answer' ? 'answer' : pending.intent === 'edit_image' ? 'edit_image' : pending.tool === 'image' ? 'image' : 'writing';
  const text = running ? STATUS_TEXT[key] : STATUS_TEXT.queued;
  // The words as the AI writes them (answers and drafts), like ChatGPT.
  if (pending.liveText) {
    return (
      <li className="flex gap-3" aria-live="polite" aria-busy="true">
        <AiMark />
        <div className="min-w-0 flex-1 pt-1">
          {key === 'answer' ? (
            <RichText text={pending.liveText} className="break-words text-[17px] leading-[1.65] text-ink" />
          ) : (
            <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">
              <p className="mb-2 text-[14px] font-medium text-muted">Writing your draft…</p>
              <p className="whitespace-pre-wrap break-words text-[17px] leading-[1.65] text-ink">{pending.liveText}</p>
            </div>
          )}
          <span className="typing-caret ml-0.5 inline-block h-5 w-[3px] translate-y-1 rounded-sm bg-brand" aria-hidden />
        </div>
      </li>
    );
  }
  return (
    <li className="flex gap-3" role="status" aria-live="polite">
      <AiMark />
      <div className="min-w-0 flex-1 space-y-3 pt-1.5">
        <p className="flex items-center gap-2.5 text-[16px] font-medium text-ink">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="typing-dot h-2 w-2 rounded-full bg-brand" style={{ animationDelay: `${i * 0.16}s` }} />
            ))}
          </span>
          {text}
        </p>
        {pending.intent === 'answer' ? null : pending.tool === 'image' ? <Skeleton className="aspect-square w-full max-w-[420px] rounded-2xl" /> : <Skeleton className="h-28 w-full max-w-[640px] rounded-2xl" />}
      </div>
    </li>
  );
}

/** The message being sent right now (shown before the server has stored it). */
export function SendingMessage({ text, attachmentCount }) {
  return (
    <li className="flex flex-col items-end opacity-80">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-3 sm:max-w-[720px]">
        <p className="whitespace-pre-wrap break-words text-[17px] leading-[1.6] text-ink">{text}</p>
        {attachmentCount > 0 && <p className="mt-2 text-[14px] text-muted">{attachmentCount === 1 ? '1 file attached' : `${attachmentCount} files attached`}</p>}
      </div>
      <p className="mt-1 px-1 text-[13.5px] text-muted" role="status">Working out what you need…</p>
    </li>
  );
}
