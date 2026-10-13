import crypto from 'node:crypto';

/** Assigns a request id (honours a well-formed incoming X-Request-Id) and echoes it back. */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
