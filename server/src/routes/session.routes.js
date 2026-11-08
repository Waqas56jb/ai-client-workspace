import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { passwordSignIn, refreshSession, revokeRefreshToken } from '../config/localAuth.js';
import { validate } from '../middleware/validate.js';
import { handler, ok } from '../utils/response.js';
import { notFound, unauthorized } from '../utils/errors.js';

/**
 * Public sign-in endpoints for PLATFORM=aws (with Supabase the browser talks to
 * Supabase Auth instead and these answer 404). Sessions are only issued here;
 * workspace membership is still checked on every request by authenticate().
 */
const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait 15 minutes and try again.', requestId: req.id } }),
});

const onlyAws = (_req, _res, next) => next(env.PLATFORM === 'aws' ? undefined : notFound('Route'));
const loginSchema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

router.post(
  '/auth/login',
  onlyAws,
  loginLimiter,
  validate({ body: loginSchema }),
  handler(async (req, res) => {
    const session = await passwordSignIn(req.body.email, req.body.password);
    if (!session) throw unauthorized('Invalid email or password.');
    ok(res, { session });
  }),
);

router.post(
  '/auth/refresh',
  onlyAws,
  validate({ body: refreshSchema }),
  handler(async (req, res) => {
    const session = await refreshSession(req.body.refreshToken);
    if (!session) throw unauthorized('Your session has expired. Please sign in again.');
    ok(res, { session });
  }),
);

router.post(
  '/auth/logout',
  onlyAws,
  validate({ body: refreshSchema }),
  handler(async (req, res) => {
    await revokeRefreshToken(req.body.refreshToken);
    ok(res, { ok: true });
  }),
);

export default router;
