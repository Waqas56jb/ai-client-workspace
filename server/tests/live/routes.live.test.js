import { afterAll, describe, expect, it } from 'vitest';
import { api, closeDb, expectSafeError, NIL_UUID } from './helpers/live.js';
import apiRouter from '../../src/routes/index.js';

/**
 * Route matrix: discovers EVERY route registered on the real Express router and
 * checks the authentication boundary, invalid-id handling and unknown-id handling
 * against the running API.
 */
function discoverRoutes(router) {
  const out = [];
  for (const layer of router.stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: layer.route.path });
    } else if (layer.handle?.stack) {
      const prefix = layer.matchers ? '' : '';
      out.push(...discoverRoutes(layer.handle).map((r) => ({ ...r, path: prefix + r.path })));
    }
  }
  return out;
}

const all = discoverRoutes(apiRouter);
// health is mounted at /health with relative paths '/' and '/ready'
const routes = all.map((r) => (r.path === '/' || r.path === '/ready' ? { ...r, path: `/health${r.path === '/' ? '' : r.path}`, public: true } : r));
const fill = (p, v) => p.replace(/:(\w+)/g, (_m, name) => (name === 'toolType' ? 'writing' : v));

describe('route matrix (live)', () => {
  afterAll(closeDb);

  it('discovers the full route table', () => {
    expect(routes.length).toBeGreaterThanOrEqual(98);
  });

  it.each(routes.filter((r) => !r.public).map((r) => [r.method, r.path]))('%s %s without a token → 401', async (method, p) => {
    const r = await api(method, fill(p, NIL_UUID), { as: null, body: ['GET', 'DELETE'].includes(method) ? undefined : {} });
    expectSafeError(r, 401, expect);
  });

  const withIds = routes.filter((r) => /:(?!toolType)\w+/.test(r.path));
  it.each(withIds.map((r) => [r.method, r.path]))('%s %s with a malformed id → 400 (never 500)', async (method, p) => {
    const r = await api(method, fill(p, 'not-a-uuid'), { body: ['GET', 'DELETE'].includes(method) ? undefined : {} });
    expectSafeError(r, 400, expect);
  });

  it.each(withIds.filter((r) => r.method === 'GET').map((r) => [r.method, r.path]))('%s %s with an unknown id → 404', async (method, p) => {
    const r = await api(method, fill(p, NIL_UUID));
    expectSafeError(r, 404, expect);
  });

  it('unknown routes return a JSON 404 envelope', async () => {
    expectSafeError(await api('GET', '/does-not-exist'), 404, expect);
    expectSafeError(await api('GET', '/does-not-exist', { as: null }), 401, expect);
  });
});
