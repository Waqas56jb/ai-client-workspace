import { Link } from 'react-router-dom';
import { FileText, FileImage, File as FileIcon, FileSpreadsheet, FileType2, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui';
import { useFile, useFileSource } from '@/hooks';
import { CLIENT_STATUS_BY_ID, JOB_STATUS_BY_ID, TASK_STATUS_BY_ID, TASK_TYPE_BY_ID, TOOL_BY_ID } from '@/lib/constants';
import { cn, initials } from '@/lib/utils';
import { versionImageSrc } from '@/lib/media';

const LOGO_SIZES = { xs: 'h-5 w-5 text-[9px] rounded', sm: 'h-7 w-7 text-[10px] rounded-md', md: 'h-9 w-9 text-xs rounded-lg', lg: 'h-12 w-12 text-sm rounded-xl', xl: 'h-16 w-16 text-lg rounded-2xl' };

function LogoImage({ fileId, className, fallback }) {
  const { data: file } = useFile(fileId);
  const { src } = useFileSource(file);
  if (!src) return fallback;
  return <img src={src} alt="" className={cn('object-contain bg-white p-0.5 border border-line', className)} />;
}

/**
 * Client logo: uploaded logo if available, otherwise initials on the brand colour.
 * Accepts a full client or a picked summary ({ name, primaryColor, logoFileId }).
 */
/** Black or white initials, whichever is more readable on the client's brand colour. */
function readableOn(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#FFFFFF';
  const lin = (i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#FFFFFF' : '#17182B';
}

export function ClientLogo({ client, size = 'md', className }) {
  const color = client?.primaryColor || client?.brand?.primaryColor || '#6257E8';
  const logoFileId = client?.logoFileId || client?.brand?.logoFileId;
  const fallback = (
    <span className={cn('inline-flex shrink-0 select-none items-center justify-center font-bold', LOGO_SIZES[size], className)} style={{ backgroundColor: color, color: readableOn(color) }} aria-hidden>
      {initials(client?.name || '?')}
    </span>
  );
  if (logoFileId) return <LogoImage fileId={logoFileId} className={cn('shrink-0', LOGO_SIZES[size], className)} fallback={fallback} />;
  return fallback;
}

export function ClientChip({ client, link = true, size = 'xs', className }) {
  if (!client) return <span className="text-muted">—</span>;
  const inner = (
    <>
      <ClientLogo client={client} size={size} />
      <span className="truncate">{client.name}</span>
    </>
  );
  const cls = cn('inline-flex min-w-0 max-w-full items-center gap-1.5 text-[13px] font-medium text-ink', className);
  return link ? (
    <Link to={`/clients/${client.id}`} className={cn(cls, 'hover:text-brand focus-ring rounded')} onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export function TaskTypeBadge({ type, className }) {
  const t = TASK_TYPE_BY_ID[type];
  const tool = TOOL_BY_ID[type];
  if (!t) return null;
  const Icon = t.icon;
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-medium', className)} style={{ backgroundColor: tool?.soft || '#F1F2F7', color: tool?.color || '#4E5168' }}>
      <Icon size={12} aria-hidden />
      {t.label}
    </span>
  );
}

export function TaskStatusBadge({ status }) {
  const s = TASK_STATUS_BY_ID[status];
  return s ? (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  ) : null;
}

export function JobStatusBadge({ status }) {
  const s = JOB_STATUS_BY_ID[status];
  return s ? (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  ) : null;
}

export function ClientStatusBadge({ status }) {
  const s = CLIENT_STATUS_BY_ID[status];
  return s ? (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  ) : null;
}

export function fileIconFor(file) {
  if (file?.kind === 'image') return FileImage;
  if (file?.kind === 'text') return FileText;
  if (/sheet|excel|csv/.test(file?.mimeType || '')) return FileSpreadsheet;
  if (/pdf|word|document/.test(file?.mimeType || '')) return FileType2;
  return FileIcon;
}

/**
 * Thumbnail for a file record: real preview for images, text excerpt for text
 * outputs, icon otherwise. Never renders a broken image.
 */
export function FileThumb({ file, className, fit = 'cover' }) {
  const { src, loading } = useFileSource(file?.kind === 'image' ? file : null);
  const Icon = fileIconFor(file);
  if (file?.kind === 'image' && src) {
    return (
      <div className={cn('checkerboard overflow-hidden', className)}>
        <img src={src} alt={file.name} loading="lazy" className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')} />
      </div>
    );
  }
  if (file?.kind === 'text' && file.output?.currentVersion) {
    const v = file.output.currentVersion;
    const text = v.sections ? v.sections.map((s) => s.text).join('\n') : v.content;
    return (
      <div className={cn('overflow-hidden bg-gradient-to-b from-white to-canvas p-3', className)}>
        <p className="line-clamp-6 whitespace-pre-line text-[10.5px] leading-[15px] text-muted">{text}</p>
      </div>
    );
  }
  return (
    <div className={cn('flex items-center justify-center bg-canvas text-subtle', loading && 'animate-pulse', className)}>
      <Icon size={28} strokeWidth={1.5} aria-hidden />
    </div>
  );
}

/** Image thumbnail for a generated version. */
export function VersionThumb({ version, className, fit = 'cover' }) {
  const src = versionImageSrc(version);
  if (!src) return <div className={cn('bg-canvas', className)} />;
  return (
    <div className={cn('checkerboard overflow-hidden', className)}>
      <img src={src} alt={`Version ${version.versionNumber}`} className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')} />
    </div>
  );
}

/** Client / Job / Task path with links. */
export function ContextPath({ client, job, task, className }) {
  const parts = [
    client && { to: `/clients/${client.id}`, label: client.name },
    job && { to: `/jobs/${job.id}`, label: job.title },
    task && { to: `/tasks/${task.id}`, label: task.title },
  ].filter(Boolean);
  return (
    <nav aria-label="Context" className={cn('flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted', className)}>
      {parts.map((p, i) => (
        <span key={p.to} className="inline-flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="shrink-0 text-subtle" aria-hidden />}
          <Link to={p.to} className="truncate hover:text-brand focus-ring rounded" onClick={(e) => e.stopPropagation()}>
            {p.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
