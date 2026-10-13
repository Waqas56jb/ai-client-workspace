# StudioFlow AI — AI Client Workspace

A shared workspace for a three-person team to manage clients, jobs and tasks, and to create, revise and approve AI-generated client work: emails, SMS, WhatsApp messages, advertising copy, vehicle descriptions and images.

```
ai-client-workspace/
├── client/   React + Vite frontend (Vercel). Talks to the API; demo mode is development-only
├── server/   Node.js + Express API (Railway): Supabase Auth, Postgres (RLS), private Storage, OpenAI
└── README.md
```

## Quick start (local)

```bash
# API
cd server
npm install
cp .env.example .env            # fill in Supabase, database and OpenAI values
npm run db:migrate              # dry run; then: npm run db:migrate -- --apply
npm run db:seed                 # AI instruction templates, starter presets, settings
npm run users:provision -- --email you@agency.com --name "Your Name" --role "Creative Director"
npm run dev                     # http://localhost:5000/api/v1/health

# Frontend
cd ../client
npm install
cp .env.example .env            # VITE_DATA_MODE=api, VITE_API_BASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

There is no public sign-up. Members are provisioned by an administrator (see [server/README.md](server/README.md#authentication)).

**Demo mode** (`VITE_DATA_MODE=mock`) runs the UI on in-browser sample data with simulated AI, for local design work only. A production build refuses it unless `VITE_ALLOW_DEMO_BUILD=true` is set on purpose, and in API builds none of the demo code or data is bundled.

## Testing

| Where | Command | What it proves |
| --- | --- | --- |
| `server/` | `npm test` | Unit and integration tests in-process (PGlite and fakes, no network) |
| `server/` | `npm run test:live` | The real API against real Supabase and real OpenAI (bounded budget). See [server/tests/live/README.md](server/tests/live/README.md) |
| `client/` | `npm run test:e2e` | Playwright against the production build and the real API: auth, every page at four viewports, UI workflows, accessibility |
| `server/` | `npm run qa:smoke -- --api … --web …` | Non-destructive check of a deployment |
| `server/` | `npm run qa:cleanup` | Removes QA test data (dry run by default) |

## Deployment

- **API (Railway):** root directory `server`, health check at `/api/v1/health`. Run **one replica**, because the AI generation queue is in-process. See [server/README.md](server/README.md#railway-deployment).
- **Frontend (Vercel):** root directory `client`, with `VITE_DATA_MODE=api` and the variables above. See [client/README.md](client/README.md).
- After deploying, run `npm run qa:smoke -- --api https://<railway>/api/v1 --web https://<vercel>`.
