# StudioFlow AI — AI Client Workspace

A shared workspace for a three-person team to manage clients, jobs and tasks, and to create, revise and approve AI-generated client work: emails, SMS, WhatsApp messages, advertising copy, vehicle descriptions and images.

```
ai-client-workspace/
├── client/   React + Vite frontend (Vercel). Talks to the API; demo mode is development-only
├── server/   Node.js + Express API (Railway): Supabase Auth, Postgres (RLS), private Storage, OpenAI
└── README.md
```

## AI Assistant (main way to work)

- **AI Assistant** (`/assistant`): pick a client, choose *Write a message* or *Create an image*, then paste a draft or describe what you need. No job or task set-up is needed. Each client gets an "AI Assistant" job automatically, so all the normal rules still apply: client isolation, versions, approvals and files.
- **Writing:** the Writing tool follows the agency's email assistant brief.
  - It uses natural Australian business English.
  - If the format (email, SMS or WhatsApp) is unclear, it asks first.
  - Tones are Persuasive, Professional, Formal and Casual.
  - It adds no emojis, and no subject line unless asked.
  - It never changes facts or prices.
  - You can edit the brief in **AI Instructions → Writing & Editing**.
- **Quick changes** under each written result: Shorter, More persuasive, More formal, Casual, More assertive, More diplomatic, 2 other versions, Explain changes, As SMS, As WhatsApp.
- **Memory:** every request includes the last 20 exchanges (40 messages) of that chat, including the drafts the AI wrote, so follow-ups like "make it friendlier" work. Memory is per chat and per client; it is never shared across clients.
- **Images:** create from a description, or upload a photo and say what to change. Results are exactly the chosen size. A small preview is shown in the chat; downloads are the full-size file.
- **Chat history** (`/history`, plus the panel inside the assistant): every chat, grouped by day, with search by words, client, type, an exact day, or month and year.

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
