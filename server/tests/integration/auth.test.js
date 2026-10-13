import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, authHeader, USERS } from '../helpers/testApp.js';

let app;
beforeAll(async () => {
  ({ app } = await createTestContext());
});

describe('authentication', () => {
  it('health is public', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects invalid tokens', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-real-token-at-all-xxxxxxxx');
    expect(res.status).toBe(401);
  });

  it('rejects inactive members', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(authHeader(USERS.inactive));
    expect(res.status).toBe(403);
  });

  it('rejects authenticated Supabase users who are not workspace members', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(authHeader(USERS.outsider));
    expect(res.status).toBe(403);
  });

  it('accepts active members', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(authHeader(USERS.amelia));
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: USERS.amelia.id, name: USERS.amelia.name });
  });

  it('returns a consistent 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope').set(authHeader(USERS.amelia));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
