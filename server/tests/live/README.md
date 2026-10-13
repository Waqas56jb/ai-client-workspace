# Live QA suite

These tests run against the **real** stack: the running API, the real Supabase project (Auth, Postgres with RLS, private Storage) and the real OpenAI API. They never use fakes. The in-process suite (`npm test`, PGlite + fakes) is separate and is not proof that the real integrations work.

| Command (in `server/`) | What it runs | Real OpenAI calls |
| --- | --- | --- |
| `npm test` | Unit + integration tests in-process (PGlite, fake Storage, fake OpenAI) | 0 |
| `npm run test:live` | Everything below | ≈ 7 text + 3 image |
| `npm run test:live:no-ai` | All live tests except `ai.live.test.js` | 0 |
| `npm run test:live:ai` | Live AI text, isolation and exact image-dimension tests | ≈ 7 text + 3 image (quality `low`) |
| `npm run test:live:security` | Route matrix (every registered route), auth, security | 0 |
| `npm run qa:smoke -- --api … --web …` | Non-destructive deployment smoke test | 0 |
| `cd ../client && npm run test:e2e` | Playwright: auth, every page at 4 viewports, UI workflows, accessibility | 1 text |

## Files

| File | Covers |
| --- | --- |
| `routes.live.test.js` | Discovers **every** route on the Express router: 401 without a token, 400 for malformed ids, 404 for unknown ids |
| `auth.live.test.js` | Supabase sign-in for the three members, bad credentials, malformed/forged/expired tokens, outsider and inactive users (403), refresh, concurrent sessions, revoked sessions |
| `crud.live.test.js` | Clients, brand, jobs, tasks: validation matrix, mass assignment, Unicode/HTML, search, pagination, archive/restore, three-user collaboration, concurrency, dashboard counts vs database |
| `files.live.test.js` | Private bucket, signed URLs (and expiry), checksums, Unicode/traversal names, spoofed/corrupt/empty/oversized uploads, unauthorised access |
| `security.live.test.js` | Conversations/messages, **Supabase Data API lockdown**, headers, CORS, stored XSS, protected fields, secrets in bundle/logs |
| `ai.live.test.js` | Client-context isolation (prompt built from the real DB, concurrent generations), clarification, prompt injection, revisions/approvals, advertising, vehicle facts, exact image dimensions verified on the downloaded file |
| `config.live.test.js` | Presets, AI instructions, workspace settings (snapshotted and restored), search, dashboard, activity, users |
| `faults.live.test.js` | Extra API instances with one dependency broken: provider 429/500/401/malformed/empty/truncated/timeout (local fake endpoint), retry, double submit, database unreachable, storage unavailable, AI unconfigured, invalid config |

## Setup

1. `server/.env` must hold the real configuration (see `../../README.md`).
2. Create the QA accounts once: `npm run qa:provision`. This writes `server/.env.qa` (git-ignored) with five accounts: three active members, one inactive member, and one Supabase user who is **not** a member.
3. Start the API: `PORT=5055 CLIENT_ORIGIN=http://localhost:5173,http://localhost:4190 npm start`.
4. Run a suite from the table above.

## Safety

- Every record is created through the API, belongs to a client named `QA_<run>_…` and is created by a QA account. Database checks run in `READ ONLY` transactions.
- OpenAI calls have a hard budget per run (`QA_OPENAI_TEXT_BUDGET`, `QA_OPENAI_IMAGE_BUDGET`). Each call is recorded in `tests/live/.runs/<run>.json`.
- Shared configuration that tests change (AI instructions, workspace settings) is snapshotted and restored.
- Fault tests never use a wrong database password, because repeated failed logins could get this IP banned by the shared pooler.

## Cleanup

```bash
npm run qa:cleanup                       # dry run: shows exactly what would be removed
npm run qa:cleanup -- --apply            # removes QA data + its storage objects
npm run qa:cleanup -- --apply --remove-accounts   # also deletes the qa-sf-* auth accounts
```

The cleanup only removes clients that were **created by a QA account and** are named `QA_…`, plus everything under them. It aborts if anything else would be touched, and it reports how many other clients were preserved.
