import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import sharp from 'sharp';

/**
 * Turns an answer or a draft (plain text with the light markdown the chat uses)
 * into a real Word document (.docx): headings, paragraphs, bullet and numbered
 * lists, **bold**, *italic*, `code`, fenced code blocks, markdown tables and
 * horizontal rules. Nothing is invented — only the text given is written.
 *
 * Pictures: a line made only of markers such as [[Image 2]] (the chat's numbering)
 * becomes the real picture(s), side by side when there are several on the line.
 */

const FONT = 'Calibri';

/** A line that only places pictures: "[[Image 1]]" or "[[Image 1]] [[Image 2]]". */
export const IMAGE_LINE = /^\s*(?:\[\[\s*Image\s+\d{1,3}\s*\]\]\s*)+$/i;
export const imageLabelsIn = (line) => [...String(line).matchAll(/\[\[\s*Image\s+(\d{1,3})\s*\]\]/gi)].map((m) => `Image ${Number(m[1])}`);
/** Every picture label a text places, in order, without repeats. */
export const placedImageLabels = (text) => [
  ...new Set(
    String(text || '')
      .split(/\r?\n/)
      .filter((l) => IMAGE_LINE.test(l))
      .flatMap(imageLabelsIn),
  ),
];

// Usable width of an A4/Letter page with default margins is ~6.3in ≈ 600px at 96 dpi.
const PAGE_PX = 600;
const MAX_PICTURE_PX = 420;

function pictures(line, images) {
  const labels = imageLabelsIn(line);
  const found = labels.map((l) => images.get(l)).filter(Boolean);
  if (!found.length) return new Paragraph({ children: [new TextRun({ text: `[${labels.join(', ')} not available]`, italics: true, color: '808080', font: FONT })] });
  const box = Math.min(MAX_PICTURE_PX, Math.floor((PAGE_PX - (found.length - 1) * 16) / found.length));
  const children = [];
  found.forEach((img, n) => {
    const scale = Math.min(1, box / img.width, box / img.height);
    if (n) children.push(new TextRun({ text: '    ', font: FONT }));
    children.push(new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } }));
  });
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children });
}

/**
 * A stored picture made ready for Word: upright, at most 1600px, JPEG (PNG when it
 * has transparency, so a logo on a clear background stays clear).
 * @returns {Promise<{data: Buffer, width: number, height: number, type: 'jpg'|'png'}>}
 */
export async function docxPicture(buffer) {
  const { hasAlpha } = await sharp(buffer).metadata();
  const img = sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  const { data, info } = hasAlpha ? await img.png().toBuffer({ resolveWithObject: true }) : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, type: hasAlpha ? 'png' : 'jpg' };
}

/** **bold**, *italic*, `code` → runs */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', ...base }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, font: FONT, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out.length ? out : [new TextRun({ text: '', font: FONT })];
}

const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function table(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r, i) =>
        new TableRow({
          tableHeader: i === 0,
          children: Array.from({ length: cols }, (_, c) =>
            new TableCell({
              borders: { top: border, bottom: border, left: border, right: border },
              children: [new Paragraph({ children: runs(r[c] || '', i === 0 ? { bold: true } : {}) })],
            }),
          ),
        }),
    ),
  });
}

/**
 * @param {string} markdown
 * @param {Map<string, {data: Buffer, width: number, height: number, type: 'jpg'|'png'}>} [images] by label ("Image 2")
 * @returns {Array<Paragraph|Table>}
 */
export function markdownToDocxBlocks(markdown, images = new Map()) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        blocks.push(new Paragraph({ children: [new TextRun({ text: lines[i], font: 'Consolas', size: 20 })] }));
        i += 1;
      }
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && isTableSep(lines[i + 1] || '')) {
      const rows = [cellsOf(line)];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cellsOf(lines[(i += 1) - 1]));
      blocks.push(table(rows));
      blocks.push(new Paragraph({ children: [] }));
      continue;
    }
    if (IMAGE_LINE.test(line)) {
      blocks.push(pictures(line, images));
      i += 1;
      // A caption right under the picture(s) — "*Example cap design*" — is centred with them.
      const caption = (lines[i] || '').trim().match(/^\*([^*].*?)\*$/);
      if (caption) {
        blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: caption[1], italics: true, size: 20, color: '595959', font: FONT })] }));
        i += 1;
      }
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][h[1].length - 1];
      blocks.push(new Paragraph({ heading: level, children: runs(h[2].replace(/\*\*/g, '')) }));
    } else if (/^\s*([-*•])\s+/.test(line)) {
      blocks.push(new Paragraph({ bullet: { level: Math.min(2, Math.floor((line.match(/^\s*/)[0].length || 0) / 2)) }, children: runs(line.replace(/^\s*[-*•]\s+/, '')) }));
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      blocks.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: runs(line.replace(/^\s*\d+[.)]\s+/, '')) }));
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } }, children: [] }));
    } else if (!line.trim()) {
      blocks.push(new Paragraph({ children: [] }));
    } else {
      blocks.push(new Paragraph({ children: runs(line) }));
    }
    i += 1;
  }
  return blocks;
}

/**
 * @param {{ title?: string, text: string, images?: Map<string, object> }} p
 * @returns {Promise<Buffer>} the .docx bytes
 */
export async function buildDocx({ title, text, images }) {
  const doc = new Document({
    creator: 'StudioFlow AI',
    title: title || 'Document',
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    numbering: {
      config: [{ reference: 'numbers', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
    },
    sections: [{ children: markdownToDocxBlocks(text, images) }],
  });
  return Packer.toBuffer(doc);
}

/** A safe file name ("Superannuation choice form.docx"). */
export function docxFileName(title) {
  const base = String(title || 'Document')
    .replace(/[\\/:*?"<>|#\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'Document'}.docx`;
}
