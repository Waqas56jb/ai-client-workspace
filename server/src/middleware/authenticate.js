import crypto from 'node:crypto';
import { getAuthClient } from '../config/supabase.js';
import { getDatabase } from '../config/db.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Authentication + workspace membership.
 *
 * 1. Requires `Authorization: Bearer <Supabase access token>`.
 * 2. Verifies the token with Supabase Auth (anon/publishable client — the
 *    service role is never used for this).
 * 3. Requires an ACTIVE row in ai_workspace_users for that auth user. Any other
 *    Supabase user (e.g. from another project on the same instance) is rejected.
 *
 * Sets req.user = { id, email, name, role, avatarColor } and req.accessToken.
 * Client-supplied user ids are never trusted.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map();

/** Default verifier: Supabase Auth getUser(token). Replaceable in tests. */
let verifyToken = async (token) => {
  const { data, error } = await getAuthClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
};

export function setTokenVerifier(fn) {
  verifyToken = fn;
  cache.clear();
}

async function verifyCached(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.user;
  const user = await verifyToken(token);
  if (user) {
    cache.set(key, { user, expires: Date.now() + CACHE_TTL_MS });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
  return user;
}

const lastSeenWrite = new Map();

export async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/);
    if (!match) throw unauthorized('Sign in to continue.');

    let authUser;
    try {
      authUser = await verifyCached(match[1]);
    } catch (err) {
      logger.warn({ reqId: req.id, err: err?.message }, 'token verification failed');
      authUser = null;
    }
    if (!authUser?.id) throw unauthorized('Your session has expired or is invalid. Please sign in again.');

    // RLS: the profile row is only visible if the user is an ACTIVE member.
    const profile = await getDatabase().withUser(authUser.id, async (tx) => {
      const { rows } = await tx.query(
        `select id, display_name, email, role_title, avatar_colour, is_active
           from public.ai_workspace_users where id = $1`,
        [authUser.id],
      );
      const row = rows[0];
      if (row?.is_active) {
        const last = lastSeenWrite.get(row.id) || 0;
        if (Date.now() - last > 5 * 60_000) {
          lastSeenWrite.set(row.id, Date.now());
          await tx.query('update public.ai_workspace_users set last_active_at = now() where id = $1', [row.id]);
        }
      }
      return row;
    });
    if (!profile || !profile.is_active) {
      throw forbidden('This account is not an active member of the StudioFlow workspace.');
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      name: profile.display_name,
      role: profile.role_title,
      avatarColor: profile.avatar_colour,
    };
    req.accessToken = match[1];
    next();
  } catch (err) {
    next(err);
  }
}
