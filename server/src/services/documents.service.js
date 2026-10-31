import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { logger } from '../utils/logger.js';

/**
 * Reads the text out of uploaded documents so the AI can use them.
 *
 *   Word (.docx)        → mammoth raw text (paragraphs and table cells)
 *   Excel (.xlsx)       → every sheet as rows of tab-separated cells, with its name
 *   PowerPoint (.pptx)  → the text of each slide (and its speaker notes), numbered
 *   CSV / TXT / MD      → the text itself
 *   PDF                 → not read here: the PDF itself is given to the model (input_file),
 *                         which reads text and scanned pages
 *   .doc / .xls (old Office formats) → not readable: the user is told to save as .docx/.xlsx
 *
 * Result: { status: 'ok' | 'partial' | 'failed' | 'unsupported' | 'model', text, parts, chars, truncated, error }
 * `parts` are the places a citation can point to: [{ label: 'Sheet “Sales”' | 'Slide 3' | 'Document', chars }].
 * Never throws: an unreadable file comes back as status 'failed' with a plain-English reason.
 */

export const MAX_DOCUMENT_CHARS = 60_000; // per file, given to the model
const MAX_SHEET_ROWS = 3000;
const MAX_CELL_CHARS = 300;

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const TEXTUAL = ['text/plain', 'text/markdown', 'text/csv'];

const done = (parts, { status = 'ok', note = null } = {}) => {
  let text = parts.map((p) => (p.label === 'Document' ? p.text : `### ${p.label}\n${p.text}`)).join('\n\n').trim();
  const truncated = text.length > MAX_DOCUMENT_CHARS;
  if (truncated) text = `${text.slice(0, MAX_DOCUMENT_CHARS)}\n\n[… the rest of this file was not included: it is longer than ${MAX_DOCUMENT_CHARS.toLocaleString('en-AU')} characters]`;
  if (!text) return { status: 'failed', text: '', parts: [], chars: 0, truncated: false, error: 'No readable text was found in this file (it may be empty, or only contain pictures).' };
  return {
    status: truncated ? 'partial' : status,
    text,
    parts: parts.map((p) => ({ label: p.label, chars: p.text.length })),
    chars: text.length,
    truncated,
    error: truncated ? 'Only the first part of this file could be used because it is very long.' : note,
  };
};

async function readDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return done([{ label: 'Document', text: value.replace(/\n{3,}/g, '\n\n').trim() }]);
}

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellText(v.result); // formula → its value
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(v).slice(0, MAX_CELL_CHARS);
};

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [];
  let cut = false;
  wb.eachSheet((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= MAX_SHEET_ROWS) {
        cut = true;
        return;
      }
      const cells = (row.values || []).slice(1).map(cellText);
      if (cells.some((c) => c.trim())) rows.push(`${n}\t${cells.join('\t')}`);
    });
    parts.push({ label: `Sheet “${sheet.name}” (${sheet.rowCount} rows × ${sheet.columnCount} columns; first number on each line is the row)`, text: rows.join('\n') });
  });
  return done(parts, { note: cut ? `Only the first ${MAX_SHEET_ROWS} rows of each sheet were included.` : null, status: cut ? 'partial' : 'ok' });
}

const xmlText = (xml) =>
  [...xml.matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>|<\/a:p>/g)]
    .map((m) => (m[1] !== undefined ? m[1] : '\n'))
    .join('')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

async function readPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const num = (name) => Number(name.match(/(\d+)\.xml$/)?.[1] || 0);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a) - num(b));
  const parts = [];
  for (const f of slides) {
    const n = num(f);
    const text = xmlText(await zip.file(f).async('string'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? xmlText(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    if (text || notes) parts.push({ label: `Slide ${n}`, text: [text, notes && `Speaker notes: ${notes}`].filter(Boolean).join('\n') });
  }
  return done(parts);
}

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<object>} see the module comment
 */
export async function extractDocument(buffer, mimeType) {
  try {
    if (TEXTUAL.includes(mimeType)) return done([{ label: 'Document', text: buffer.toString('utf8') }]);
    if (mimeType === DOCX) return await readDocx(buffer);
    if (mimeType === XLSX) return await readXlsx(buffer);
    if (mimeType === PPTX) return await readPptx(buffer);
    if (mimeType === 'application/pdf') return { status: 'model', text: '', parts: [], chars: 0, truncated: false, error: null };
    if (mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel') {
      return { status: 'unsupported', text: '', parts: [], chars: 0, truncated: false, error: 'This is an old Office format (.doc / .xls). Please save it as .docx or .xlsx and add it again.' };
    }
    return { status: 'unsupported', text: '', parts: [], chars: 0, truncated: false, error: 'This kind of file cannot be read as a document.' };
  } catch (err) {
    logger.warn({ mimeType, code: err?.code || err?.name }, 'document could not be read');
    return { status: 'failed', text: '', parts: [], chars: 0, truncated: false, error: 'This file could not be opened — it may be damaged or password-protected.' };
  }
}

/** The small summary kept with the stored file (no document text). */
export const extractSummary = (r) => ({ status: r.status, chars: r.chars, parts: r.parts.slice(0, 50), truncated: r.truncated, error: r.error });
