import multer from 'multer';
import { env } from '../config/env.js';

/**
 * Multipart parsing into memory with a hard size cap (MAX_UPLOAD_SIZE_MB).
 * Files are content-sniffed with `file-type` in the file service before
 * anything is stored — the declared MIME type and extension are never trusted.
 */
export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8', // keep non-ASCII file names (e.g. “Café.pdf”) intact
  limits: { fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 4096 },
}).single('file');
