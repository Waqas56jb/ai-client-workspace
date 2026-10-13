import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests against the REAL stack: the production build of this
 * app (vite preview, API mode) talking to the API at VITE_API_BASE_URL, Supabase
 * Auth and the database. The API must already be running (see e2e/README.md).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e/.results/results.json' }]],
  outputDir: 'e2e/.results/artifacts',
  use: {
    baseURL: 'http://localhost:4190',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npx vite preview --port 4190 --strictPort',
    url: 'http://localhost:4190',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
