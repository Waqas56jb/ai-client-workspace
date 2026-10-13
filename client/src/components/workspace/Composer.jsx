import { useRef } from 'react';
import { ChevronDown, FileText, Loader2, Paperclip, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { Button, Kbd, Tooltip } from '@/components/ui';
import { useObjectUrl } from '@/hooks';
import { TOOL_BY_ID } from '@/lib/constants';
import { cn, formatBytes } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');

function AttachmentThumb({ item, onRemove }) {
  const url = useObjectUrl(item.file && item.file.type?.startsWith('image/') ? item.file : null);
  return (
    <li className="group relative">
      <div className={cn('flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-line bg-canvas', item.status === 'uploading' && 'opacity-60')} title={`${item.name} · ${formatBytes(item.size)}`}>
        {url ? <img src={url} alt={item.name} className="h-full w-full object-cover" /> : <FileText size={20} className="text-subtle" aria-hidden />}
        {item.status === 'uploading' && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={16} className="animate-spin text-brand" aria-label="Uploading" />
          </span>
        )}
      </div>
      <span className="mt-0.5 block w-16 truncate text-[10.5px] text-muted">{item.name}</span>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card hover:text-danger focus-ring"
        aria-label={`Remove ${item.name}`}
      >
        <X size={11} />
      </button>
    </li>
  );
}

/** Thumbnail tray for selected attachments / reference images. */
export function AttachmentTray({ items, onRemove, className }) {
  if (!items?.length) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2.5', className)} aria-label="Attachments">
      {items.map((it) => (
        <AttachmentThumb key={it.id} item={it} onRemove={onRemove} />
      ))}
    </ul>
  );
}

/**
 * Prompt composer: tool controls (collapsible), attachments, multiline prompt,
 * Ctrl/⌘+Enter to send, and the primary Generate action.
 */
export function Composer({
  tool,
  value,
  onChange,
  onSubmit,
  pending,
  disabled,
  attachments,
  onAttach,
  onRemoveAttachment,
  accept,
  attachLabel = 'Attach files',
  controls,
  controlsTitle,
  controlsOpen,
  onToggleControls,
  submitLabel = 'Send',
  placeholder,
  error,
  promptLabel,
}) {
  const fileRef = useRef(null);
  const t = TOOL_BY_ID[tool];
  const uploading = attachments?.some((a) => a.status === 'uploading');

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!pending && !disabled && !uploading) onSubmit();
    }
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface/95 px-3 pb-3 pt-2.5 backdrop-blur sm:px-5">
      <div className="mx-auto w-full max-w-4xl">
        {controls && (
          <div className="mb-2.5 rounded-xl border border-line bg-canvas/60">
            <button
              type="button"
              onClick={onToggleControls}
              aria-expanded={controlsOpen}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-semibold text-ink focus-ring rounded-xl"
            >
              <SlidersHorizontal size={14} style={{ color: t?.color }} aria-hidden />
              {controlsTitle || `${t?.short} settings`}
              <ChevronDown size={14} className={cn('ml-auto text-muted transition-transform', controlsOpen && 'rotate-180')} aria-hidden />
            </button>
            {controlsOpen && <div className="max-h-[38vh] overflow-y-auto border-t border-line px-3 py-3 scrollbar-thin">{controls}</div>}
          </div>
        )}

        <div className={cn('rounded-xl border bg-surface shadow-card transition-colors focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/15', error ? 'border-danger' : 'border-line')}>
          <AttachmentTray items={attachments} onRemove={onRemoveAttachment} className="px-3 pt-3" />
          <label htmlFor="ws-prompt" className="sr-only">
            {promptLabel || 'Prompt'}
          </label>
          <textarea
            id="ws-prompt"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder={placeholder || t?.placeholder}
            disabled={pending}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'ws-prompt-error' : undefined}
            className="block max-h-56 min-h-[76px] w-full resize-y bg-transparent px-3.5 py-2.5 text-[14px] leading-6 text-ink outline-none placeholder:text-subtle disabled:text-muted scrollbar-thin"
          />
          <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
            {onAttach && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={accept}
                  className="hidden"
                  onChange={(e) => {
                    onAttach(Array.from(e.target.files || []));
                    e.target.value = '';
                  }}
                />
                <Tooltip content={attachLabel}>
                  <Button size="icon-sm" variant="ghost" icon={Paperclip} onClick={() => fileRef.current?.click()} disabled={pending} aria-label={attachLabel} />
                </Tooltip>
              </>
            )}
            <span className="hidden items-center gap-1 text-[11.5px] text-subtle sm:inline-flex">
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>Enter</Kbd> to send
            </span>
            <span className="ml-auto hidden text-[11px] text-subtle md:inline">{isMockMode ? 'Simulated response · no OpenAI call' : 'Generated with OpenAI'}</span>
            <Button variant="ai" icon={pending ? undefined : Sparkles} loading={pending} disabled={disabled || uploading} onClick={onSubmit} className="ml-auto md:ml-0">
              {pending ? 'Generating…' : submitLabel}
            </Button>
          </div>
        </div>
        {error && (
          <p id="ws-prompt-error" role="alert" className="mt-1.5 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
