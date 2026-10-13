import { badRequest } from '../utils/errors.js';

/**
 * Validates request input with Zod and exposes the PARSED values:
 *   req.body (replaced), req.params (replaced), req.validatedQuery.
 * Object schemas strip unknown keys, which prevents mass assignment.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      if (params) req.params = parse(params, req.params, 'path');
      if (query) req.validatedQuery = parse(query, req.query, 'query');
      if (body) req.body = parse(body, req.body ?? {}, 'body');
      next();
    } catch (err) {
      next(err);
    }
  };
}

function parse(schema, value, where) {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw badRequest(
      'The supplied information is invalid.',
      r.error.issues.map((i) => ({ location: where, path: i.path.join('.'), message: i.message })),
    );
  }
  return lowercaseIds(r.data);
}

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/**
 * Postgres returns ids in lowercase; normalising validated input ids avoids
 * false "not found" results when ids are compared as strings.
 */
function lowercaseIds(value) {
  if (typeof value === 'string') return UUID.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(lowercaseIds);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const k of Object.keys(value)) value[k] = lowercaseIds(value[k]);
  }
  return value;
}
