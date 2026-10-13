/**
 * Central runtime configuration. The app uses the Node.js API unless
 * VITE_DATA_MODE is explicitly "mock" (in-browser demo data, development only —
 * a production build refuses mock mode unless VITE_ALLOW_DEMO_BUILD=true; see
 * vite.config.js). Mock code is not even bundled in API builds.
 *
 * Only PUBLIC values belong here: everything prefixed with VITE_ is bundled into
 * browser JavaScript. The Supabase anon/publishable key is designed to be public;
 * the service-role key and the OpenAI key must only ever live on the server.
 */
export const config = {
  dataMode: import.meta.env.VITE_DATA_MODE === 'mock' ? 'mock' : 'api',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  mockLatencyMs: Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 250),
  storageKey: 'studioflow.workspace',
  storageVersion: 3,
  sessionKey: 'studioflow.session',
  maxUploadBytes: Number(import.meta.env.VITE_MAX_UPLOAD_MB || 15) * 1024 * 1024, // keep in sync with the API's MAX_UPLOAD_SIZE_MB
  demoStorageQuotaBytes: 50 * 1024 * 1024,
};

export const isMockMode = config.dataMode === 'mock';
export const isApiMode = !isMockMode;
