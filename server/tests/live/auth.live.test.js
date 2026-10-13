import { afterAll, describe, expect, it } from 'vitest';
import { account, anonSupabase, api, closeDb, dbRead, expectSafeError, get, signIn, sleep } from './helpers/live.js';

/** Real Supabase Auth + the API's authenticate middleware. */
describe('auth (live)', () => {
  afterAll(closeDb);

  it('health endpoints are public and ready reports all dependencies', async () => {
    const h = await get('/health', { as: null });
    expect(h.status).toBe(200);
    const r = await get('/health/ready', { as: null });
    expect(r.status).toBe(200);
    expect(r.data.checks).toEqual({ database: true, schema: true, storage: true, ai: true });
  });

  it.each(['QA_MEMBER_A', 'QA_MEMBER_B', 'QA_MEMBER_C'])('%s signs in and /auth/me matches token, API and database', async (key) => {
    const s = await signIn(key);
    const me = await get('/auth/me', { as: key });
    expect(me.status).toBe(200);
    expect(me.data.user.id).toBe(s.userId);
    expect(me.data.user.email).toBe(account(key).email);
    const [row] = await dbRead('select id, email, is_active from public.ai_workspace_users where id = $1', [s.userId]);
    expect(row).toMatchObject({ id: s.userId, email: account(key).email, is_active: true });
    // no auth internals leak
    expect(JSON.stringify(me.json)).not.toMatch(/refresh|password|app_metadata|aud/);
  });

  it('rejects wrong password, unknown email, empty and malformed credentials at Supabase Auth', async () => {
    const sb = anonSupabase();
    const { email } = account('QA_MEMBER_A');
    const cases = [
      { email, password: 'definitely-wrong-password' },
      { email: `nobody-${Date.now()}@example.com`, password: 'whatever123456' },
      { email: '', password: '' },
      { email: 'not-an-email', password: 'x' },
      { email: `  ${email}  `, password: 'definitely-wrong-password' },
    ];
    for (const c of cases) {
      const { data, error } = await sb.auth.signInWithPassword(c);
      expect(error, JSON.stringify(c.email)).toBeTruthy();
      expect(data.session).toBeNull();
    }
  });

  it.each([
    ['no header', {}],
    ['empty bearer', { Authorization: 'Bearer ' }],
    ['basic scheme', { Authorization: 'Basic dXNlcjpwYXNz' }],
    ['short token', { Authorization: 'Bearer abc' }],
    ['garbage token', { Authorization: `Bearer ${'x'.repeat(64)}` }],
    ['forged jwt', { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2lnbmF0dXJl' }],
    ['header injection', { Authorization: 'Bearer abc.def.ghi\r\nX-Evil: 1' }],
  ])('rejects %s with 401', async (_n, headers) => {
    let r;
    try {
      r = await api('GET', '/clients', { as: null, headers });
    } catch {
      return; // fetch itself refuses CRLF headers — also a rejection
    }
    expectSafeError(r, 401, expect);
  });

  it('expired token is rejected with 401', async () => {
    // A token whose exp is in the past (signed with an unknown key → also invalid signature).
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: account('QA_MEMBER_A').id, exp: 1_000_000_000, role: 'authenticated' })).toString('base64url');
    const r = await api('GET', '/clients', { token: `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAA` });
    expectSafeError(r, 401, expect);
  });

  it('a Supabase user who is not a workspace member gets 403 on every data route', async () => {
    for (const p of ['/auth/me', '/clients', '/users', '/dashboard/summary', '/search?q=a', '/files']) {
      const r = await get(p, { as: 'QA_OUTSIDER' });
      expectSafeError(r, 403, expect);
    }
  });

  it('an inactive member gets 403', async () => {
    const r = await get('/clients', { as: 'QA_INACTIVE' });
    expectSafeError(r, 403, expect);
  });

  it('refresh token issues a new working access token', async () => {
    const s = await signIn('QA_MEMBER_B', { fresh: true });
    const { data, error } = await s.client.auth.refreshSession({ refresh_token: s.refreshToken });
    expect(error).toBeNull();
    expect(data.session.access_token).toBeTruthy();
    const r = await api('GET', '/auth/me', { token: data.session.access_token });
    expect(r.status).toBe(200);
    await s.client.auth.signOut({ scope: 'local' });
  });

  it('multiple concurrent sessions for one user both work', async () => {
    const [s1, s2] = await Promise.all([signIn('QA_MEMBER_C', { fresh: true }), signIn('QA_MEMBER_C', { fresh: true })]);
    const [r1, r2] = await Promise.all([api('GET', '/auth/me', { token: s1.token }), api('GET', '/auth/me', { token: s2.token })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    await s1.client.auth.signOut({ scope: 'local' });
    await s2.client.auth.signOut({ scope: 'local' });
  });

  it('a signed-out (revoked) session is rejected once the 30 s verification cache expires', async () => {
    const s = await signIn('QA_MEMBER_C', { fresh: true });
    expect((await api('GET', '/auth/me', { token: s.token })).status).toBe(200);
    const { error } = await s.client.auth.signOut({ scope: 'global' });
    expect(error).toBeNull();
    await sleep(31_000);
    const r = await api('GET', '/auth/me', { token: s.token });
    expectSafeError(r, 401, expect);
  }, 60_000);

  it('public sign-up cannot grant workspace access (membership is enforced server-side)', async () => {
    // We do not create a real sign-up (it would add an auth user to the shared project);
    // the outsider account represents any self-registered user.
    const r = await get('/clients', { as: 'QA_OUTSIDER' });
    expect(r.status).toBe(403);
    const rows = await dbRead('select count(*)::int n from public.ai_workspace_users where id = $1', [account('QA_OUTSIDER').id]);
    expect(rows[0].n).toBe(0);
  });
});
