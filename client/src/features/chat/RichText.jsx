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

export function RichText({ text, className }) {
  return (
    <div className={className}>
      {parseBlocks(text).map((b, n) => {
        const k = `b${n}`;
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
