import { Fragment } from 'react';

/**
 * Shows an AI answer with the little formatting chat answers use — paragraphs,
 * headings, bullet and numbered lists, **bold**, `code` and fenced code blocks —
 * as plain React elements (no HTML from the model is ever injected).
 */

function inline(text, keyBase) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    parts.push(
      t.startsWith('**') ? (
        <strong key={`${keyBase}-${i}`} className="font-semibold">
          {t.slice(2, -2)}
        </strong>
      ) : (
        <code key={`${keyBase}-${i}`} className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.9em]">
          {t.slice(1, -1)}
        </code>
      ),
    );
    last = m.index + t.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function blocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[(i += 1) - 1]);
      i += 1;
      out.push({ type: 'code', text: code.join('\n') });
    } else if (/^\s*([-*•])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) items.push(lines[(i += 1) - 1].replace(/^\s*([-*•])\s+/, ''));
      out.push({ type: 'ul', items });
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[(i += 1) - 1].replace(/^\s*\d+[.)]\s+/, ''));
      out.push({ type: 'ol', items });
    } else if (/^#{1,4}\s+/.test(line)) {
      out.push({ type: 'h', text: line.replace(/^#{1,4}\s+/, '') });
      i += 1;
    } else if (!line.trim()) {
      i += 1;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(```|\s*[-*•]\s+|\s*\d+[.)]\s+|#{1,4}\s+)/.test(lines[i])) para.push(lines[(i += 1) - 1]);
      out.push({ type: 'p', lines: para });
    }
  }
  return out;
}

export function RichText({ text, className }) {
  return (
    <div className={className}>
      {blocks(text).map((b, n) => {
        const k = `b${n}`;
        if (b.type === 'code') {
          return (
            <pre key={k} className="my-3 overflow-x-auto rounded-xl bg-canvas p-4 font-mono text-[14px] leading-6 text-ink">
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type === 'ul' ? 'ul' : 'ol';
          return (
            <List key={k} className={`my-2 space-y-1.5 pl-6 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `${k}-${j}`)}</li>
              ))}
            </List>
          );
        }
        if (b.type === 'h') {
          return (
            <p key={k} className="mb-1 mt-4 font-semibold first:mt-0">
              {inline(b.text, k)}
            </p>
          );
        }
        return (
          <p key={k} className="my-2 first:mt-0 last:mb-0">
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
