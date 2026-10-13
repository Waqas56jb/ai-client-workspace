import { created, handler, ok } from '../utils/response.js';
import * as files from '../services/files.service.js';

/** Sends a text download directly (text/plain attachment). */
export function sendText(res, { text, fileName }) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', files.contentDisposition(fileName, 'attachment'));
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(text);
}

/** POST /files/upload (multipart: file + clientId, jobId?, taskId?, category, description?) */
export const upload = handler(async (req, res) => created(res, await files.uploadFile(req.user, req.file, req.body), { message: 'File uploaded.' }));

/** GET /files */
export const list = handler(async (req, res) => {
  const { data, meta } = await files.listFiles(req.user, req.validatedQuery);
  return ok(res, data, { meta });
});

/** GET /files/:id */
export const get = handler(async (req, res) => ok(res, await files.getFile(req.user, req.params.id)));

/** GET /files/:id/download[?versionId=] */
export const download = handler(async (req, res) => {
  const result = await files.downloadFile(req.user, req.params.id, req.validatedQuery);
  if (result.kind === 'text') return sendText(res, result);
  return ok(res, { url: result.url, expiresAt: result.expiresAt, fileName: result.fileName });
});

/** GET /files/:id/preview */
export const preview = handler(async (req, res) => ok(res, await files.previewFile(req.user, req.params.id)));

/** PATCH /files/:id */
export const update = handler(async (req, res) => ok(res, await files.updateFile(req.user, req.params.id, req.body), { message: 'File updated.' }));

/** POST /files/:id/archive */
export const archive = handler(async (req, res) => ok(res, await files.archiveFile(req.user, req.params.id), { message: 'File archived.' }));

/** GET /files/:id/versions */
export const versions = handler(async (req, res) => ok(res, await files.listFileVersions(req.user, req.params.id)));

/** POST /files/:id/versions/:versionId/approve */
export const approveVersion = handler(async (req, res) =>
  ok(res, await files.approveFileVersion(req.user, req.params.id, req.params.versionId, req.body.notes), { message: 'File version approved.' }),
);
