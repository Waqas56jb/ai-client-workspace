import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrationFiles } from '../helpers/testDb.js';
import { pgliteAdapter } from '../helpers/testApp.js';
import { setDatabase } from '../../src/config/db.js';
import { adminApi, localAuthClient, passwordSignIn, refreshSession, revokeRefreshToken, signAccessToken, verifyAccessToken } from '../../src/config/localAuth.js';

/**
 * PLATFORM=aws: sign-in without Supabase. The bootstrap + every migration must
 * apply to an empty Postgres (as on RDS), and sessions must be safe.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.resolve(here, '../../aws/bootstrap.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.resolve(here, '../../aws/bootstrap.sql'), 'utf8')); // safe to run twice
  for (const m of migrationFiles()) await db.exec(m.sql);
  setDatabase(pgliteAdapter(db));
});

describe('own sign-in (PLATFORM=aws)', () => {
  let id;

  it('bootstrap + all migrations apply to an empty database; account tables stay private', async () => {
    const { rows } = await db.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like 'ai_workspace_%'`);
    expect(rows[0].n).toBeGreaterThan(15);
    await expect(
      db.transaction(async (tx) => {
        await tx.query('set local role authenticated');
        await tx.query('select * from auth.users');
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('creates an account (bcrypt, never plain) and refuses a duplicate email', async () => {
    const r = await adminApi.createUser({ email: 'Con@Example.test', password: 'Swim-club-2026', user_metadata: { display_name: 'Con' } });
    expect(r.error).toBeNull();
    id = r.data.user.id;
    const { rows } = await db.query('select email, encrypted_password from auth.users where id = $1', [id]);
    expect(rows[0].email).toBe('con@example.test');
    expect(rows[0].encrypted_password).toMatch(/^\$2[aby]\$12\$/);
    expect((await adminApi.createUser({ email: 'con@example.TEST', password: 'whatever-123' })).error.status).toBe(422);
  });

  it('signs in with the right password only; the access token is verified by getUser', async () => {
    expect(await passwordSignIn('con@example.test', 'wrong-password')).toBeNull();
    expect(await passwordSignIn('nobody@example.test', 'Swim-club-2026')).toBeNull();
    const s = await passwordSignIn('CON@example.test', 'Swim-club-2026');
    expect(s).toMatchObject({ token_type: 'bearer', user: { id, email: 'con@example.test' } });
    const me = await localAuthClient.auth.getUser(s.access_token);
    expect(me.data.user).toEqual({ id, email: 'con@example.test' });
  });

  it('rejects tampered, foreign-algorithm and expired tokens', async () => {
    const { token } = signAccessToken({ id, email: 'con@example.test' });
    const [h, p, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: '00000000-0000-4000-8000-000000000000' })).toString('base64url');
    expect(verifyAccessToken(`${h}.${forged}.${sig}`)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyAccessToken(`${none}.${p}.`)).toBeNull();
    expect(verifyAccessToken(signAccessToken({ id, email: 'x' }, Math.floor(Date.now() / 1000) - 7200).token)).toBeNull();
    expect(verifyAccessToken('garbage')).toBeNull();
  });

  it('refresh tokens rotate; reusing an old one signs every device out', async () => {
    const s1 = await passwordSignIn('con@example.test', 'Swim-club-2026');
    const s2 = await refreshSession(s1.refresh_token);
    expect(s2.refresh_token).not.toBe(s1.refresh_token);
    expect(await refreshSession(s1.refresh_token)).toBeNull(); // replay → everything revoked
    expect(await refreshSession(s2.refresh_token)).toBeNull();
    const s3 = await passwordSignIn('con@example.test', 'Swim-club-2026');
    await revokeRefreshToken(s3.refresh_token);
    expect(await refreshSession(s3.refresh_token)).toBeNull();
  });

  it('a new password replaces the old one and signs other devices out', async () => {
    const s = await passwordSignIn('con@example.test', 'Swim-club-2026');
    expect((await adminApi.updateUserById(id, { password: 'New-pass-2026' })).error).toBeNull();
    expect(await passwordSignIn('con@example.test', 'Swim-club-2026')).toBeNull();
    expect(await refreshSession(s.refresh_token)).toBeNull();
    expect(await passwordSignIn('con@example.test', 'New-pass-2026')).toBeTruthy();
  });

  it('a blocked account cannot sign in or use a token; unblocking restores it', async () => {
    const s = await passwordSignIn('con@example.test', 'New-pass-2026');
    await adminApi.updateUserById(id, { ban_duration: '876000h' });
    expect(await passwordSignIn('con@example.test', 'New-pass-2026')).toBeNull();
    expect((await localAuthClient.auth.getUser(s.access_token)).data).toBeNull();
    expect(await refreshSession(s.refresh_token)).toBeNull();
    await adminApi.updateUserById(id, { ban_duration: 'none', password: 'Back-2026-pass' });
    expect(await passwordSignIn('con@example.test', 'Back-2026-pass')).toBeTruthy();
  });

  it('bcrypt hashes copied from Supabase keep working', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const supabaseStyle = bcrypt.hashSync('Old-supabase-pass', 10).replace(/^\$2b\$/, '$2a$');
    await db.query(`insert into auth.users (email, encrypted_password) values ('moved@example.test', $1)`, [supabaseStyle]);
    expect(await passwordSignIn('moved@example.test', 'Old-supabase-pass')).toBeTruthy();
  });
});
