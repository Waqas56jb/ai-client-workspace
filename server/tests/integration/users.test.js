import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';
import { clearAuthCache } from '../../src/middleware/authenticate.js';

let app;
let db;
let storage;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));

beforeAll(async () => {
  ({ app, db, storage } = await createTestContext());
});

describe('users', () => {
  it('lists the team with the User DTO and no auth data', async () => {
    const res = await api('get', '/users');
    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.email)).toEqual(expect.arrayContaining([USERS.amelia.email, USERS.jordan.email, USERS.inactive.email]));
    expect(res.body.data.map((u) => u.id)).not.toContain(USERS.outsider.id);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['avatarColor', 'createdAt', 'email', 'id', 'isAdmin', 'lastActiveAt', 'name', 'role', 'status']);
    const active = await api('get', '/users').query({ status: 'active' });
    expect(active.body.data.every((u) => u.status === 'active')).toBe(true);
    expect(active.body.data).toHaveLength(3);
  });

  it('returns the current user and other members', async () => {
    expect((await api('get', '/users/me', USERS.sam)).body.data).toMatchObject({ id: USERS.sam.id, status: 'active' });
    expect((await api('get', `/users/${USERS.inactive.id}`)).body.data.status).toBe('inactive');
    expect((await api('get', '/users/99999999-9999-4999-8999-999999999999')).status).toBe(404);
  });

  it('lets members update their own display fields only', async () => {
    const res = await api('patch', '/users/me').send({ name: 'Amelia H.', role: 'Director', avatarColor: '#0E7490', email: 'hijack@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Amelia H.', role: 'Director', avatarColor: '#0E7490', email: USERS.amelia.email });
    const byId = await api('patch', `/users/${USERS.amelia.id}`).send({ role: 'Creative Director' });
    expect(byId.body.data.role).toBe('Creative Director');
  });

  it('forbids updating the profile of another member', async () => {
    const res = await api('patch', `/users/${USERS.jordan.id}`).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await api('get', `/users/${USERS.jordan.id}`)).body.data.name).toBe(USERS.jordan.name);
  });

  it('validates profile input', async () => {
    const res = await api('patch', '/users/me').send({ avatarColor: 'blue' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs profile changes', async () => {
    const res = await api('get', '/activity').query({ type: 'team_updated' });
    expect(res.body.data[0]).toMatchObject({ resourceType: 'user', resourceId: USERS.amelia.id, userId: USERS.amelia.id });
  });
});

describe('administrators manage member accounts', () => {
  const admin = () => storage.auth.admin;
  const makeAdmin = async (u) => {
    await db.query('update public.ai_workspace_users set is_admin = true where id = $1', [u.id]);
    clearAuthCache(u.id); // the signed-in profile is cached for 30 s
  };
  const newMember = { name: 'Con Lagos', email: 'Con@Example.test', role: 'Owner', password: 'Sw1mClub-2026' };

  it('members who are not administrators cannot add, re-password or remove anyone', async () => {
    expect((await api('post', '/users', USERS.sam).send(newMember)).status).toBe(403);
    expect((await api('put', `/users/${USERS.jordan.id}/password`, USERS.sam).send({ password: 'whatever-123' })).status).toBe(403);
    expect((await api('delete', `/users/${USERS.jordan.id}`, USERS.sam)).status).toBe(403);
    expect(admin().calls).toHaveLength(0);
  });

  it('an administrator adds a member, who can then use the API, and /auth/me says who is an admin', async () => {
    await makeAdmin(USERS.amelia);
    const me = await api('get', '/auth/me');
    expect(me.body.data.user.isAdmin).toBe(true);
    expect((await api('get', '/auth/me', USERS.sam)).body.data.user.isAdmin).toBe(false);

    const res = await api('post', '/users').send(newMember);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Con Lagos', email: 'con@example.test', role: 'Owner', status: 'active', isAdmin: false });
    expect(JSON.stringify(res.body)).not.toContain(newMember.password);
    expect(admin().calls.at(-1)).toMatchObject({ op: 'create', email: 'con@example.test', appMeta: { ai_workspace: true } });
    const { rows } = await db.query('select is_managed from public.ai_workspace_users where id = $1', [res.body.data.id]);
    expect(rows[0].is_managed).toBe(true);

    expect((await api('post', '/users').send(newMember)).status).toBe(409);
    expect((await api('post', '/users').send({ ...newMember, email: USERS.outsider.email })).status).toBe(409);
    expect((await api('post', '/users').send({ ...newMember, email: 'x@y.test', password: 'short' })).status).toBe(400);
  });

  it('sets passwords only on accounts this workspace created', async () => {
    const con = (await api('get', '/users')).body.data.find((u) => u.email === 'con@example.test');
    const ok = await api('put', `/users/${con.id}/password`).send({ password: 'New-pass-2026' });
    expect(ok.status).toBe(200);
    expect(admin().calls.at(-1)).toMatchObject({ op: 'update', id: con.id, password: 'New-pass-2026' });
    // Jordan's sign-in was linked from elsewhere (not created by the workspace): never changed.
    const before = admin().calls.length;
    expect((await api('put', `/users/${USERS.jordan.id}/password`).send({ password: 'New-pass-2026' })).status).toBe(403);
    expect(admin().calls).toHaveLength(before);
  });

  it('removes a member: blocked, hidden, no access; cannot remove yourself; email can be added again', async () => {
    const con = (await api('get', '/users')).body.data.find((u) => u.email === 'con@example.test');
    expect((await api('delete', `/users/${USERS.amelia.id}`)).status).toBe(400);
    const res = await api('delete', `/users/${con.id}`);
    expect(res.status).toBe(200);
    expect(admin().calls.at(-1)).toMatchObject({ op: 'update', id: con.id, ban_duration: expect.any(String) });
    expect((await api('get', '/users')).body.data.map((u) => u.id)).not.toContain(con.id);
    // (the fake token verifier knows only USERS, so membership is checked in the table)
    const { rows } = await db.query('select is_active, removed_at from public.ai_workspace_users where id = $1', [con.id]);
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].removed_at).not.toBeNull();

    const again = await api('post', '/users').send({ ...newMember, password: 'Back-again-2026' });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(con.id);
    expect(admin().calls.at(-1)).toMatchObject({ op: 'update', id: con.id, ban_duration: 'none', password: 'Back-again-2026' });
  });

  it('a removed linked member loses access at once without touching their sign-in', async () => {
    const before = admin().calls.length;
    expect((await api('delete', `/users/${USERS.jordan.id}`)).status).toBe(200);
    expect(admin().calls).toHaveLength(before);
    expect((await api('get', '/users/me', USERS.jordan)).status).toBe(403);
  });
});

