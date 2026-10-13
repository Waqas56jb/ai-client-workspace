import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/live/**', 'node_modules/**'], // live suite: vitest.live.config.js
    // Tests never use real credentials or the shared Supabase project.
    env: { NODE_ENV: 'test', SUPABASE_URL: '', LOG_LEVEL: 'silent' },
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
  },
});
