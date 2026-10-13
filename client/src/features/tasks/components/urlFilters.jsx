import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchInput } from '@/components/ui';
import { useDebounce } from '@/hooks';

/**
 * Filter state stored in the URL query string so list views can be deep-linked
 * (e.g. dashboard cards → /tasks?status=open). Values equal to their default
 * are removed from the URL.
 * @param {Record<string, string>} defaults  must be a stable (module-level) object
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

  const clear = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.keys(defaults).forEach((k) => k !== 'sort' && next.delete(k));
          return next;
        },
        { replace: true },
      ),
    [setParams, defaults],
  );

  const activeCount = Object.keys(defaults).filter((k) => k !== 'sort' && values[k] !== defaults[k]).length;
  return { values, set, clear, activeCount };
}

/** Search box with local state that commits a debounced value to the URL. */
export function UrlSearchInput({ value, onCommit, placeholder, className }) {
  const [text, setText] = useState(value);
  const debounced = useDebounce(text, 250);
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (debounced !== committed.current) {
      committed.current = debounced;
      onCommit(debounced);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return <SearchInput value={text} onChange={setText} placeholder={placeholder} className={className} />;
}
