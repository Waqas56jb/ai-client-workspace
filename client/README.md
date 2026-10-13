# StudioFlow AI — Frontend

React 19 + Vite frontend for the StudioFlow AI client workspace. It runs in two modes:

- **Demo mode** (`VITE_DATA_MODE=mock`, the default) runs completely in the browser: no backend, database or API keys are needed.
- **API mode** (`VITE_DATA_MODE=api`) signs in with Supabase Auth and talks to the Node.js API (`../server`), which owns OpenAI, Postgres and Storage. See [API mode](#api-mode).

## Run locally

```bash
npm install
npm run dev       # development server at http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve the production build locally
```

Requires Node.js 20.19+ or 22.12+.

## Demo accounts

All three accounts share one workspace. The password for each is **`studioflow`**.

| Name | Email | Role |
| --- | --- | --- |
| Amelia Hart | amelia@studioflow.demo | Creative Director |
| Jordan Reyes | jordan@studioflow.demo | Senior Copywriter |
| Sam Okafor | sam@studioflow.demo | Designer & Production |

> ⚠️ **Demo authentication is not security.** Credentials are checked in the browser against mock data, and the route guard only controls what the UI shows. Real authentication will be provided by the Node.js backend.

## What's simulated in demo mode

| Capability | Demo behaviour | Production plan |
| --- | --- | --- |
| Sign-in | Checked in the browser (`services/authService.js`) | Backend sessions / JWT |
| AI generation | Template-based responses from `services/mock/aiGenerators.js`. No OpenAI call is made, and the UI labels results as simulated | Node.js server calls OpenAI |
| Images | Brand-coloured SVG placeholders rendered at the requested size. PNG downloads are rasterised to the exact requested pixels | Image API plus a server-side resize/crop step |
| Persistence | Versioned `localStorage` document, shared by all demo users in this browser | Supabase Postgres |
| Uploaded files | Held temporarily in this browser's IndexedDB and may be evicted | Supabase Storage |
| Search | Runs over the current mock data in the browser | Postgres full-text search |
| Backups | Explained in Settings only. No backup has been run | Supabase backups / PITR |

Browser persistence is **not** a database. Clearing site data, or switching to a different browser or device, gives you a fresh demo workspace. You can also reset it from **Settings → Storage**.

Useful demo switches:
- Put `[simulate error]` in a prompt, or turn on **Settings → Preferences → Simulate occasional AI failures**, to try the retry flow.
- In **AI Instructions**, lines such as `Append: …`, `Prefix: …` or `Sign-off: …` visibly change the simulated output. The prepared request also includes every saved instruction.

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
├── services/       the ONLY data-access layer (mock ↔ API switch)
│   └── mock/          localStorage db, IndexedDB blob store, relations, AI generators
├── store/          Zustand: auth session + UI preferences
└── mock-data/      interconnected seed data (users, clients, jobs, tasks, conversations, outputs, versions, files, presets, instructions, activity)
```

### Service layer and API readiness

Every service function goes through `call({ mock, api })` in `services/apiClient.js`:

- `VITE_DATA_MODE=mock` (the default) runs the in-browser implementation.
- `VITE_DATA_MODE=api` sends the request to `VITE_API_BASE_URL` instead.

Both paths return the same DTO shapes and throw the same `ServiceError` (`message`, `status`, `code`, `details`), so pages don't know which mode they're in. The real endpoints are in each service's `api:` branch. See also `../server/README.md`.

### Key business rules (enforced in `services/versionService.js`)

- Every output has immutable **versions**. Edits, regenerations and restores always create a **new draft version**.
- **Revising approved work never changes the approved version.** Approved Work keeps showing it until another version is explicitly approved.
- Approving a version moves `output.approvedVersionId` and records who approved it and when. The full history is kept.
- AI requests (`lib/aiRequestBuilder.js`) include **only the selected client's** profile, filtered to what each tool needs, plus the job, task, tool instructions, preset, attachments and recent history.

## Environment variables

Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_DATA_MODE` | `mock` | `mock` for demo mode, `api` to use the backend |
| `VITE_API_BASE_URL` | `http://localhost:5000/api/v1` | Node.js API base URL **including `/api/v1`** (local or Railway) |
| `VITE_SUPABASE_URL` | — | Supabase project URL (api mode) |
| `VITE_SUPABASE_ANON_KEY` | — | Supabase **anon / publishable** key (api mode). Public by design |
| `VITE_MOCK_LATENCY_MS` | `250` | Simulated latency for mock calls |

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
4. Add the environment variables. For demo mode, `VITE_DATA_MODE=mock` is enough.
5. Deploy. `vercel.json` rewrites every app route to `index.html`, so direct links and page refreshes work on routes such as `/clients/c_mowsc/brand`.

### Connecting the Railway backend

1. Deploy the Node.js server to Railway (see `../server/README.md`).
2. In Vercel, set `VITE_DATA_MODE=api`, `VITE_API_BASE_URL=https://<your-service>.up.railway.app/api/v1`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Add the Vercel domain to the server's CORS allow-list (it must allow the `Authorization` and `Idempotency-Key` headers) and to Supabase Auth's redirect URLs.
4. Redeploy the frontend, because Vite inlines environment variables at build time.

## Permanent file storage

Files uploaded in demo mode only live in this browser. In API mode files are stored privately in **Supabase Storage** and served through short-lived signed URLs. Generated outputs are stored as small render descriptions and text, so they survive a page refresh. Uploaded binaries are temporary.
