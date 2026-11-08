import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from './env.js';
import { getDatabase } from './db.js';

/**
 * Sign-in without Supabase (PLATFORM=aws): accounts live in auth.users in our own
 * Postgres (bcrypt passwords — hashes copied from Supabase keep working), the API
 * issues short-lived HS256 access tokens and rotating refresh tokens (only their
 * SHA-256 hash is stored).
 *
 * Exposes the same shapes the code already uses from supabase-js:
 *   authClient.auth.getUser(token)          → { data: { user }, error }
 *   adminApi.createUser / updateUserById / deleteUser
 */

export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 12;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function secret() {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET (32+ characters) is required when PLATFORM=aws');
  return env.JWT_SECRET;
}

export function signAccessToken(user, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated', iat: now, exp: now + ACCESS_TTL_SECONDS }));
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return { token: `${header}.${payload}.${sig}`, expiresAt: now + ACCESS_TTL_SECONDS };
}

/** Verified claims, or null (bad signature, wrong algorithm, expired, malformed). */
export function verifyAccessToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const expected = crypto.createHmac('sha256', secret()).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

const system = (fn) => getDatabase().withSystem(fn);
const isBanned = (row) => row.banned_until && new Date(row.banned_until) > new Date();

async function issueSession(tx, row) {
  const access = signAccessToken(row);
  const refresh = crypto.randomBytes(32).toString('base64url');
  await tx.query(`insert into auth.refresh_tokens (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`, [
    sha256(refresh),
    row.id,
    REFRESH_TTL_DAYS,
  ]);
  return {
    access_token: access.token,
    refresh_token: refresh,
    expires_at: access.expiresAt,
    token_type: 'bearer',
    user: { id: row.id, email: row.email, last_sign_in_at: row.last_sign_in_at || new Date().toISOString() },
  };
}

// bcrypt work even for unknown emails, so response time does not reveal which accounts exist
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

/** Email + password → session, or null when the credentials are wrong or the account is blocked. */
export async function passwordSignIn(email, password) {
  return system(async (tx) => {
    const { rows } = await tx.query('select id, email, encrypted_password, banned_until from auth.users where lower(email) = lower($1)', [email]);
    const row = rows[0];
    const ok = await bcrypt.compare(String(password), row?.encrypted_password || DUMMY_HASH);
    if (!row || !ok || isBanned(row)) return null;
    const { rows: upd } = await tx.query('update auth.users set last_sign_in_at = now() where id = $1 returning id, email, last_sign_in_at', [row.id]);
    return issueSession(tx, upd[0]);
  });
}

/** Rotates a refresh token → new session, or null (unknown, expired, revoked, blocked). Reuse of a revoked token revokes them all. */
export async function refreshSession(refreshToken) {
  return system(async (tx) => {
    const { rows } = await tx.query(
      `select t.user_id, t.expires_at, t.revoked_at, u.id, u.email, u.banned_until, u.last_sign_in_at
         from auth.refresh_tokens t join auth.users u on u.id = t.user_id where t.token_hash = $1 for update of t`,
      [sha256(String(refreshToken || ''))],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.revoked_at) {
      await tx.query('update auth.refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [row.user_id]);
      return null;
    }
    if (new Date(row.expires_at) <= new Date() || isBanned(row)) return null;
    await tx.query('update auth.refresh_tokens set revoked_at = now() where token_hash = $1', [sha256(refreshToken)]);
    return issueSession(tx, row);
  });
}

export async function revokeRefreshToken(refreshToken) {
  await system((tx) => tx.query('update auth.refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [sha256(String(refreshToken || ''))]));
}

const hash = (password) => bcrypt.hash(String(password), BCRYPT_ROUNDS);
const err = (status, message) => ({ status, message });

/** supabase-js-shaped admin API over auth.users. */
export const adminApi = {
  async createUser({ email, password, user_metadata: userMeta = {}, app_metadata: appMeta = {} }) {
    const encrypted = await hash(password);
    return system(async (tx) => {
      const { rows: taken } = await tx.query('select 1 from auth.users where lower(email) = lower($1)', [email]);
      if (taken[0]) return { data: null, error: err(422, 'A user with this email address has already been registered') };
      const { rows } = await tx.query(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data, raw_app_meta_data) values (lower($1), $2, $3, $4) returning id, email`,
        [email, encrypted, userMeta, appMeta],
      );
      return { data: { user: rows[0] }, error: null };
    });
  },

  async updateUserById(id, attrs = {}) {
    const sets = [];
    const params = [id];
    if (attrs.password !== undefined) {
      params.push(await hash(attrs.password));
      sets.push(`encrypted_password = $${params.length}`);
    }
    if (attrs.ban_duration !== undefined) {
      const hours = attrs.ban_duration === 'none' ? null : Number.parseInt(attrs.ban_duration, 10);
      params.push(hours);
      sets.push(`banned_until = case when $${params.length}::int is null then null else now() + make_interval(hours => $${params.length}::int) end`);
    }
    if (attrs.user_metadata) {
      params.push(attrs.user_metadata);
      sets.push(`raw_user_meta_data = raw_user_meta_data || $${params.length}::jsonb`);
    }
    if (!sets.length) return { data: { user: { id } }, error: null };
    return system(async (tx) => {
      const { rowCount } = await tx.query(`update auth.users set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
      if (!rowCount) return { data: null, error: err(404, 'User not found') };
      // a new password or a block signs every device out
      if (attrs.password !== undefined || (attrs.ban_duration && attrs.ban_duration !== 'none')) {
        await tx.query('update auth.refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [id]);
      }
      return { data: { user: { id } }, error: null };
    });
  },

  async deleteUser(id) {
    await system((tx) => tx.query('delete from auth.users where id = $1', [id]));
    return { data: null, error: null };
  },
};

/** Changes the signed-in user's own password (Settings → Security). */
export async function changeOwnPassword(userId, password) {
  const { error } = await adminApi.updateUserById(userId, { password });
  if (error) throw Object.assign(new Error(error.message), { status: error.status });
}

/** supabase-js-shaped token check used by middleware/authenticate.js. */
export const localAuthClient = {
  auth: {
    async getUser(token) {
      const claims = verifyAccessToken(token);
      if (!claims) return { data: null, error: { message: 'invalid token' } };
      const { rows } = await system((tx) => tx.query('select id, email, banned_until from auth.users where id = $1', [claims.sub]));
      if (!rows[0] || isBanned(rows[0])) return { data: null, error: { message: 'user not found or blocked' } };
      return { data: { user: { id: rows[0].id, email: rows[0].email } }, error: null };
    },
  },
};
