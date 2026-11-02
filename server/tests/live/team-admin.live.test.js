import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonSupabase, closeDb, del, get, post, put, RUN_ID, signIn, sleep } from './helpers/live.js';
import { createScriptClient } from '../../scripts/lib/pg.js';

/**
 * Administrators manage member accounts (Team page) — real Supabase Auth.
 * QA member A is made an administrator for the run only; the member it adds is a
 * QA address and ends removed (blocked) — no real user is touched.
 */
describe('team administration (live)', () => {
  const email = `qa-sf-${RUN_ID}-sub@example.com`.toLowerCase();
  let pg;
  let memberId;
  const setAdmin = (on) => pg.query('update public.ai_workspace_users set is_admin = $1 where id = $2', [on, process.env.QA_MEMBER_A_ID]);
  const tryLogin = async (password) => {
    const { data, error } = await anonSupabase().auth.signInWithPassword({ email, password });
    return error ? null : data.session.access_token;
  };

  beforeAll(async () => {
    pg = createScriptClient();
    await pg.connect();
    await setAdmin(true);
    await sleep(31_000); // the API caches a signed-in profile for 30 s
    await signIn('QA_MEMBER_A');
  }, 60_000);

  afterAll(async () => {
    await setAdmin(false);
    await pg.end();
    await closeDb();
  });

  it('a member who is not an administrator cannot add anyone', async () => {
    const r = await post('/users', { name: 'Nope', email: `qa-sf-${RUN_ID}-nope@example.com`, password: 'Never-used-2026' }, { as: 'QA_MEMBER_B' });
    expect(r.status).toBe(403);
    expect((await get('/auth/me', { as: 'QA_MEMBER_B' })).data.user.isAdmin).toBe(false);
  });

  it('the administrator adds a member who can then sign in and use the workspace', async () => {
    expect((await get('/auth/me')).data.user.isAdmin).toBe(true);
    const r = await post('/users', { name: 'QA Sub User', email, role: 'Copywriter', password: 'First-pass-2026' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.json)).not.toContain('First-pass-2026');
    memberId = r.data.id;
    const token = await tryLogin('First-pass-2026');
    expect(token).toBeTruthy();
    const me = await get('/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.data.user).toMatchObject({ email, isAdmin: false });
  }, 30_000);

  it('the administrator changes the password: the old one stops working, the new one works', async () => {
    expect((await put(`/users/${memberId}/password`, { password: 'Second-pass-2026' })).status).toBe(200);
    expect(await tryLogin('First-pass-2026')).toBeNull();
    expect(await tryLogin('Second-pass-2026')).toBeTruthy();
  }, 30_000);

  it('the administrator deletes the account: signed-in sessions lose access and sign-in is blocked', async () => {
    const token = await tryLogin('Second-pass-2026');
    expect((await del(`/users/${memberId}`)).status).toBe(200);
    expect([401, 403]).toContain((await get('/auth/me', { token })).status); // Supabase rejects a blocked user's token outright
    expect(await tryLogin('Second-pass-2026')).toBeNull();
    expect((await get('/users')).data.map((u) => u.id)).not.toContain(memberId);
    expect((await del(`/users/${process.env.QA_MEMBER_A_ID}`)).status).toBe(400); // never yourself
  }, 30_000);
});
