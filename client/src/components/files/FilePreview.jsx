import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Expand, FileWarning } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { fileIconFor } from '@/components/data-display/Entities';
import { ImagePreviewDialog } from '@/components/approvals/ImagePreview';
import { useFileSource } from '@/hooks';
import { versionText } from '@/services';
import { cn, copyToClipboard, formatBytes } from '@/lib/utils';
import { fileTypeLabel, isCsv, isTextLike, STORAGE_INFO } from './fileMeta';
import { isMockMode } from '@/lib/config';

/** Clear "no preview" panel — never a broken image. */
export function UnavailablePreview({ file, reason, className }) {
  const Icon = fileIconFor(file);
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="relative mb-4">
        <span className="flex h-20 w-16 items-center justify-center rounded-xl border border-line bg-gradient-to-b from-white to-canvas text-subtle shadow-card">
          <Icon size={30} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-warning">
          <FileWarning size={13} aria-hidden />
        </span>
      </div>
      <p className="max-w-full truncate text-[14px] font-semibold text-ink">{file.name}</p>
      <p className="mt-0.5 text-xs text-muted">
        {fileTypeLabel(file)} · {formatBytes(file.size)}
      </p>
      <p className="mt-3 max-w-md text-[13px] leading-5 text-muted">{reason}</p>
    </div>
  );
}

function OutputTextPreview({ version }) {
  const copy = async () => {
    if (await copyToClipboard(versionText(version))) toast.success('Content copied to clipboard');
    else toast.error('Could not copy to the clipboard.');
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <p className="text-xs text-muted">
          Showing <span className="font-medium text-ink">v{version.versionNumber}</span> (current version)
        </p>
        <Button size="xs" icon={Copy} onClick={copy}>
          Copy content
        </Button>
      </div>
      <div className="max-h-[560px] overflow-y-auto px-5 py-4 scrollbar-thin">
        {version.sections?.length ? (
          <div className="space-y-4">
            {version.sections.map((s) => (
              <div key={s.id || s.label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.label}</p>
                <p className="prose-output mt-1">{s.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="prose-output">{version.content || 'This version has no text content.'}</p>
        )}
      </div>
    </div>
  );
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 101)
    .map((line) => {
      const cells = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"' && quoted) {
          cur += '"';
          i += 1;
        } else if (ch === '"') quoted = !quoted;
        else if (ch === ',' && !quoted) {
          cells.push(cur);
          cur = '';
        } else cur += ch;
      }
      cells.push(cur);
      return cells;
    });
}

function TextFilePreview({ file, src }) {
  const [state, setState] = useState({ loading: true, text: '', error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, text: '', error: null });
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error('The file could not be loaded.');
        return r.text();
      })
      .then((text) => !cancelled && setState({ loading: false, text, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, text: '', error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [src]);
  const rows = useMemo(() => (isCsv(file) && state.text ? parseCsv(state.text) : null), [file, state.text]);

  if (state.loading) {
    return (
      <div className="space-y-2.5 p-5" role="status" aria-label="Loading preview">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }
  if (state.error) return <UnavailablePreview file={file} reason={`${state.error} Try downloading it instead.`} />;

  const copy = async () => {
    if (await copyToClipboard(state.text)) toast.success('Content copied to clipboard');
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <p className="text-xs text-muted">{rows ? `${Math.max(0, rows.length - 1)} rows${rows.length > 100 ? ' (first 100 shown)' : ''}` : 'Text preview'}</p>
        <Button size="xs" icon={Copy} onClick={copy}>
          Copy content
        </Button>
      </div>
      {rows ? (
        <div className="max-h-[560px] overflow-auto scrollbar-thin">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr>
                {rows[0].map((h, i) => (
                  <th key={i} className="sticky top-0 border-b border-line bg-canvas px-3 py-2 font-semibold text-ink">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1, 101).map((r, i) => (
                <tr key={i} className="odd:bg-surface even:bg-canvas/40">
                  {r.map((c, j) => (
                    <td key={j} className="whitespace-nowrap border-b border-line px-3 py-1.5 text-ink">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-6 text-ink scrollbar-thin">{state.text}</pre>
      )}
    </div>
  );
}

/**
 * Preview area for a file record: image (click to zoom), generated text output,
 * fetched text/CSV, or a clear explanation when no preview is possible.
 * @param {{ file, onDownload?: () => void }} props
 */
export function FilePreview({ file, onDownload }) {
  const [zoom, setZoom] = useState(false);
  const isOutputText = file.kind === 'text' && !!file.output?.currentVersion;
  const wantsSource = !isOutputText && (file.kind === 'image' || isTextLike(file));
  const { src, loading, unavailable } = useFileSource(wantsSource ? file : null);

  if (isOutputText) return <OutputTextPreview version={file.output.currentVersion} />;

  if (wantsSource && loading) {
    return (
      <div className="p-5">
        <Skeleton className="aspect-[4/3] w-full rounded-lg" />
      </div>
    );
  }

  if (file.kind === 'image' && src) {
    const img = file.output?.currentVersion?.image;
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} className="group relative block w-full focus-ring" aria-label={`Open ${file.name} in the image viewer`}>
          <div className="checkerboard flex max-h-[560px] min-h-[280px] items-center justify-center overflow-hidden p-4">
            <img src={src} alt={file.name} className="max-h-[520px] max-w-full object-contain shadow-card" />
          </div>
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-ink/75 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Expand size={13} aria-hidden /> View &amp; zoom
          </span>
        </button>
        <ImagePreviewDialog
          open={zoom}
          onClose={() => setZoom(false)}
          src={src}
          title={file.name}
          subtitle={[file.client?.name, file.job?.title, file.task?.title].filter(Boolean).join(' / ')}
          requested={img ? { width: img.requestedWidth, height: img.requestedHeight } : undefined}
          onDownload={onDownload}
          footerNote={img ? (isMockMode ? 'Demo render — PNG downloads are rasterised to the exact requested size.' : 'Generated with OpenAI — downloads use the stored file at its verified size.') : undefined}
        />
      </>
    );
  }

  if (isTextLike(file) && src) return <TextFilePreview file={file} src={src} />;

  let reason;
  if (unavailable) reason = unavailable;
  else if (file.storage === 'record-only') reason = STORAGE_INFO['record-only'].description;
  else if (/pdf/.test(file.mimeType || '')) reason = isMockMode ? 'PDF previews aren’t available in the demo. Download the file to open it in your PDF viewer.' : 'PDF previews aren’t available in the browser. Download the file to open it in your PDF viewer.';
  else reason = 'An in-browser preview isn’t available for this file type. Download it to open it in its native app.';
  return <UnavailablePreview file={file} reason={reason} />;
}
