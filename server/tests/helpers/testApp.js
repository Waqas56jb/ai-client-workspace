// Builds the real Express app wired to an isolated PGlite database, a fake token
// verifier and in-memory Storage/OpenAI fakes. No network, no Supabase project.
import crypto from 'node:crypto';
import { createTestDb, provisionUser } from './testDb.js';
import { setDatabase } from '../../src/config/db.js';
import { setTokenVerifier } from '../../src/middleware/authenticate.js';
import { setSupabaseClients } from '../../src/config/supabase.js';
import { setOpenAI } from '../../src/config/openai.js';

export const USERS = {
  amelia: { id: '11111111-1111-4111-8111-111111111111', email: 'amelia@test.local', name: 'Amelia Hart' },
  jordan: { id: '22222222-2222-4222-8222-222222222222', email: 'jordan@test.local', name: 'Jordan Reyes' },
  sam: { id: '33333333-3333-4333-8333-333333333333', email: 'sam@test.local', name: 'Sam Okafor' },
  inactive: { id: '44444444-4444-4444-8444-444444444444', email: 'gone@test.local', name: 'Former Member' },
  outsider: { id: '55555555-5555-4555-8555-555555555555', email: 'other-project@test.local', name: 'Outsider' },
};

/** Token format used by tests: "test-token-<userId>". */
export const tokenFor = (user) => `test-token-${user.id}`;
export const authHeader = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

/** PGlite adapter implementing the same interface as createPgDatabase(). */
export function pgliteAdapter(db) {
  // PGlite is single-connection: serialise transactions.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const wrap = (tx) => ({ query: (sql, params) => tx.query(sql, params) });
  return {
    raw: db,
    withUser: (userId, fn) =>
      serial(() =>
        db.transaction(async (tx) => {
          await tx.query(
            `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true),
                    set_config('ai_workspace.via_api', 'on', true)`,
            [userId, JSON.stringify({ sub: userId, role: 'authenticated' })],
          );
          await tx.query('set local role authenticated');
          return fn(wrap(tx));
        }),
      ),
    withSystem: (fn) => serial(() => db.transaction((tx) => fn(wrap(tx)))),
    ping: () => db.query('select 1'),
    close: async () => {},
  };
}

/** In-memory replacement for the Supabase service client's Storage API. */
export function fakeStorage() {
  const objects = new Map();
  const api = {
    objects,
    storage: {
      getBucket: async () => ({ data: { id: 'ai-workspace-files', public: false }, error: null }),
      from: () => ({
        upload: async (path, buf, { contentType, upsert } = {}) => {
          if (objects.has(path) && !upsert) return { data: null, error: { message: 'The resource already exists' } };
          objects.set(path, { buf: Buffer.from(buf), contentType });
          return { data: { path }, error: null };
        },
        download: async (path) => {
          const o = objects.get(path);
          if (!o) return { data: null, error: { message: 'not found' } };
          return { data: new Blob([o.buf], { type: o.contentType }), error: null };
        },
        remove: async (paths) => {
          paths.forEach((p) => objects.delete(p));
          return { data: [], error: null };
        },
        createSignedUrl: async (path, ttl, opts) => {
          if (!objects.has(path)) return { data: null, error: { message: 'not found' } };
          const sig = crypto.createHash('sha256').update(path).digest('hex').slice(0, 16);
          return { data: { signedUrl: `https://storage.test/sign/${encodeURIComponent(path)}?token=${sig}&ttl=${ttl}${opts?.download ? `&download=${opts.download}` : ''}` }, error: null };
        },
      }),
    },
  };
  return api;
}

/**
 * Creates a fully wired test app.
 * @param {{ openai?: object }} opts — optional fake OpenAI client
 */
export async function createTestContext({ openai } = {}) {
  const db = await createTestDb();
  for (const key of ['amelia', 'jordan', 'sam']) await provisionUser(db, USERS[key]);
  await provisionUser(db, { ...USERS.inactive, active: false });
  // The outsider exists in Supabase Auth (another project) but has NO workspace profile
  await db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [USERS.outsider.id, USERS.outsider.email]);

  const adapter = pgliteAdapter(db);
  setDatabase(adapter);
  setTokenVerifier(async (token) => {
    const m = token.match(/^test-token-(.+)$/);
    if (!m) return null;
    const u = Object.values(USERS).find((x) => x.id === m[1]);
    return u ? { id: u.id, email: u.email } : null;
  });
  const storage = fakeStorage();
  setSupabaseClients({ service: storage, auth: { auth: { getUser: async () => ({ data: null, error: { message: 'unused' } }) } } });
  if (openai) setOpenAI(openai);

  const { createApp } = await import('../../src/app.js');
  return { app: createApp(), db, adapter, storage };
}
