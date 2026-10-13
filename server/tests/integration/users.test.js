import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, createTestContext, USERS } from '../helpers/testApp.js';

let app;
const api = (method, path, user = USERS.amelia) => request(app)[method](`/api/v1${path}`).set(authHeader(user));

beforeAll(async () => {
  ({ app } = await createTestContext());
});

describe('users', () => {
  it('lists the team with the User DTO and no auth data', async () => {
    const res = await api('get', '/users');
    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.email)).toEqual(expect.arrayContaining([USERS.amelia.email, USERS.jordan.email, USERS.inactive.email]));
    expect(res.body.data.map((u) => u.id)).not.toContain(USERS.outsider.id);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['avatarColor', 'createdAt', 'email', 'id', 'lastActiveAt', 'name', 'role', 'status']);
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
