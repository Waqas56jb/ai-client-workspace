import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useUiStore } from '@/store/uiStore';
import { resolveFileSource } from '@/lib/media';

/**
 * Sets the top-bar breadcrumbs for the current page.
 * @param {Array<{ label: string, to?: string }>} items
 */
export function useBreadcrumbs(items) {
  const setBreadcrumbs = useUiStore((s) => s.setBreadcrumbs);
  const key = JSON.stringify(items);
  useEffect(() => {
    setBreadcrumbs(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setBreadcrumbs]);
}

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · StudioFlow AI` : 'StudioFlow AI';
  }, [title]);
}

export function useDebounce(value, delay = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/**
 * Global keyboard shortcut. `combo` like 'mod+k' (mod = Ctrl on Windows/Linux, ⌘ on macOS).
 */
export function useHotkey(combo, handler, { enabled = true } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const parts = combo.toLowerCase().split('+');
    const key = parts.pop();
    const needMod = parts.includes('mod');
    const needShift = parts.includes('shift');
    const onKey = (e) => {
      if (e.key?.toLowerCase() !== key) return;
      if (needMod && !(e.ctrlKey || e.metaKey)) return;
      if (needShift !== e.shiftKey) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, enabled]);
}

/**
 * Warns before leaving a page with unsaved changes: in-app navigation via a
 * blocker (render <UnsavedChangesDialog blocker={…} />) and tab close via beforeunload.
 */
export function useUnsavedChanges(isDirty) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);
  return blocker;
}

/**
 * Resolves a previewable src for a file record (bundled, generated, or a
 * browser-held blob). Object URLs are revoked on change/unmount.
 */
export function useFileSource(file) {
  const [state, setState] = useState({ src: null, loading: !!file, unavailable: null });
  const key = file ? `${file.id}:${file.updatedAt}:${file.output?.currentVersionId || ''}` : '';
  useEffect(() => {
    if (!file) {
      setState({ src: null, loading: false, unavailable: null });
      return undefined;
    }
    let revoke;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    resolveFileSource(file).then((res) => {
      if (cancelled) {
        res.revoke?.();
        return;
      }
      revoke = res.revoke;
      setState({ src: res.src, loading: false, unavailable: res.unavailable || null });
    });
    return () => {
      cancelled = true;
      revoke?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Object URL for a local File/Blob, revoked automatically. */
export function useObjectUrl(blob) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
