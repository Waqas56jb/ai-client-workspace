# StudioFlow AI — AI Client Workspace

A shared workspace for a three-person team to manage clients, jobs and tasks, and to create, revise and approve AI-generated client work: emails, SMS, WhatsApp messages, advertising copy, vehicle descriptions and images.

```
ai-client-workspace/
├── client/   React + Vite frontend (Vercel). Talks to the API; demo mode is development-only
├── server/   Node.js + Express API (Railway): Supabase Auth, Postgres (RLS), private Storage, OpenAI
└── README.md
```

## Chat (the home screen)

Signing in opens the chat at `/` (an existing chat is `/chat/:id`). It works like ChatGPT: pick a client, type or add a photo, get the result, ask for changes, approve, download. Jobs and tasks stay behind the scenes: each client gets an "AI Assistant" job and task automatically, so client isolation, versions, approvals and files all work as before.

- **Sidebar:** New chat, the client picker (searchable), search, *Find by date* (a day, or a month and year), the chats grouped by Today / Yesterday / Previous 7 days / older, and **More** (Clients, Files, Approved work, Image sizes, AI instructions, Team, Settings, theme, sign out). Changing the client starts a new chat; any unsent text and files are cleared, so nothing travels to another client.
- **Composer:** *Add photo or file* (or drag and drop, or paste), *Write / Image*, *Options* (format and tone, or picture size) and *Send*.
  - Uploads show real progress.
  - The composer explains files it can't take: iPhone HEIC photos, files over 15 MB, and other unsupported types.
  - Send stays disabled until every file is uploaded.
  - If the text mentions a photo but none is added, a hint says so.
- **Writing:** the brief in AI Instructions → Writing & Editing is unchanged (Australian business English, no emojis, no subject line unless asked, never changes facts or prices). Quick changes appear under the latest answer.
- **Images:**
  - Every picture in a chat is numbered **Image 1, Image 2…** in the order it appears, counting both uploaded photos and results. The numbers come from the stored messages, so they don't change on reload.
  - **Edit this image** (on a result) or **Use** (on an uploaded photo) attaches that exact picture as a visible chip.
  - Typing "use Image 2" or "the image above" (in Image mode) proposes the matching picture as a chip the user can remove. The browser resolves it to a stored file or output version; the AI never guesses.
  - Editing a result makes a new version of it, and earlier versions stay as they were.
- **Edit an earlier message:** *Edit* on any of your messages, then *Save & send*. That message and everything after it are hidden from the chat and from the AI's memory, and the AI answers again. Nothing is deleted: earlier drafts and approvals stay in Files and Approved work.
- **Memory:** each request includes the last 20 exchanges (40 messages) of that chat, including the drafts the AI wrote. Memory is per chat; hidden (edited-away) messages are left out.
- **Progress:** the chat follows the real server status (*Waiting to start…*, *Creating your image…*, *Writing your message…*), also after a reload. A failed answer shows *Try again*.
- **Themes:** light, dark, or the same as the device (More menu). The dark theme applies only to the chat. Admin pages stay light.
- Old `/assistant` links redirect to the chat. The full history page is still at `/history`.

### API additions for the chat (backward compatible)

| Change | Request | Notes |
| --- | --- | --- |
| Replace an earlier message | `replacesMessageId` on `POST /ai/writing/generate`, `/ai/images/generate`, `/ai/images/edit` (needs `conversationId`) | One transaction hides that user message and every later one (`metadata.supersededAt`), then stores the new prompt. Returns 404 for another chat's message or an AI message, 409 if the message was already changed, and 409 `CONVERSATION_BUSY` while an answer is still running. |
| Edit an exact image version | `versionId` on `/ai/images/edit`, or `options.editVersionId` on `/ai/images/generate` | The version must belong to that output (404 otherwise). The edit starts from that version's pixels and size. |
| Which version a message produced | Messages now include `versionIds` (aligned with `outputIds`) and `editedFromId` | Older messages have none. The UI falls back to message order. |
| All versions of a chat's outputs | `GET /outputs?conversationId=…&withVersions=true` | `withVersions` is honoured only together with `conversationId`. |

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
