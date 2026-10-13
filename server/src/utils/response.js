/** Consistent success envelope: { success, data, message?, meta? } */
export function ok(res, data, { status = 200, message, meta } = {}) {
  const body = { success: true, data: data === undefined ? null : data };
  if (message) body.message = message;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export const created = (res, data, opts = {}) => ok(res, data, { ...opts, status: 201 });

/** Wraps an async controller so rejections reach the error handler. */
export const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
