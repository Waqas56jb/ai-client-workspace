import { Archive, HardDrive, Package, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui';

export function websiteHref(url = '') {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export const STORAGE_INFO = {
  bundled: {
    label: 'Bundled sample',
    tone: 'info',
    icon: Package,
    help: 'A sample file shipped with the demo app.',
  },
  browser: {
    label: 'Temporary · this browser',
    tone: 'warning',
    icon: HardDrive,
    help: 'Held in this browser’s IndexedDB only. Not permanent — it may disappear if browser data is cleared.',
  },
  'record-only': {
    label: 'Record only',
    tone: 'neutral',
    icon: Archive,
    help: 'Only the file details exist in the demo — there is no file content to open.',
  },
  supabase: {
    label: 'Cloud storage',
    tone: 'success',
    icon: HardDrive,
    help: 'Stored privately in Supabase Storage.',
  },
  generated: {
    label: 'Generated',
    tone: 'brand',
    icon: Sparkles,
    help: 'A demo output rendered from its version data.',
  },
};

export function StorageBadge({ storage }) {
  const info = STORAGE_INFO[storage] || STORAGE_INFO['record-only'];
  const badge = (
    <Badge tone={info.tone} icon={info.icon}>
      {info.label}
    </Badge>
  );
  return (
    <span className="inline-flex" title={info.help}>
      {badge}
    </span>
  );
}

/** Short type label for a file record, e.g. "PDF", "PNG image". */
export function fileTypeLabel(file) {
  const ext = (file?.name?.split('.').pop() || '').toUpperCase();
  if (file?.kind === 'image') return ext && ext.length <= 4 ? `${ext} image` : 'Image';
  if (/pdf/.test(file?.mimeType || '')) return 'PDF';
  if (/word|document/.test(file?.mimeType || '')) return 'Word document';
  if (/sheet|excel/.test(file?.mimeType || '')) return 'Spreadsheet';
  if (/csv/.test(file?.mimeType || '')) return 'CSV';
  if (file?.kind === 'text') return 'Text';
  return ext || 'File';
}

/** Section card used throughout the client tabs. */
export function Section({ title, description, icon: Icon, action, children, className, bodyClassName }) {
  return (
    <section className={`card ${className || ''}`}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className={bodyClassName ?? 'p-5'}>{children}</div>
    </section>
  );
}
