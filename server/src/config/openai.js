import OpenAI from 'openai';
import { env } from './env.js';

/**
 * Server-side OpenAI client. The API key never leaves the backend.
 * Model names are validated against src/constants/models.js before use.
 */
let client = null;
export function getOpenAI() {
  if (!env.OPENAI_API_KEY) {
    const err = new Error('OpenAI is not configured on the server (OPENAI_API_KEY is missing).');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_TIMEOUT_MS, maxRetries: 2 });
  return client;
}

export function setOpenAI(c) {
  client = c;
}
