import { ACCEPTED_UPLOADS } from './constants';
import { config } from './config';

/**
 * Plain-English checks before a chat upload. The server checks everything again
 * (type sniffing, size); this only saves the user a failed upload.
 */

// Photos the image AI can work from (GIF is fine as a file, but not as a photo to edit).
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',');
export const FILE_ACCEPT = Object.keys(ACCEPTED_UPLOADS).join(',');
const MB = 1024 * 1024;

const extOf = (name = '') => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const EXT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** iPhone photos: HEIC/HEIF by type, or by extension when the browser reports no type. */
export function isHeic(file) {
  const type = (file?.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence') return true;
  return !type && ['heic', 'heif'].includes(extOf(file?.name));
}

/** The file's type; falls back to the extension only when the browser gave none. */
export function fileType(file) {
  return file?.type || EXT_TYPES[extOf(file?.name)] || '';
}

/**
 * @param {File} file
 * @param {'writing'|'image'} mode
 * @returns {string|null} a friendly problem, or null when the file can be uploaded
 */
export function checkChatFile(file, mode) {
  if (!file) return 'No file was selected.';
  if (isHeic(file)) return 'This is an iPhone HEIC photo. Please save it as JPG and add it again.';
  const type = fileType(file);
  const maxMb = Math.round(config.maxUploadBytes / MB);
  if (mode === 'image' && !PHOTO_TYPES.includes(type)) {
    return `“${file.name}” can’t be used as a photo. Please use a JPG, PNG or WebP picture.`;
  }
  if (!ACCEPTED_UPLOADS[type]) {
    return `“${file.name}” is not a file type we accept. Use a photo (JPG, PNG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV or text file.`;
  }
  if (file.size > config.maxUploadBytes) return `File is bigger than ${maxMb} MB. Please choose a smaller file.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

/** Files from a dropped / picked folder: only the kinds the chat accepts (hidden system files are skipped). */
export function usableFolderFiles(list) {
  const files = Array.from(list || []).filter((f) => !/^\./.test(f.name) && f.name !== 'Thumbs.db' && f.name !== 'desktop.ini');
  const ok = files.filter((f) => !checkChatFile(f, 'any'));
  return { ok, skipped: files.length - ok.length };
}
