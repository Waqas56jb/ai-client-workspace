import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

const json = (code, message) => (req, res) =>
  res.status(429).json({ success: false, error: { code, message, requestId: req.id } });

/** General API limiter (per client IP). */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: json('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'),
});

/** Expensive AI endpoints: per authenticated user (falls back to IP). */
export const aiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AI_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  handler: json('AI_RATE_LIMITED', 'Too many AI requests. Please wait a minute before generating again.'),
});
