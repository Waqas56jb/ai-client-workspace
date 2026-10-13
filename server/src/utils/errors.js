/** Application error with a stable machine-readable code and HTTP status. */
export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError('VALIDATION_ERROR', message, 400, details);
export const unauthorized = (message = 'Authentication is required.') => new AppError('UNAUTHORIZED', message, 401);
export const forbidden = (message = 'You do not have access to this workspace.') => new AppError('FORBIDDEN', message, 403);
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`, 404);
export const conflict = (message, details) => new AppError('CONFLICT', message, 409, details);
export const tooMany = (message = 'Too many requests. Please slow down.') => new AppError('RATE_LIMITED', message, 429);

/**
 * Translates PostgreSQL errors (raised by constraints, RLS and our guard
 * triggers) into safe API errors. Never leaks SQL or internal details.
 */
export function fromDatabaseError(err) {
  if (err instanceof AppError) return err;
  const msg = String(err?.message || '');
  const clean = msg.startsWith('ai_workspace: ') ? msg.slice('ai_workspace: '.length) : null;
  switch (err?.code) {
    case '23505':
      return conflict(clean ? capitalise(clean) : 'A record with these details already exists.');
    case '23503':
      return badRequest('A referenced record does not exist or belongs to a different client.');
    case '23514':
    case '22P02':
    case '22001':
      return badRequest('The supplied data does not meet the required format.');
    case '22023':
      return badRequest(clean ? capitalise(clean) : 'Invalid parameter.');
    case 'P0002':
      return notFound(clean ? capitalise(clean.replace(/ not found$/, '')) : 'Resource');
    case '42501':
      return clean ? new AppError('FORBIDDEN_OPERATION', capitalise(clean), 409) : forbidden();
    default:
      return null;
  }
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/\.?$/, '.');
}
