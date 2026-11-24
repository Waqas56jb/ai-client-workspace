import { Fragment } from 'react';
import { parseBlocks, parseInline } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/**
 * Shows an AI answer or draft with the formatting it was written with — headings,
 * **bold**, *italic*, `code`, lists, tables and code blocks — as plain React
 * elements (no HTML from the model is ever injected).
 */

function inline(text, keyBase) {
  return parseInline(text).map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.type === 'bold') return <strong key={key} className="font-semibold text-ink">{p.text}</strong>;
    if (p.type === 'italic') return <em key={key}>{p.text}</em>;
    if (p.type === 'code') return <code key={key} className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.9em]">{p.text}</code>;
    return <Fragment key={key}>{p.text}</Fragment>;
  });
}

const HEADING_SIZE = { 1: 'text-[1.3em]', 2: 'text-[1.17em]', 3: 'text-[1.06em]' };

/** Chat pictures a document places ([[Image 2]]), side by side, as in the Word file. */
function Pictures({ labels, images }) {
  return (
    <div className="my-4 flex flex-wrap items-start justify-center gap-3">
      {labels.map((label) => {
        const e = images?.list?.find((x) => x.label === label);
        return e?.src ? (
          <figure key={label} className="m-0 max-w-[min(100%,340px)]">
            <img src={e.src} alt={e.name || label} className="max-h-[300px] w-auto max-w-full rounded-xl border border-line object-contain" loading="lazy" />
            <figcaption className="mt-1 text-center text-[13px] text-muted">{label}</figcaption>
          </figure>
        ) : (
          <span key={label} className="rounded-lg bg-canvas px-3 py-2 text-[14px] text-muted">
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** A letterhead as it will print: name large on the left, the logo small on the right, a rule underneath. */
function Letterhead({ labels, lines, images }) {
  const logo = labels.map((l) => images?.list?.find((x) => x.label === l)).find((e) => e?.src);
  const [name, ...rest] = lines;
  return (
    <div className="mb-5 flex items-center justify-between gap-4 border-b-2 border-[#1f3b73] pb-3">
      <div className="min-w-0">
        {name && <p className="font-serif text-[1.35em] font-bold uppercase leading-tight tracking-wide text-[#1f3b73]">{name}</p>}
        {rest.map((l, j) => (
          <p key={j} className="text-[0.85em] leading-snug text-muted">
            {l}
          </p>
        ))}
      </div>
      {logo ? <img src={logo.src} alt={logo.name || 'Logo'} className="h-20 w-20 shrink-0 rounded object-contain" loading="lazy" /> : labels.length ? <span className="shrink-0 rounded-lg bg-canvas px-3 py-2 text-[13px] text-muted">{labels[0]}</span> : null}
    </div>
  );
}

export function RichText({ text, className, images }) {
  return (
    <div className={className}>
      {parseBlocks(text).map((b, n) => {
        const k = `b${n}`;
        if (b.type === 'letterhead') return <Letterhead key={k} labels={b.labels} lines={b.lines} images={images} />;
        if (b.type === 'images') return <Pictures key={k} labels={b.labels} images={images} />;
        if (b.type === 'code') {
          return (
            <pre key={k} className="my-3 overflow-x-auto rounded-xl bg-canvas p-4 font-mono text-[14px] leading-6 text-ink">
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.type === 'hr') return <hr key={k} className="my-4 border-line" />;
        if (b.type === 'table') {
          return (
            <div key={k} className="my-3 overflow-x-auto rounded-xl border border-line scrollbar-thin">
              <table className="w-full border-collapse text-[0.92em]">
                <thead className="bg-canvas">
                  <tr>
                    {b.rows[0].map((c, j) => (
                      <th key={j} className="border-b border-line px-3 py-2 text-left font-semibold">
                        {inline(c, `${k}-h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.slice(1).map((r, ri) => (
                    <tr key={ri} className="border-b border-line last:border-0">
                      {r.map((c, j) => (
                        <td key={j} className="px-3 py-2 align-top">
                          {inline(c, `${k}-${ri}-${j}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type;
          return (
            <List key={k} className={cn('my-3 space-y-1.5 pl-6 marker:text-muted', b.type === 'ul' ? 'list-disc' : 'list-decimal')}>
              {b.items.map((it, j) => (
                <li key={j} className="pl-1">
                  {inline(it, `${k}-${j}`)}
                </li>
              ))}
            </List>
          );
        }
        if (b.type === 'h') {
          return (
            <p key={k} role="heading" aria-level={Math.min(b.level + 1, 6)} className={cn('mb-1.5 mt-5 font-semibold leading-snug text-ink first:mt-0', HEADING_SIZE[b.level])}>
              {inline(b.text, k)}
            </p>
          );
        }
        return (
          <p key={k} className="my-3 first:mt-0 last:mb-0">
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, `${k}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
