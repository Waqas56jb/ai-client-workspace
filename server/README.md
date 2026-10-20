# StudioFlow AI — API server

Node.js (Express 5, ES modules) backend for the StudioFlow AI client workspace. It authenticates users with **Supabase Auth**, stores data in **Supabase Postgres** (tables prefixed `ai_workspace_`, protected by Row Level Security), keeps files in a **private Supabase Storage bucket**, and calls **OpenAI** for text and images. It deploys to **Railway**; the React frontend (`../client`) deploys to Vercel.

---

## Contents
1. [Architecture](#architecture)
2. [Environment variables](#environment-variables)
3. [Local setup](#local-setup)
4. [Database: schema, naming, safe migrations](#database)
5. [Authentication & the three-user workspace](#authentication)
6. [Storage](#storage)
7. [OpenAI & image processing](#openai)
8. [API reference](#api-reference)
9. [Frontend integration](#frontend-integration)
10. [Testing](#testing)
11. [Railway deployment](#railway-deployment)
12. [Logging, security & cost controls](#logging-security--cost-controls)
13. [Backup & recovery](#backup--recovery)
14. [Troubleshooting](#troubleshooting)

---

## Architecture

```
src/
├── app.js / server.js     Express app (helmet, CORS, rate limits, request ids, pino) · graceful shutdown
├── config/                env (zod-validated) · db (pg pool, RLS-scoped transactions) · supabase · openai
├── middleware/            authenticate · validate (zod) · errorHandler · rateLimiter · upload (multer) · requestContext
├── routes/                path declarations only → controllers
├── controllers/           HTTP in/out
├── services/              business rules & transactions (ai/ = prompt, context, text, image, processing, execution)
├── repositories/          SQL + row → DTO mapping
├── validators/            zod schemas per module
├── jobs/generationQueue   in-process queue for AI runs
├── constants/             vocabularies, model allowlists, upload allowlist, default templates
└── utils/                 errors, responses, mappers, logger, file detection
supabase/migrations        additive SQL migrations (see migrations/README.md)
scripts/                   inspect-db · migrate · seed · provision-user · check-openai
tests/                     vitest + supertest against an in-process Postgres (PGlite)
```

**Data access and security model.** Every request runs in a single Postgres transaction that sets `request.jwt.claims` to the verified user, marks the transaction as API-originated (`ai_workspace.via_api`) and switches to the `authenticated` role. That means **Row Level Security applies to every query**, on top of the API's own checks. Membership means having an active row in `ai_workspace_users`; any other Supabase user on the same instance is refused (403) and can see nothing. The service-role key is used only for Storage object operations, after the API has authorised the request against database records, and by the operator provisioning script.

**API-only access (migration 0004).** Supabase also exposes `public` through its own REST/RPC Data API. Membership (`ai_workspace_is_member()`) therefore also requires the API-only transaction flag, so a member's token used directly against `…/rest/v1/ai_workspace_*` or the private bucket returns nothing and cannot write. All reads and writes go through this API's validation, audit log and approval rules.

**Long-running AI work.** `POST /ai/...` persists the user message plus a `generation_run`, then responds `202 { generationId }`. A worker calls OpenAI and persists the outputs, versions, assistant message and activity. Clients poll `GET /ai/generations/:id`. Failures, including a response truncated by the token limit (`AI_INCOMPLETE`), mark the run `failed` and add an assistant error message, so a conversation is never left stuck in "generating".

Runs that can no longer finish are reconciled as `INTERRUPTED` and can be retried:
- At graceful shutdown, the process gives in-flight runs about 8 s to finish, then fails the rest.
- 30 s after start-up, runs started by a previous process are failed.
- A periodic sweep fails runs older than any run can take.

A run that was reconciled while still executing cannot later flip to succeeded, so no duplicate outputs appear. Runs use an in-process queue, so **deploy a single replica**.

---

## Environment variables

| Variable | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | – | no | `development` · `production` · `test` |
| `PORT` | – | no | HTTP port (Railway injects it) |
| `CLIENT_ORIGIN` | yes | no | Allowed CORS origin(s), comma-separated (your Vercel URL) |
| `FRONTEND_URL` | – | no | Public frontend URL (informational) |
| `SUPABASE_URL` | yes | no | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | no (public) | Publishable/anon key, used only to verify user access tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **yes** | Bypasses RLS. Used for private Storage operations and provisioning only |
| `STORAGE_BUCKET` | – | no | Default `ai-workspace-files` |
| `DATABASE_URL` *or* `DATABASE_HOST`/`DATABASE_USER`/`DATABASE_PASSWORD` | yes | **yes** (password) | Supabase **transaction pooler** (port 6543) for the API |
| `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_POOL_MAX` | – | no | Defaults 6543 / postgres / 10 |
| `DATABASE_MIGRATION_PORT` or `DATABASE_MIGRATION_URL` | scripts | **yes** (URL) | **Session pooler** (5432) for migrations and seeding |
| `OPENAI_API_KEY` | for AI | **yes** | Server-side only |
| `OPENAI_TEXT_MODEL` | – | no | Default `gpt-5.4-mini` (must be in `src/constants/models.js`) |
| `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_EDIT_MODEL` | – | no | Default `gpt-image-2` |
| `OPENAI_TIMEOUT_MS` | – | no | Default 180000 |
| `MAX_UPLOAD_SIZE_MB` | – | no | Default 15. Keep the client's `VITE_MAX_UPLOAD_MB` equal |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` | – | no | General per-IP limit |
| `AI_RATE_LIMIT_MAX_REQUESTS` | – | no | Per-user AI requests per window (default 20) |
| `AI_MAX_CONCURRENT_PER_USER` | – | no | Queued or running generations per user (default 2) |
| `IMAGE_MAX_DIMENSION_PX` | – | no | Largest requested width/height (default 4096) |
| `SIGNED_URL_TTL_SECONDS` | – | no | Download link lifetime (default 300). Preview links last 1 h |
| `LOG_LEVEL` | – | no | pino level |

See `.env.example` for placeholders. **Never commit `.env`. Never put these values in `VITE_` variables.**

---

## Local setup

```bash
cd server
npm install
cp .env.example .env          # fill in values
npm run db:inspect            # read-only look at the database
npm run db:migrate            # dry run: prints the plan, changes nothing
npm run db:migrate -- --apply # after reviewing (see supabase/migrations/README.md)
npm run db:seed               # instruction templates, starter presets, settings (insert-if-missing)
npm run users:provision -- --email you@agency.com --name "Your Name" --role "Creative Director"
npm run ai:check              # optional: one small live OpenAI text call (add --image for one image)
npm run dev                   # http://localhost:5000/api/v1/health
```

The frontend then runs with `VITE_DATA_MODE=api` and `VITE_API_BASE_URL=http://localhost:5000/api/v1` (see `../client/README.md`).

---

## Database

**Naming convention.** The Supabase database is shared with other projects. Every application-owned table, index, function, trigger and policy is named `ai_workspace_*`, and the bucket is `ai-workspace-files`. Nothing else is created, altered or dropped.

**Tables** (all in `public`):

| Table | Purpose |
| --- | --- |
| `ai_workspace_users` | Profiles of provisioned Auth users. **Active row = workspace member** |
| `ai_workspace_settings` | Single row of workspace preferences |
| `ai_workspace_clients` | Client profile and brand (colours, fonts, writing preferences JSONB, approved terms, …) |
| `ai_workspace_brand_assets` | Logos, guideline documents and reference images per client |
| `ai_workspace_jobs` | Jobs. Exactly one client each |
| `ai_workspace_tasks` | Tasks. `(job_id, client_id)` FK guarantees the task's client is the job's client |
| `ai_workspace_conversations` / `ai_workspace_messages` | AI conversations per task and their messages |
| `ai_workspace_files` / `ai_workspace_file_versions` | File metadata and immutable physical versions (bytes in Storage) |
| `ai_workspace_outputs` / `ai_workspace_output_versions` | Generated work and its immutable versions (text content, or a pointer to an image file version) |
| `ai_workspace_approvals` | Append-only approval history for specific versions |
| `ai_workspace_image_presets` | Global or client-specific sizes and layout guidance |
| `ai_workspace_ai_instructions` | Editable per-tool instructions and validated model settings |
| `ai_workspace_activity_logs` | Append-only audit trail |
| `ai_workspace_generation_runs` | AI request lifecycle (status, model, usage, safe error codes, idempotency key) |
| `ai_workspace_schema_migrations` | Applied migrations (created by the runner) |

**Integrity.**
- Composite foreign keys keep client, job and task consistent on every child row, and `ON UPDATE CASCADE` moves children when a job is reassigned.
- Guard triggers make versions immutable (only draft → approved) and make approvals and activity append-only.
- Version numbers are unique per output and per file, and are allocated under row locks in SQL functions.
- Clients, jobs, tasks and files are **archived**, never hard-deleted, so history is preserved.
- A job or task that already has conversations, AI outputs or files **cannot be moved to a different client** (409). Its history, approvals and AI context belong to the original client. Empty jobs and tasks can still be moved, and so can anything moved within the same client.
- Re-approving an earlier approved version makes it the current approved version again. Its original approval record is kept, and no duplicate is created.

**Safe migrations.** Read [`supabase/migrations/README.md`](supabase/migrations/README.md). The runner does a dry run by default, refuses destructive SQL, checks for conflicts and checksums, and is never run on application start.

---

## Authentication

- **Sign-in** happens in the browser with Supabase Auth (`signInWithPassword`). The frontend sends `Authorization: Bearer <access token>` on every API request.
- **Verification:** the API verifies the token with Supabase Auth using the publishable key (cached for 30 s), then requires an **active** `ai_workspace_users` row. If either check fails the API returns `401` or `403`.
- **No public sign-up.** An administrator provisions members with `npm run users:provision` or the Supabase dashboard plus a profile row. Deactivate someone with `--deactivate`.
- **Shared access:** all active members share the whole workspace. Members can edit only their own profile.
- **Supabase settings:**
  - disable public sign-ups (Authentication → Providers → Email → *Allow new users to sign up*), or rely on membership enforcement
  - add `<frontend>/login` to the redirect URL allow-list for password resets.

---

## Storage

- **Bucket:** `ai-workspace-files` is **private**. It is created by migration 0003 only if absent; no other bucket is used or modified.
- **Object paths** are built on the server from validated UUIDs and sanitised names:
  - `clients/{c}/jobs/{j}/tasks/{t}/originals/{fileId}/{name}`
  - `…/generated/{fileId}/original-vN.png`
  - `…/versions/{fileId}/{n}/{name}`
  - `clients/{c}/references/{fileId}/{name}`
- **Uploads** are size-limited and content-sniffed (`file-type`). The declared MIME type, sniffed type and extension must agree. SVG and executables are rejected. Each upload gets a SHA-256 checksum, and the object is removed if the database write fails.
- **Downloads and previews** use short-lived **signed URLs**, issued only after an RLS-scoped lookup of the file record. Objects are never overwritten (`upsert: false`).

---

## OpenAI

- **Text:** the Responses API (`responses.create`, `store: false`). The model comes from the instruction's validated `model_configuration` or `OPENAI_TEXT_MODEL`.
- **Images:** `images.generate`, or `images.edit` when reference images are supplied or an existing image is being edited (up to 16 inputs).
- **Exact dimensions:**
  1. Choose a native size. `gpt-image-2` takes arbitrary sizes in multiples of 16, with an aspect ratio between 1:3 and 3:1, up to 3840×2160; other models take 1024², 1536×1024 or 1024×1536.
  2. Keep the original generated image.
  3. Sharp produces exactly the requested pixels using the preset strategy (`cover` = attention crop, `contain` = pad with the client background colour, `fill`).
  4. Optionally composite the client logo.
  5. **Verify** the final width and height before storing. A mismatch is rejected (422).
  6. Record requested, generated and actual sizes.
- **Client isolation:**
  - Context is resolved **on the server** from the task → job → client records. The frontend never supplies branding.
  - Only that client's profile (filtered per tool), its job and task, the saved tool instructions, the selected preset, the conversation memory, and explicitly attached same-client files are sent.
  - **Conversation memory:** the last 20 exchanges (40 messages) of the same conversation, including the text of drafts the AI produced, within a 30,000-character budget (newest kept). A follow-up keeps the format already confirmed in that conversation.
  - Reference documents and user text are wrapped as **untrusted data** and can't override the instructions.
- **Vehicle descriptions:** missing facts are computed on the server and never invented. The client's approved warranty wording is used verbatim.
- **Limitations:** exact on-image typography and perfect preservation of details when editing arbitrary photos are not guaranteed. Exact brand text is best added through the compositing step.

---

## API reference

Base path: `/api/v1`. Success responses look like `{ success: true, data, message?, meta? }`; errors look like `{ success: false, error: { code, message, details?, requestId } }`. Every route except `/health*` needs `Authorization: Bearer`.

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` · `GET /health/ready` (database, schema, private bucket, AI configured) |
| Auth & users | `GET /auth/me` · `GET /users` · `GET/PATCH /users/me` · `GET/PATCH /users/:id` (PATCH: self only) |
| Dashboard | `GET /dashboard/summary` · `/dashboard/recent-activity` · `/recent-files` · `/recent-jobs` |
| Clients | `GET/POST /clients` · `GET/PATCH/DELETE /clients/:id` (DELETE = archive) · `GET/PATCH /clients/:id/brand` · `POST /clients/:id/archive` · `/restore` · `GET /clients/:id/deletion-impact` · `/reference-files` · `/activity` |
| Jobs | `GET/POST /jobs` · `GET/PATCH /jobs/:id` · `POST /jobs/:id/archive` · `GET /jobs/:id/tasks` · `/files` · `/activity` |
| Tasks | `GET/POST /tasks` · `GET/PATCH /tasks/:id` · `POST /tasks/:id/archive` · `GET /tasks/:id/files` · `/activity` |
| Conversations | `GET /conversations?search&clientId&tool&from&to&page&limit` (workspace chat history; `from`/`to` = ISO instants, matched against message dates) · `GET/POST /tasks/:taskId/conversations` · `GET/PATCH /conversations/:id` · `GET/POST /conversations/:id/messages` |
| AI Assistant | `POST /assistant/session {clientId}` → `{ clientId, jobId, taskId }` (the client's "AI Assistant" job/task, created once) |
| AI | `POST /ai/writing/generate` · `/ai/writing/revise` · `/ai/advertising/generate` · `/ai/vehicle-description/generate` · `/ai/images/generate` · `/ai/images/edit` · `GET /ai/generations/:id` · `POST /ai/generations/:id/retry` · `POST /ai/outputs/:id/regenerate` · `POST /ai/preview-request` |
| Files | `GET /files` · `POST /files/upload` (multipart) · `GET/PATCH /files/:id` · `GET /files/:id/download` · `/preview` · `POST /files/:id/archive` · `GET /files/:id/versions` · `POST /files/:id/versions/:vid/approve` |
| Outputs & versions | `GET /outputs` · `GET/PATCH /outputs/:id` · `GET /outputs/:id/versions` · `POST /outputs/:id/revisions` · `GET /outputs/:id/versions/:vid` · `POST …/restore` · `GET …/download` |
| Approvals | `POST /outputs/:id/versions/:vid/approve` · `GET /outputs/:id/approvals` · `GET/POST /approvals` · `GET /approvals/:id` · `GET /approved` |
| Presets | `GET/POST /image-presets` · `GET/PATCH /image-presets/:id` · `POST …/duplicate` · `/archive` · `/restore` |
| AI instructions | `GET /ai-instructions` · `GET/PATCH /ai-instructions/:tool` · `POST /ai-instructions/:tool/reset` |
| Search | `GET /search?q=&clientId&jobId&taskId&dateRange&fileKind&approval&type` · `GET /search/suggestions?q=` |
| Activity & settings | `GET /activity` · `GET/PATCH /settings/workspace` · `GET /settings/storage` |

List endpoints accept the filters shown in the frontend's services plus `page` and `limit` (default 200, maximum 500), and return `meta: { page, limit, total, pages }`. Generation endpoints accept an `Idempotency-Key` header.

---

## Frontend integration

Set these in `client/.env` (or in Vercel):
- `VITE_DATA_MODE=api`
- `VITE_API_BASE_URL=https://<railway-service>/api/v1`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (publishable key)
- `VITE_MAX_UPLOAD_MB`

The frontend signs in with Supabase, attaches the token, and polls generation runs. Demo mode (`VITE_DATA_MODE=mock`) still works without a backend.

---

## Testing

| Command | Runs | External services |
| --- | --- | --- |
| `npm test` | Unit and integration tests in-process: the real migrations on PGlite, with in-memory Storage and a fake OpenAI | none |
| `npm run test:live` | Live QA suite against the running API, the real Supabase project and real OpenAI. See [tests/live/README.md](tests/live/README.md) | Supabase, OpenAI (bounded budget) |
| `npm run test:live:no-ai` / `:ai` / `:security` | Subsets of the live suite | |
| `npm run qa:smoke -- --api … --web …` | Non-destructive deployment smoke test | deployment |
| `npm run qa:provision` / `npm run qa:cleanup` | Create QA accounts / remove QA data (dry run by default) | Supabase |
| `cd ../client && npm run test:e2e` | Playwright against the production build and this API | Supabase, OpenAI (1 call) |

The in-process suite proves logic and database rules (RLS, immutability, isolation). It does **not** prove the real integrations. The live suite and the E2E suite do that.

`npm run ai:check` performs a real, low-cost OpenAI call. Run it only when you want to verify the live key.

---

## Railway deployment

1. Create a Railway service from the repository and set **Root Directory** to `server`.
2. Railway uses `railway.json`: `npm start`, health check at `/api/v1/health`, restart on failure.
3. Add every variable from the table above in **Variables**. Use the transaction pooler for `DATABASE_*`.
4. Deploy, then check `https://<service>.up.railway.app/api/v1/health` and `/health/ready`. Keep the service at **one replica** (in-process generation queue).
5. In Vercel, set `VITE_API_BASE_URL` to `https://<service>.up.railway.app/api/v1` and redeploy the frontend.
6. Set `CLIENT_ORIGIN` on Railway to the exact Vercel origin, for example `https://studioflow.vercel.app`.
7. Run migrations and seeding from your machine with the scripts above. They are not part of the deploy. (Migrations 0001–0004 must all be applied.)
8. Verify: `npm run qa:smoke -- --api https://<service>.up.railway.app/api/v1 --web https://<vercel-domain>`.
9. Supabase Auth on the shared project currently allows public sign-ups. That does not grant workspace access, because membership is enforced, but disable sign-ups if no other project on the instance needs them.

The server keeps nothing on local disk. Uploads are processed in memory and stored in Supabase Storage. It shuts down gracefully on `SIGTERM`.

---

## Logging, security & cost controls

- **Logging:** structured pino JSON with request ids. Authorization headers, tokens, passwords and keys are redacted, and prompts and file contents are not logged.
- **Security:** Helmet headers; CORS limited to `CLIENT_ORIGIN`; a 1 MB JSON body limit; the upload size limit; zod validation everywhere (unknown fields stripped, so `createdBy`/`approvedBy` always come from the verified user); parameterised SQL; whitelisted sort columns; escaped search input; no fetching of user-supplied URLs.
- **Cost controls:**
  - per-IP and per-user AI rate limits, plus a per-user concurrency cap
  - image count limited to 4 and dimensions capped
  - `max_output_tokens` bounded
  - image quality defaults to `medium`
  - idempotency keys prevent duplicate submissions
  - every run records its model and token usage
  - actual cost depends on models, sizes and volume; no price is assumed.

---

## Backup & recovery

- **Database:**
  - Supabase Pro and higher plans take daily backups, and Point-in-Time Recovery is available as an add-on. Check *Database → Backups* for what your plan includes.
  - On the free plan, schedule `pg_dump --schema=public --table='ai_workspace_*'` (plus a full dump before migrations) and store it off-site.
- **Storage:**
  - Database backups **do not include Storage objects**. Periodically mirror the `ai-workspace-files` bucket, for example with the Supabase CLI or S3-compatible tooling such as `rclone`, to separate storage with versioning.
  - Files are never deleted by the app (archive only), so version history stays restorable.
- **Recovery:**
  1. Restore the database backup or PITR to a new project, or to the same project after confirming with the other projects' owners, since the database is shared.
  2. Restore bucket objects to the same paths.
  3. Run `npm run db:migrate` (dry run) to confirm the schema is current.
  4. Verify with `/health/ready`.
- **Retention:** keep at least 7 daily and 4 weekly backups. Test a restore quarterly.
- **Verification:** compare row counts and spot-check file checksums (`ai_workspace_file_versions.file_checksum`) after a restore.
- This README does not claim any backup has run. Configure and verify backups for your plan.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `401` on every request | Frontend `VITE_SUPABASE_URL`/`ANON_KEY` match the server's `SUPABASE_URL`, and the token isn't expired |
| `403 This account is not an active member` | Provision the user (`npm run users:provision`) or reactivate them |
| `/health/ready` reports `schema: false` | Migrations not applied |
| `/health/ready` reports `storage: false` | Bucket missing or public |
| CORS errors | `CLIENT_ORIGIN` must equal the browser origin exactly (scheme + host, no trailing slash) |
| `AI_NOT_CONFIGURED` / `AI_CONFIG_ERROR` | `OPENAI_API_KEY` is missing, or a model isn't in the allowlist |
| Generation stuck | Poll `GET /ai/generations/:id`. Runs interrupted by a restart are marked failed; use retry |
| `ECONNREFUSED`/timeouts to the database | Use the pooler host. Port 6543 for the API, 5432 for scripts |
