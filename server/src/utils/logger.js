import pino from 'pino';
import { env } from '../config/env.js';

/** Structured logger with secret redaction. Never log keys, tokens or passwords. */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'ai-workspace-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.access_token',
      '*.refresh_token',
      '*.apiKey',
      '*.api_key',
      '*.token',
      'headers.authorization',
    ],
    censor: '[redacted]',
  },
});
