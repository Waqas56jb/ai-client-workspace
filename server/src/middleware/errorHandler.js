import multer from 'multer';
import { AppError, fromDatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist.`, requestId: req.id } });
}

/** Central error handler. Never exposes stack traces, SQL or provider internals. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let appErr = err instanceof AppError ? err : fromDatabaseError(err);
  if (!appErr && err instanceof multer.MulterError) {
    appErr =
      err.code === 'LIMIT_FILE_SIZE'
        ? new AppError('FILE_TOO_LARGE', `Files must be ${env.MAX_UPLOAD_SIZE_MB} MB or smaller.`, 413)
        : new AppError('UPLOAD_ERROR', 'The upload could not be processed.', 400);
  }
  if (!appErr && err?.type === 'entity.too.large') appErr = new AppError('PAYLOAD_TOO_LARGE', 'The request body is too large.', 413);
  if (!appErr && err?.type === 'entity.parse.failed') appErr = new AppError('VALIDATION_ERROR', 'The request body is not valid JSON.', 400);

  if (!appErr) {
    logger.error({ err: { message: err?.message, code: err?.code, stack: err?.stack }, reqId: req.id, path: req.path }, 'unhandled error');
    appErr = new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', 500);
  } else if (appErr.status >= 500) {
    logger.error({ code: appErr.code, reqId: req.id }, appErr.message);
  }

  const body = { success: false, error: { code: appErr.code, message: appErr.message, requestId: req.id } };
  if (appErr.details) body.error.details = appErr.details;
  res.status(appErr.status).json(body);
}
