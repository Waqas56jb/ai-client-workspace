import { defineConfig } from 'vitest/config';

/**
 * LIVE QA suite: real API (must already be running at QA_API_URL), real Supabase
 * (Auth, Postgres, private Storage) and real OpenAI. See tests/live/README.md.
 * Never part of `npm test`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.js'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['default', 'json'],
    outputFile: { json: 'tests/live/.runs/last-results.json' },
  },
});
