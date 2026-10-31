import 'dotenv/config';
import { z } from 'zod';

/**
 * Validated environment. The process refuses to start with invalid config.
 * Secrets are never logged; see `safeConfigSummary()` for what is printed.
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  FRONTEND_URL: z.string().url().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  STORAGE_BUCKET: z.string().regex(/^[a-z0-9-]+$/).default('ai-workspace-files'),

  // Direct Postgres connection (Supabase pooler). Use the transaction pooler (6543) for the API.
  DATABASE_URL: z.string().optional(),
  DATABASE_HOST: z.string().optional(),
  DATABASE_PORT: z.coerce.number().int().optional(),
  DATABASE_NAME: z.string().default('postgres'),
  DATABASE_USER: z.string().optional(),
  DATABASE_PASSWORD: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_SSL: bool.default('true'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().default('gpt-5.4-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2'),
  OPENAI_IMAGE_EDIT_MODEL: z.string().optional(),
  // Model that works out what each chat message needs (defaults to OPENAI_TEXT_MODEL)
  OPENAI_ROUTER_MODEL: z.string().optional(),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(180000),

  MAX_UPLOAD_SIZE_MB: z.coerce.number().min(1).max(50).default(15),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(300),
  AI_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(20),
  AI_MAX_CONCURRENT_PER_USER: z.coerce.number().int().min(1).max(10).default(2),
  IMAGE_MAX_DIMENSION_PX: z.coerce.number().int().min(256).max(8192).default(4096),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (!env.DATABASE_URL && !(env.DATABASE_HOST && env.DATABASE_USER && env.DATABASE_PASSWORD)) {
    throw new Error('Invalid environment configuration:\n  - DATABASE_URL or DATABASE_HOST/DATABASE_USER/DATABASE_PASSWORD is required');
  }
  env.OPENAI_IMAGE_EDIT_MODEL = env.OPENAI_IMAGE_EDIT_MODEL || env.OPENAI_IMAGE_MODEL;
  env.CLIENT_ORIGINS = env.CLIENT_ORIGIN.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  env.isProduction = env.NODE_ENV === 'production';
  env.isTest = env.NODE_ENV === 'test';
  return Object.freeze(env);
}

// Tests inject their own configuration and never need real credentials.
export const env = process.env.NODE_ENV === 'test' && !process.env.SUPABASE_URL
  ? Object.freeze({
      NODE_ENV: 'test', isTest: true, isProduction: false, PORT: 0,
      CLIENT_ORIGINS: ['http://localhost:5173'], CLIENT_ORIGIN: 'http://localhost:5173',
      SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'test-anon-key-xxxxxxxxxxxx', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key-xxxxxxxxx',
      STORAGE_BUCKET: 'ai-workspace-files', OPENAI_API_KEY: 'test', OPENAI_TEXT_MODEL: 'gpt-5.4-mini',
      OPENAI_IMAGE_MODEL: 'gpt-image-2', OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-2', OPENAI_TIMEOUT_MS: 10000,
      MAX_UPLOAD_SIZE_MB: 5, RATE_LIMIT_WINDOW_MS: 60000, RATE_LIMIT_MAX_REQUESTS: 1000, AI_RATE_LIMIT_MAX_REQUESTS: 5,
      AI_MAX_CONCURRENT_PER_USER: 2, IMAGE_MAX_DIMENSION_PX: 4096, SIGNED_URL_TTL_SECONDS: 300, LOG_LEVEL: 'silent',
      DATABASE_POOL_MAX: 1, DATABASE_SSL: false,
    })
  : load();

export function safeConfigSummary() {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    clientOrigins: env.CLIENT_ORIGINS,
    supabaseUrl: env.SUPABASE_URL,
    storageBucket: env.STORAGE_BUCKET,
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
    textModel: env.OPENAI_TEXT_MODEL,
    imageModel: env.OPENAI_IMAGE_MODEL,
  };
}
