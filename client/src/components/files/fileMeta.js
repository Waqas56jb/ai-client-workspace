import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePreferences } from '@/hooks';
import { useUiStore } from '@/store/uiStore';
import { isMockMode } from '@/lib/config';

/** Storage modes of a file record, explained honestly for the demo. */
export const STORAGE_INFO = {
  bundled: {
    label: 'Bundled sample',
    tone: 'info',
    description: 'A small sample file shipped with the demo app. It is read-only and always available.',
  },
  generated: {
    label: 'Generated output',
    tone: 'brand',
    description: 'Rendered in this browser from the saved version data. Images download as PNG at the exact requested size.',
  },
  browser: {
    label: 'Browser storage · temporary',
    tone: 'warning',
    description: 'Uploaded in this browser and held in IndexedDB. Clearing site data removes it. Permanent storage arrives with the backend and Supabase Storage.',
  },
  supabase: {
    label: 'Cloud storage',
    tone: 'success',
    description: 'Stored privately in Supabase Storage. Previews and downloads use short-lived signed links.',
  },
  'record-only': {
    label: 'Record only',
    tone: 'neutral',
    description: 'Only the file’s metadata exists in demo mode — the original file was not uploaded to this browser.',
  },
};

export const KIND_LABELS = { image: 'Image', document: 'Document', text: 'Text', other: 'Other' };

export const FILE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'reference', label: 'Reference' },
];

export function fileExtension(file) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(file?.name || '');
  return m ? m[1].toUpperCase() : null;
}

/** e.g. "PNG · Image" */
export function fileTypeLabel(file) {
  const ext = fileExtension(file);
  const kind = KIND_LABELS[file?.kind] || 'File';
  return ext ? `${ext} · ${kind}` : kind;
}

/** Plain-text files we can preview by fetching their content. */
export function isTextLike(file) {
  if (!file) return false;
  return /^text\//.test(file.mimeType || '') || /\.(md|txt|csv)$/i.test(file.name || '');
}

export function isCsv(file) {
  return /csv/.test(file?.mimeType || '') || /\.csv$/i.test(file?.name || '');
}

/** Human explanation for why a file cannot be downloaded. */
export function downloadBlockedReason(file) {
  if (!file) return null;
  if (!isMockMode) return null;
  if (file.storage === 'record-only') return 'Only the file record exists in demo mode — there is no file content to download.';
  if (file.storage === 'bundled' && !file.url) return 'This sample has no bundled content.';
  return null;
}

/**
 * Reads / writes filter values in the URL query string so pages can be deep linked.
 * `defaults` must be a stable (module-level) object. Values equal to the default
 * are removed from the URL.
 */
export function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const values = useMemo(
    () => Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, params.get(k) ?? d])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, defaults],
  );
  const set = useCallback(
    (patch) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => {
            if (v == null || v === '' || v === defaults[k]) next.delete(k);
            else next.set(k, v);
          });
          return next;
        },
        { replace: true },
      ),
    [setParams, defaults],
  );
  const reset = useCallback((keep = []) => set(Object.fromEntries(Object.keys(defaults).filter((k) => !keep.includes(k)).map((k) => [k, null]))), [set, defaults]);
  const isFiltered = (ignore = []) => Object.keys(defaults).some((k) => !ignore.includes(k) && values[k] !== defaults[k]);
  return { values, set, reset, isFiltered };
}

/** Grid/list preference: per-browser choice, falling back to the workspace default. */
export function useViewPreference(key) {
  const stored = useUiStore((s) => s.views[key]);
  const setView = useUiStore((s) => s.setView);
  const { data: prefs } = usePreferences();
  const view = stored || prefs?.defaultFileView || 'grid';
  return [view, (v) => setView(key, v)];
}
