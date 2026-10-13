import { Router } from 'express';
import { ok, handler } from '../utils/response.js';

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

export default router;
