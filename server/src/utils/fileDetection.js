import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { UPLOAD_TYPES } from '../constants/files.js';
import { AppError, badRequest } from './errors.js';

/**
 * Upload content verification.
 *
 * The declared MIME type, the file extension and the actual bytes must all
 * agree. Binary formats are content-sniffed with `file-type`; textual formats
 * (txt/md/csv) must be valid UTF-8 without NUL bytes and must not sniff as any
 * binary format. Anything else (including SVG) is rejected with 415.
 */

const OOXML_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OOXML_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Common non-canonical MIME spellings sent by browsers/OSes → canonical type. */
const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'text/x-markdown': 'text/markdown',
  'application/csv': 'text/csv',
  'text/x-csv': 'text/csv',
  'text/comma-separated-values': 'text/csv',
};

/** Sniffed MIME types accepted for each declared type (when not identical). */
const SNIFF_EQUIVALENTS = {
  [OOXML_DOCX]: [OOXML_DOCX, 'application/zip'],
  [OOXML_XLSX]: [OOXML_XLSX, 'application/zip'],
  'application/msword': ['application/x-cfb', 'application/msword'],
  'application/vnd.ms-excel': ['application/x-cfb', 'application/vnd.ms-excel'],
};

const unsupported = (message = 'This file type is not supported. Use PNG, JPG, WebP, GIF, PDF, Word, Excel, CSV, Markdown or plain text files.') =>
  new AppError('UNSUPPORTED_FILE_TYPE', message, 415);

/** Lower-cased extension of a file name without the dot ('' when none). */
export function extensionOf(fileName = '') {
  const base = String(fileName).split(/[\\/]/).pop() || '';
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : '';
}

/** Canonical declared MIME (lower-case, parameters stripped, aliases resolved). */
export function normaliseMime(mime = '') {
  const m = String(mime).split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[m] || m;
}

/** True when the buffer decodes as UTF-8 and contains no NUL bytes. */
export function isUtf8Text(buffer) {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies an uploaded file and returns its trusted type information.
 * @param {{ buffer: Buffer, declaredMime: string, originalName: string }} input
 * @returns {Promise<{ mimeType: string, category: 'image'|'document'|'text'|'other', extension: string }>}
 * @throws {AppError} 415 UNSUPPORTED_FILE_TYPE, or 400 for an empty file
 */
export async function detectFile({ buffer, declaredMime, originalName }) {
  if (!buffer || buffer.length === 0) throw badRequest('The file is empty.');

  let declared = normaliseMime(declaredMime);
  const ext = extensionOf(originalName);

  if (declared === 'image/svg+xml' || ext === 'svg' || ext === 'svgz') {
    throw unsupported('SVG files are not allowed because they can contain scripts. Upload a PNG or JPG instead.');
  }
  // Windows reports .csv files as Excel; the content check below still applies.
  if (declared === 'application/vnd.ms-excel' && ext === 'csv') declared = 'text/csv';

  const spec = UPLOAD_TYPES[declared];
  if (!spec) throw unsupported();
  if (!spec.exts.includes(ext)) throw unsupported(`The file extension does not match its type (${declared}).`);

  const sniffed = await fileTypeFromBuffer(buffer);

  if (spec.textual) {
    if (sniffed || !isUtf8Text(buffer)) throw unsupported('The file content does not match its declared text type.');
    return { mimeType: declared, category: spec.category, extension: ext };
  }

  const accepted = SNIFF_EQUIVALENTS[declared] || [declared];
  if (!sniffed || !accepted.includes(sniffed.mime)) {
    throw unsupported('The file content does not match its declared type.');
  }
  if (spec.category === 'image') await assertDecodableImage(buffer);
  return { mimeType: declared, category: spec.category, extension: ext };
}

/**
 * Fully decodes an image so truncated or corrupt files are rejected at upload,
 * not later when they are used as a logo or AI reference (after a paid model call).
 */
async function assertDecodableImage(buffer) {
  try {
    const img = sharp(buffer, { failOn: 'truncated', limitInputPixels: 100_000_000 });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error('no dimensions');
    await img.stats();
  } catch {
    throw badRequest('The image file is damaged or incomplete and could not be read. Export it again and re-upload.');
  }
}
