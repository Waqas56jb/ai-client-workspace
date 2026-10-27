import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Expand, History, ImageOff, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { Menu } from '@/components/ui';
import { ApproveButton, ImagePreviewDialog, OutputHistoryDialog } from '@/components/approvals';
import { useOutputActions } from '@/components/workspace';
import { versionText } from '@/services';
import { versionImageSrc } from '@/lib/media';
import { WRITING_FORMATS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** One-click follow-ups under the latest written answer (sent as a new message; the AI remembers the draft). */
export const QUICK_CHANGES = [
  { id: 'shorter', label: 'Shorter', prompt: 'Make the message above shorter. Keep every key fact.' },
  { id: 'formal', label: 'More formal', prompt: 'Rewrite the message above in a more formal tone.' },
  { id: 'persuasive', label: 'More persuasive', prompt: 'Rewrite the message above to be more persuasive, without being pushy.' },
  { id: 'casual', label: 'Casual', prompt: 'Rewrite the message above in a casual tone, in plain English that is very easy to understand.' },
  { id: 'sms', label: 'As SMS', prompt: 'Shorten the message above so it works as an SMS.', format: 'sms' },
  { id: 'whatsapp', label: 'As WhatsApp', prompt: 'Rewrite the message above as a WhatsApp message.', format: 'whatsapp' },
  { id: 'alternatives', label: '2 other versions', prompt: 'Give me 2 alternative versions of the message above.' },
];

const actionBtn =
  'inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-canvas focus-ring disabled:opacity-50';

function StatusPill({ approved }) {
  return (
    <span className={cn('inline-flex h-7 items-center rounded-full px-2.5 text-[13.5px] font-semibold', approved ? 'bg-success-soft text-success' : 'bg-canvas text-muted')}>
      {approved ? 'Approved' : 'Draft'}
    </span>
  );
}

/** A written answer: the text is the hero; Copy · Download · Approve; quick changes under the latest one. */
export function TextAnswerCard({ output, version, latest, busy, onQuickChange, onRegenerate }) {
  const [history, setHistory] = useState(false);
  const { copy, download } = useOutputActions(output);
  const v = version || output.currentVersion;
  const approved = output.approvedVersionId === v?.id;
  const format = WRITING_FORMATS.find((f) => f.id === output.format);
  const text = v?.sections ? null : v?.content;

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-label={`Written answer: ${output.title}, version ${v?.versionNumber}`}>
      <header className="flex flex-wrap items-center gap-2 px-5 pt-4">
        {format && <span className="inline-flex h-7 items-center rounded-full bg-brand-soft px-2.5 text-[13.5px] font-semibold text-brand">{format.label}</span>}
        <span className="text-[14px] font-medium text-muted">v{v?.versionNumber}</span>
        <StatusPill approved={approved} />
      </header>
      <div className="px-5 pb-2 pt-3">
        {text != null ? (
          <p className="whitespace-pre-wrap break-words text-[17px] leading-[1.65] text-ink">{text}</p>
        ) : (
          <div className="space-y-3">
            {(v?.sections || []).map((s) => (
              <div key={s.id || s.label}>
                <p className="text-[14px] font-semibold text-muted">{s.label}</p>
                <p className="whitespace-pre-wrap break-words text-[17px] leading-[1.65] text-ink">{s.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-2">
        <button type="button" className={actionBtn} onClick={() => copy(versionText(v))}>
          <Copy size={18} aria-hidden /> Copy
        </button>
        <button type="button" className={actionBtn} onClick={() => download(v)}>
          <Download size={18} aria-hidden /> Download
        </button>
        <ApproveButton output={output} version={v} size="lg" label="Approve" className="h-11 rounded-xl px-4 text-[15px]" />
        <span className="flex-1" />
        <Menu
          size="lg"
          width={240}
          label="More options for this answer"
          items={[
            { label: 'Write it again', icon: RefreshCw, onSelect: onRegenerate, disabled: busy },
            { label: 'All versions', icon: History, onSelect: () => setHistory(true) },
          ]}
        />
      </div>
      {latest && onQuickChange && (
        <div className="border-t border-line px-5 py-3">
          <p className="mb-2 text-[14px] font-semibold text-muted">Quick changes</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap sm:overflow-visible">
            {QUICK_CHANGES.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => onQuickChange(output, a)}
                className="h-10 shrink-0 rounded-full border border-line bg-surface px-4 text-[15px] font-medium text-ink transition-colors hover:border-brand/50 hover:bg-brand-soft hover:text-brand focus-ring disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <OutputHistoryDialog open={history} onClose={() => setHistory(false)} outputId={output.id} initialVersionId={v?.id} />
    </article>
  );
}

/** Image with a calm loading state; an expired link triggers one refresh of the chat's images. */
export function ChatImage({ src, alt, ratio, onExpired, className }) {
  const [state, setState] = useState('loading');
  useEffect(() => setState(src ? 'loading' : 'error'), [src]);
  return (
    <div className={cn('checkerboard relative w-full overflow-hidden', className)} style={{ aspectRatio: ratio }}>
      {src && (
        <img
          key={src}
          src={src}
          alt={alt}
          decoding="async"
          loading="lazy"
          onLoad={() => setState('ready')}
          onError={() => {
            setState('error');
            onExpired?.();
          }}
          className={cn('h-full w-full object-contain transition-opacity duration-300', state === 'ready' ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {state === 'loading' && (
        <span className="absolute inset-0 flex items-center justify-center gap-2 bg-canvas/60 text-[15px] font-medium text-muted">
          <Loader2 size={20} className="animate-spin" aria-hidden /> Loading image…
        </span>
      )}
      {state === 'error' && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/80 px-4 text-center text-[15px] text-muted">
          <ImageOff size={22} aria-hidden /> The picture can’t be shown right now. Download still works.
        </span>
      )}
    </div>
  );
}

/** An image answer: big picture with its "Image N" label; Download · Approve · Edit this image. */
export function ImageAnswerCard({ output, version, entry, busy, onEdit, onRegenerate, onExpired }) {
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const { download } = useOutputActions(output);
  const v = version || output.currentVersion;
  const img = v?.image;
  const src = useMemo(() => versionImageSrc(v), [v]);
  const approved = output.approvedVersionId === v?.id;
  const w = img?.actualWidth ?? img?.requestedWidth;
  const h = img?.actualHeight ?? img?.requestedHeight;

  return (
    <article className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-label={`${entry?.label || 'Image'}: ${output.title}`}>
      <div className="relative">
        <button type="button" onClick={() => setPreview(true)} className="block w-full focus-ring" aria-label={`Open ${entry?.label || 'image'} full size`}>
          <ChatImage src={src} alt={output.title} ratio={img ? `${img.requestedWidth} / ${img.requestedHeight}` : '1 / 1'} onExpired={onExpired} className="max-h-[560px]" />
        </button>
        {entry && <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-[#17182B]/80 px-2.5 py-1 text-[14px] font-semibold text-white">{entry.label}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-3">
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink" title={output.title}>
          {output.title}
        </p>
        <StatusPill approved={approved} />
      </div>
      <p className="px-4 text-[14px] text-muted">
        {w && h ? `${w} × ${h} px` : ''} · v{v?.versionNumber}
      </p>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-3">
        <button type="button" className={actionBtn} onClick={() => download(v)}>
          <Download size={18} aria-hidden /> Download
        </button>
        <ApproveButton output={output} version={v} size="lg" label="Approve" className="h-11 rounded-xl px-4 text-[15px]" />
        <button type="button" disabled={busy} onClick={() => onEdit(entry)} className={cn(actionBtn, 'border-brand/40 text-brand hover:bg-brand-soft')}>
          <Wand2 size={18} aria-hidden /> Edit this image
        </button>
        <span className="flex-1" />
        <Menu
          size="lg"
          width={240}
          label="More options for this image"
          items={[
            { label: 'Open full size', icon: Expand, onSelect: () => setPreview(true) },
            { label: 'Make another like it', icon: RefreshCw, onSelect: onRegenerate, disabled: busy },
            { label: 'All versions', icon: History, onSelect: () => setHistory(true) },
          ]}
        />
      </div>
      <ImagePreviewDialog
        open={preview}
        onClose={() => setPreview(false)}
        src={src}
        title={`${entry?.label ? `${entry.label} · ` : ''}${output.title} · v${v?.versionNumber}`}
        subtitle="The download is the full-size file."
        requested={img ? { width: img.requestedWidth, height: img.requestedHeight } : undefined}
        onDownload={() => download(v)}
        footerNote="Preview is scaled to fit"
      />
      <OutputHistoryDialog open={history} onClose={() => setHistory(false)} outputId={output.id} initialVersionId={v?.id} />
    </article>
  );
}
