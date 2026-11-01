/**
 * The light markdown AI answers and drafts use — headings, **bold**, *italic*,
 * `code`, bullet and numbered lists, tables and fenced code blocks — parsed once
 * and turned into: React blocks (RichText), clean HTML for the clipboard (so bold
 * survives a paste into Gmail or Outlook) and plain text with no symbols.
 */

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,6})\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** @returns {Array<{type:'h',level:number,text:string}|{type:'p',lines:string[]}|{type:'ul'|'ol',items:string[]}|{type:'code',text:string}|{type:'table',rows:string[][]}|{type:'hr'}>} */
export function parseBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isStart = (l, next) => /^```/.test(l) || BULLET.test(l) || NUMBER.test(l) || HEADING.test(l) || RULE.test(l) || (TABLE_ROW.test(l) && TABLE_RULE.test(next || ''));
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[(i += 1) - 1]);
      i += 1;
      out.push({ type: 'code', text: code.join('\n') });
    } else if (RULE.test(line)) {
      out.push({ type: 'hr' });
      i += 1;
    } else if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] || '')) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[(i += 1) - 1]));
      out.push({ type: 'table', rows });
    } else if (BULLET.test(line)) {
      const items = [];
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[(i += 1) - 1].replace(BULLET, ''));
      out.push({ type: 'ul', items });
    } else if (NUMBER.test(line)) {
      const items = [];
      while (i < lines.length && NUMBER.test(lines[i])) items.push(lines[(i += 1) - 1].replace(NUMBER, ''));
      out.push({ type: 'ol', items });
    } else if (HEADING.test(line)) {
      out.push({ type: 'h', level: line.match(HEADING)[1].length, text: line.replace(HEADING, '').replace(/\s+#+\s*$/, '') });
      i += 1;
    } else if (!line.trim()) {
      i += 1;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !isStart(lines[i], lines[i + 1])) para.push(lines[(i += 1) - 1]);
      if (!para.length) para.push(lines[(i += 1) - 1]);
      out.push({ type: 'p', lines: para });
    }
  }
  return out;
}

/** Splits a line into text / bold / italic / code pieces. */
export function parseInline(text) {
  const parts = [];
  const re = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|(?<![*\w])\*(?!\s)[^*\n]+?(?<!\s)\*(?![*\w])|(?<![_\w])_(?!\s)[^_\n]+?(?<!\s)_(?![_\w]))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) parts.push({ type: 'bold', text: t.slice(2, -2) });
    else if (t.startsWith('`')) parts.push({ type: 'code', text: t.slice(1, -1) });
    else parts.push({ type: 'italic', text: t.slice(1, -1) });
    last = m.index + t.length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inlineHtml = (text) =>
  parseInline(text)
    .map((p) => (p.type === 'bold' ? `<strong>${esc(p.text)}</strong>` : p.type === 'italic' ? `<em>${esc(p.text)}</em>` : p.type === 'code' ? `<code>${esc(p.text)}</code>` : esc(p.text)))
    .join('');

const inlinePlain = (text) =>
  parseInline(text)
    .map((p) => p.text)
    .join('');

const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#1f2937;';

/** Clean, email-safe HTML (inline styles, everything escaped) for pasting into Gmail, Outlook or Word. */
export function markdownToHtml(text) {
  const html = parseBlocks(text)
    .map((b) => {
      if (b.type === 'h') return `<p style="margin:16px 0 4px;"><strong>${inlineHtml(b.text)}</strong></p>`;
      if (b.type === 'p') return `<p style="margin:0 0 12px;">${b.lines.map(inlineHtml).join('<br>')}</p>`;
      if (b.type === 'ul' || b.type === 'ol') return `<${b.type} style="margin:0 0 12px;padding-left:24px;">${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${b.type}>`;
      if (b.type === 'code') return `<pre style="font-family:Consolas,monospace;font-size:10pt;">${esc(b.text)}</pre>`;
      if (b.type === 'hr') return '<hr>';
      return `<table style="border-collapse:collapse;margin:0 0 12px;">${b.rows
        .map((r, i) => `<tr>${r.map((c) => `<${i ? 'td' : 'th'} style="border:1px solid #d1d5db;padding:4px 8px;text-align:left;">${inlineHtml(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`)
        .join('')}</table>`;
    })
    .join('');
  return `<div style="${FONT}">${html}</div>`;
}

/** Plain text with the markdown symbols removed — what a .txt download or a plain paste should contain. */
export function markdownToPlain(text) {
  return parseBlocks(text)
    .map((b) => {
      if (b.type === 'h') return inlinePlain(b.text);
      if (b.type === 'p') return b.lines.map(inlinePlain).join('\n');
      if (b.type === 'ul') return b.items.map((it) => `• ${inlinePlain(it)}`).join('\n');
      if (b.type === 'ol') return b.items.map((it, n) => `${n + 1}. ${inlinePlain(it)}`).join('\n');
      if (b.type === 'code') return b.text;
      if (b.type === 'hr') return '';
      return b.rows.map((r) => r.map(inlinePlain).join('\t')).join('\n');
    })
    .join('\n\n')
    .trim();
}
