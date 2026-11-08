import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { changeOwnPassword } from '../config/localAuth.js';
import { validate } from '../middleware/validate.js';
import { ok, handler } from '../utils/response.js';
import { notFound } from '../utils/errors.js';

/**
 * Sign-in and sign-out happen in the browser with Supabase Auth
 * (signInWithPassword / signOut). The API only verifies the resulting access
 * token on every request (see middleware/authenticate.js).
 */
const router = Router();

/** GET /auth/me — the verified, active workspace member behind this token. */
router.get(
  '/auth/me',
  handler(async (req, res) => {
    ok(res, { user: req.user, session: { verified: true, mode: 'supabase' } });
  }),
);

/** PUT /auth/password — the signed-in member sets a new password (PLATFORM=aws; Supabase does this in the browser). */
router.put(
  '/auth/password',
  validate({ body: z.object({ password: z.string().min(8, 'Use at least 8 characters.').max(72) }) }),
  handler(async (req, res) => {
    if (env.PLATFORM !== 'aws') throw notFound('Route');
    await changeOwnPassword(req.user.id, req.body.password);
    ok(res, { ok: true }, { message: 'Password changed.' });
  }),
);

export default router;
