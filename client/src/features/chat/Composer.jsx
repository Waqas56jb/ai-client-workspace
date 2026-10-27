import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, ChevronDown, FileText, ImageIcon, Loader2, Mail, Paperclip, RotateCw, SlidersHorizontal, Wand2, X } from 'lucide-react';
import { FILE_ACCEPT, PHOTO_ACCEPT } from '@/lib/fileValidation';
import { cn, formatBytes } from '@/lib/utils';

export const FORMATS = [
  { value: '', label: 'Let AI ask' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];
export const TONES = [
  { value: '', label: 'Client’s usual tone' },
  { value: 'Professional', label: 'Professional' },
  { value: 'Formal', label: 'Formal' },
  { value: 'Persuasive', label: 'Persuasive' },
  { value: 'Casual', label: 'Casual' },
];

function AttachmentChip({ item, onRemove, onRetry }) {
  const bad = item.status === 'error' || item.status === 'invalid';
  return (
    <li className={cn('flex w-full max-w-[300px] items-center gap-2.5 rounded-xl border bg-surface p-2', bad ? 'border-danger/40' : 'border-line')}>
      {item.previewUrl ? (
        <img src={item.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted">{item.isImage ? <ImageIcon size={20} /> : <FileText size={20} />}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-ink" title={item.name}>
          {item.name}
        </span>
        {item.status === 'uploading' && (
          <>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round((item.progress || 0) * 100)}%` }} />
            </span>
            <span className="mt-0.5 block text-[13px] text-muted">Uploading… {item.progress ? `${Math.round(item.progress * 100)}%` : ''}</span>
          </>
        )}
        {item.status === 'waiting' && <span className="mt-0.5 block text-[13px] text-muted">Getting ready…</span>}
        {item.status === 'ready' && <span className="block text-[13px] text-success">Ready to send · {formatBytes(item.size)}</span>}
        {bad && <span className="block text-[13px] leading-4 text-danger">{item.error}</span>}
      </span>
      {item.status === 'error' && (
        <button type="button" onClick={() => onRetry(item.id)} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-[13.5px] font-semibold text-brand hover:bg-brand-soft focus-ring" aria-label={`Try uploading ${item.name} again`}>
          <RotateCw size={15} aria-hidden /> Try again
        </button>
      )}
      <button type="button" onClick={() => onRemove(item.id)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink focus-ring" aria-label={`Remove ${item.name}`}>
        <X size={18} />
      </button>
    </li>
  );
}

function ReferenceChip({ entry, note, onRemove }) {
  return (
    <li className="flex max-w-[340px] items-center gap-2.5 rounded-xl border border-brand/40 bg-brand-soft/60 p-2">
      {entry.src ? <img src={entry.src} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <Wand2 size={20} className="mx-3 text-brand" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold text-ink">Using {entry.label}</span>
        <span className="block truncate text-[13px] text-muted">{note || 'Your next message changes this picture.'}</span>
      </span>
      <button type="button" onClick={onRemove} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink focus-ring" aria-label={`Don’t use ${entry.label}`}>
        <X size={18} />
      </button>
    </li>
  );
}

function OptionsPopover({ mode, writing, onWriting, presets, presetsLoading, presetId, onPreset, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => !ref.current?.contains(e.target) && !e.target.closest?.('[data-options-trigger]') && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const select = 'h-12 w-full rounded-xl border border-line bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15';
  return (
    <div ref={ref} role="dialog" aria-label="Options" className="absolute bottom-full left-0 z-30 mb-2 w-[min(360px,calc(100vw-2rem))] space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-pop">
      {mode === 'writing' ? (
        <>
          <div>
            <p className="mb-2 text-[15px] font-semibold text-ink">What is it?</p>
            <div role="radiogroup" aria-label="Format" className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.value || 'ask'}
                  type="button"
                  role="radio"
                  aria-checked={writing.format === f.value}
                  onClick={() => onWriting({ format: f.value })}
                  className={cn('h-11 rounded-full border px-4 text-[15px] font-medium focus-ring', writing.format === f.value ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink hover:bg-canvas')}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-2 block text-[15px] font-semibold text-ink">Tone</span>
            <select className={select} value={writing.tone} onChange={(e) => onWriting({ tone: e.target.value })}>
              {TONES.map((t) => (
                <option key={t.value || 'default'} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label className="block">
          <span className="mb-2 block text-[15px] font-semibold text-ink">Picture size</span>
          <select className={select} value={presetId} onChange={(e) => onPreset(e.target.value)} disabled={presetsLoading || !presets.length}>
            {presetsLoading && <option>Loading sizes…</option>}
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.width} × {p.height}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" onClick={onClose} className="h-11 w-full rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-hover focus-ring">
        Done
      </button>
    </div>
  );
}

/**
 * The one place to type. Visible choices: Add photo or file · Write / Image · Options · Send.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  sending,
  blockedReason,
  mode,
  onModeChange,
  writing,
  onWriting,
  presets,
  presetsLoading,
  presetId,
  onPreset,
  uploads,
  reference,
  referenceNote,
  onClearReference,
  hint,
  error,
  textareaRef,
  fileInputRef,
}) {
  const ownFileRef = useRef(null);
  const fileRef = fileInputRef || ownFileRef;
  const localRef = useRef(null);
  const ta = textareaRef || localRef;
  const [optionsOpen, setOptionsOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [value, ta]);

  const preset = presets.find((p) => p.id === presetId);
  const optionsLabel =
    mode === 'writing'
      ? [FORMATS.find((f) => f.value === writing.format)?.label, writing.tone || null].filter(Boolean).join(' · ')
      : preset
        ? `${preset.name}`
        : 'Picture size';
  const canSend = !sending && !blockedReason && !!value.trim() && !uploads.uploading && !uploads.failed;

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      uploads.add(files);
    }
  };

  const waitText = uploads.uploading ? 'Wait for the upload to finish…' : uploads.failed ? 'A file did not upload. Try again or remove it.' : null;

  return (
    <div className="mx-auto w-full max-w-[920px] px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 sm:px-8">
      {hint && (
        <p className="mb-2 flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-2.5 text-[15px] leading-6 text-info" role="note">
          <Paperclip size={18} className="mt-0.5 shrink-0" aria-hidden />
          {hint}
        </p>
      )}
      <div className={cn('rounded-[26px] border bg-surface shadow-pop transition-colors focus-within:border-brand/60', error ? 'border-danger' : 'border-line')}>
        {(uploads.items.length > 0 || reference) && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached to this message">
            {reference && <ReferenceChip entry={reference} note={referenceNote} onRemove={onClearReference} />}
            {uploads.items.map((item) => (
              <AttachmentChip key={item.id} item={item} onRemove={uploads.remove} onRetry={uploads.retry} />
            ))}
          </ul>
        )}
        <label htmlFor="chat-input" className="sr-only">
          Your message
        </label>
        <textarea
          id="chat-input"
          ref={ta}
          rows={1}
          value={value}
          maxLength={8000}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={mode === 'image' ? 'Describe the picture, or what to change…' : 'Paste your draft or say what to write…'}
          className="block max-h-[40vh] min-h-[60px] w-full resize-none bg-transparent px-5 pb-2 pt-4 text-[17px] leading-[1.55] text-ink outline-none placeholder:text-subtle"
        />
        <div className="relative flex flex-wrap items-center gap-2 px-3 pb-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={mode === 'image' ? PHOTO_ACCEPT : FILE_ACCEPT}
            className="hidden"
            data-testid="chat-file-input"
            onChange={(e) => {
              uploads.add(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Add photo or file"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-[15px] font-semibold text-ink hover:bg-canvas focus-ring"
          >
            <Paperclip size={18} aria-hidden />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add photo or file</span>
          </button>
          <div role="radiogroup" aria-label="Write or image" className="inline-flex h-11 rounded-full border border-line bg-canvas p-1">
            {[
              { id: 'writing', label: 'Write', icon: Mail },
              { id: 'image', label: 'Image', icon: ImageIcon },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => onModeChange(m.id)}
                className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 text-[15px] font-semibold transition-colors focus-ring', mode === m.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
              >
                <m.icon size={17} aria-hidden /> {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-options-trigger
            onClick={() => setOptionsOpen((o) => !o)}
            aria-expanded={optionsOpen}
            className="inline-flex h-11 max-w-[220px] items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-muted hover:bg-canvas hover:text-ink focus-ring"
          >
            <SlidersHorizontal size={17} aria-hidden />
            <span className="truncate">{optionsLabel || 'Options'}</span>
            <ChevronDown size={16} aria-hidden />
          </button>
          {optionsOpen && (
            <OptionsPopover
              mode={mode}
              writing={writing}
              onWriting={onWriting}
              presets={presets}
              presetsLoading={presetsLoading}
              presetId={presetId}
              onPreset={onPreset}
              onClose={() => setOptionsOpen(false)}
            />
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label={mode === 'image' ? 'Create image' : 'Send'}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-[16px] font-semibold text-white shadow-[0_1px_2px_rgba(81,69,208,0.35)] transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted disabled:shadow-none focus-ring"
          >
            {sending ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <ArrowUp size={19} aria-hidden />}
            {sending ? 'Sending…' : mode === 'image' ? 'Create' : 'Send'}
          </button>
        </div>
      </div>
      {(error || blockedReason || waitText) && (
        <p className={cn('mt-2 flex items-start gap-1.5 px-2 text-[15px] leading-6', error ? 'font-medium text-danger' : 'text-muted')} role={error ? 'alert' : 'status'}>
          {error && <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden />}
          {error || waitText || blockedReason}
        </p>
      )}
    </div>
  );
}
