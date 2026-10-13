# StudioFlow AI — Frontend

React 19 + Vite frontend for the StudioFlow AI client workspace.

- **API mode** (`VITE_DATA_MODE=api`, the default and the only production mode) signs in with Supabase Auth and talks to the Node.js API (`../server`), which owns OpenAI, Postgres and Storage. See [API mode](#api-mode).
- **Demo mode** (`VITE_DATA_MODE=mock`) is for local UI work only. It runs on in-browser sample data with simulated AI and demo accounts. `npm run build` refuses it unless `VITE_ALLOW_DEMO_BUILD=true` is set deliberately. In API builds the demo code, seed data and sample files are **not bundled** (see `vite.config.js`).

## Run locally

```bash
npm install
cp .env.example .env   # API mode: set VITE_API_BASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev            # development server at http://localhost:5173
npm run build          # production build in dist/ (fails if API-mode variables are missing)
npm run preview        # serve the production build locally
npm run test:e2e       # Playwright end-to-end tests against the real API (see e2e/ and ../server/tests/live/README.md)
```

Requires Node.js 20.19+ or 22.12+.

## Demo mode (development only)

With `VITE_DATA_MODE=mock`, three demo accounts with a shared demo password are listed on the login page. Sign-in, AI output, persistence (`localStorage`/IndexedDB) and search are all simulated in the browser. **None of this is security or real data.** Never deploy a mock build to clients.

## Architecture

```
src/
├── app/            App, router (lazy routes), providers, route guard
├── components/
│   ├── ui/            design-system primitives (Button, Field, Dialog, Menu, Tabs, …)
│   ├── layout/        AppShell, Sidebar, Topbar, CommandPalette (Ctrl/⌘+K)
│   ├── data-display/  ClientLogo, badges, FileThumb, ActivityFeed, …
│   ├── approvals/     ApproveButton, RevisionDialog, VersionTimeline, compare, image preview
│   ├── workspace/     AI workspace building blocks
│   └── files/         file-library building blocks
├── features/       one folder per route area (pages + feature-private components)
├── hooks/          React Query hooks (useData.js) and utilities (breadcrumbs, hotkeys, unsaved changes, file sources)
├── lib/            config, constants, utils, zod schemas, aiRequestBuilder, imageRenderer, media helpers, diff
├── services/       the ONLY data-access layer (API, or demo implementation in mock mode)
│   └── mock/          demo only: localStorage db, IndexedDB blob store, relations, simulated AI (stubbed out of API builds)
├── store/          Zustand: auth session + UI preferences
└── mock-data/      demo-only seed data (stubbed out of API builds)
```

### Service layer and API readiness

Every service function goes through `call({ mock, api })` in `services/apiClient.js`:

- `VITE_DATA_MODE=api` (the default) sends the request to `VITE_API_BASE_URL`. Paginated lists are fetched page by page (`apiClient.getAll`), so nothing is cut off at the first page.
- `VITE_DATA_MODE=mock` runs the in-browser demo implementation.

Both paths return the same DTO shapes and throw the same `ServiceError` (`message`, `status`, `code`, `details`), so pages don't know which mode they're in. The real endpoints are in each service's `api:` branch. See also `../server/README.md`.

### Key business rules (enforced by the API and the database)

- Every output has immutable **versions**. Edits, regenerations and restores always create a **new draft version**.
- **Revising approved work never changes the approved version.** Approved Work keeps showing it until another version is explicitly approved.
- Approving a version moves `output.approvedVersionId` and records who approved it and when. The full history is kept.
- AI context is built **on the server** from the task → job → client records. It includes only that client's profile, the job, the task, the tool instructions, the preset, same-client attachments and recent history.

## Environment variables

Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_DATA_MODE` | `api` | `api` (production). `mock` = development-only demo mode |
| `VITE_ALLOW_DEMO_BUILD` | — | Must be `true` to `npm run build` in mock mode (intentional demo builds only) |
| `VITE_MAX_UPLOAD_MB` | `15` | Upload limit shown in the browser. Keep it equal to the API's `MAX_UPLOAD_SIZE_MB` |
| `VITE_API_BASE_URL` | `http://localhost:5000/api/v1` | Node.js API base URL **including `/api/v1`** (local or Railway) |
| `VITE_SUPABASE_URL` | — | Supabase project URL (api mode) |
| `VITE_SUPABASE_ANON_KEY` | — | Supabase **anon / publishable** key (api mode). Public by design |
| `VITE_MOCK_LATENCY_MS` | `250` | Simulated latency for mock calls (demo mode only) |

**Never put secrets in `VITE_` variables.** They are bundled into public JavaScript. The OpenAI key and the Supabase **service-role** key belong only on the server.

## API mode

1. Set `VITE_DATA_MODE=api`, `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Sign-in** uses Supabase Auth (`signInWithPassword`) in the browser; supabase-js keeps the session and refreshes the access token. Every API request sends `Authorization: Bearer <access token>`; the server verifies it and requires an active workspace membership (403 → "Not a workspace member"). Accounts are provisioned by the administrator — there is no sign-up.
3. On app start the session is restored from Supabase (a loading screen is shown meanwhile). A 401 from the API signs out locally and returns to `/login`.
4. **Forgot password** sends a Supabase reset email that links back to `/login`; the link signs the user in and opens **Settings → Security** to choose a new password. Add `<your-frontend-origin>/login` to the Supabase Auth redirect allow-list.
5. **AI**: generate endpoints answer `200` (clarifying question) or `202` (queued). The client polls `GET /ai/generations/:id` (up to ~3 minutes) while the workspace shows "Generating…". Each submission carries an `Idempotency-Key`.
6. **Files and images** are private in Supabase Storage. Previews use short-lived signed URLs from the API; downloads fetch `/files/:id/download` or `/outputs/:id/versions/:vid/download`.
7. Demo-only UI (demo accounts, reset workspace, simulated failures, browser storage notes) is hidden in API mode. "Remember me" has no effect in API mode — Supabase keeps the session until you sign out.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `client`.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. Add the environment variables: `VITE_DATA_MODE=api`, `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAX_UPLOAD_MB`. The build fails if any of the first four is missing.
5. Deploy. `vercel.json` rewrites every app route to `index.html`, so direct links and page refreshes work on routes such as `/clients/<id>/brand`. It also sets basic security headers (`nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies).

### Connecting the Railway backend

1. Deploy the Node.js server to Railway (see `../server/README.md`).
2. In Vercel, set `VITE_DATA_MODE=api`, `VITE_API_BASE_URL=https://<your-service>.up.railway.app/api/v1`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Add the Vercel domain to the server's CORS allow-list (it must allow the `Authorization` and `Idempotency-Key` headers) and to Supabase Auth's redirect URLs.
4. Redeploy the frontend, because Vite inlines environment variables at build time.
5. Verify: `cd ../server && npm run qa:smoke -- --api https://<railway>/api/v1 --web https://<vercel-domain>`.

## File storage

In API mode, uploaded files and generated images are stored privately in **Supabase Storage** (bucket `ai-workspace-files`). They are served only through short-lived signed URLs issued by the API after it checks access. Text outputs and every version are stored in Postgres.
