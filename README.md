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
- **Composer:** one box: *Add photo or file* (or drag and drop, or paste), *Options* (email/SMS/WhatsApp, tone, size for new pictures — used only when they apply) and *Send*. There is no Write/Image switch: the server works out what each message needs (see below).
  - Uploads show real progress.
  - The composer explains files it can't take: iPhone HEIC photos, files over 15 MB, and other unsupported types.
  - Send stays disabled until every file is uploaded.
  - If the text mentions a photo but none is added, a hint says so.
- **Writing:** the brief in AI Instructions → Writing & Editing is unchanged (Australian business English, no emojis, no subject line unless asked, never changes facts or prices). Quick changes appear under the latest answer.
- **Images:**
  - Every picture in a chat is numbered **Image 1, Image 2…** in the order it appears, counting both uploaded photos and results. The numbers come from the stored messages, so they don't change on reload.
  - **Edit this image** (on a result) or **Use** (on an uploaded photo) attaches that exact picture as a visible chip.
  - Typing "use Image 2" shows that picture as a chip the user can remove. Vaguer references ("the image above", "the original photo", "the first image") are resolved by the server from the stored picture list. If two pictures could be meant, the assistant asks which one.
  - Editing a result makes a new version of it, and earlier versions stay as they were.
- **Edit an earlier message:** *Edit* on any of your messages, then *Save & send*. That message and everything after it are hidden from the chat and from the AI's memory, and the AI answers again. Nothing is deleted: earlier drafts and approvals stay in Files and Approved work.
- **Memory:** each request includes the last 20 exchanges (40 messages) of that chat, including the drafts the AI wrote. Memory is per chat; hidden (edited-away) messages are left out.
- **Progress:** the chat follows the real server status (*Waiting to start…*, *Creating your image…*, *Writing your message…*), also after a reload. A failed answer shows *Try again*.
- **Themes:** light, dark, or the same as the device (More menu). The dark theme applies only to the chat. Admin pages stay light.
- Old `/assistant` links redirect to the chat. The full history page is still at `/history`.

### How the assistant understands a message

Every chat message goes to `POST /ai/assistant/message` ([assistant.service.js](server/src/services/ai/assistant.service.js)):

1. **Trusted context from the database**:
   - the task, and from it the client (never taken from the request)
   - this chat's pictures numbered *Image 1, Image 2…*, exactly as the chat shows them ([imageRegistry.js](server/src/services/ai/imageRegistry.js)), each tied to a stored file or output version
   - the active messages, including the first request
   - the files added with this message
2. **Router** ([router.service.js](server/src/services/ai/router.service.js)): one structured-output call to the text model.
   - **What it sees:** small copies of the new and latest pictures.
   - **What it decides:** `answer`, `write`, `generate_image`, `edit_image`, `clarify` or `unsupported`.
   - **Details it adds:** which picture to edit, exactly what to change, what must stay the same, local or whole-picture edit, and a pixel size if the user gave one.
   - **Checks:** every picture number is checked against the stored list. A picture the user chose (*Edit this image* or *Use*, or "Image 2" typed) always wins. If the picture can't be identified, the assistant asks one short question.
3. **The existing pipeline does the work**, with runs, versions, approvals and memory as before:
   - **answer:** text model with chat memory, client context, the pictures it must look at (vision) and PDFs. It is stored as a chat reply, not a draft.
   - **write:** the agency's email brief. If the format is truly unclear, it still asks email, SMS or WhatsApp.
   - **generate_image:** a new picture from a self-contained description that carries details over from the chat. Reference pictures are used when named.
   - **edit_image:**
     - An AI picture gets a new version, made from the exact version chosen.
     - An uploaded photo gives a new picture, and the photo itself is never overwritten.
     - Edits use a dedicated prompt (change only X; keep Y; no redesign or re-framing) without the preset layout or brand redesign guidance.
     - The source picture's own size and shape are kept, unless a size was asked for. A different canvas is extended rather than stretched or cropped.
     - `input_fidelity: high` is sent where the model supports it (gpt-image-1 and 1.5; gpt-image-2 must omit it).
   - **clarify / unsupported:** the question or the honest limitation is stored as the reply. Nothing is generated.
4. **Checks after every picture:**
   - The final file's pixels are verified to be exactly the requested width × height.
   - Edits get a **change check**: a coarse similarity and changed-area measure against the source, stored in the version's `image` metadata and stated in the reply. A local edit that changed more than 45% of the picture is flagged.

### Documents, spreadsheets and folders

- **Reading at upload.** Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, text and Markdown are read when they are uploaded ([documents.service.js](server/src/services/documents.service.js): mammoth, exceljs, jszip).
  - The chip in the composer shows whether the file was read: *Read · ready to send*, *only the first part*, or *Can't be read: …*.
  - The real text goes to the model with each request: up to 60,000 characters per file and 160,000 per request. Spreadsheets keep their sheet names and row numbers.
  - PDFs are given to the model as files, so text and scanned pages are both read.
  - Old .doc and .xls files get an honest "save as .docx / .xlsx" message.
- **Files earlier in the chat stay usable.** The router sees the chat's files numbered *File 1, File 2…*, with their reading status and the start of any new document. It picks which ones a task needs, so "write an email to staff about this form" later in the chat uses the form.
  - If the message mentions a document but the router picks none, the latest readable files are used.
  - Earlier files are used by the run without being re-attached to the new message.
- **Folders.** The *Folder* button adds the usable files of a whole folder, up to 20 per message. Unusable files are skipped with a note.
- **Document answers** are chat replies, not approvable drafts. The answer prompt:
  - separates what the document says from interpretation
  - names the file, sheet or slide used
  - says plainly when something could not be read
  - for HR, medical, legal and financial documents, flags privacy and compliance points and recommends professional review

### Memory

- **The chat:** the last 40 messages (30,000 characters), with picture and file labels and the drafts the AI wrote. The first request is always kept.
- **Long chats:** when a chat grows past the window, the older part is summarised in the background into a hidden system message (original goal, requirements, decisions, files, pictures, open work). The summary is used with every later request. Editing an earlier message hides summaries made after it.
- **Client memory** (table `ai_workspace_client_memories`, migration **0005**):
  - The router saves lasting facts the user states, such as "I'm Sarah, the HR manager; sign my emails as…". It never saves personal, HR, medical, financial or secret details, or anything from inside documents.
  - It removes facts the user asks to forget or corrects.
  - Facts are used in every chat for that client only.
  - The team can see, add and delete them under *Chat options → What the AI remembers*.
  - Until migration 0005 is applied, memory is simply off: the chat works, and the memory endpoints answer 503 `MEMORY_NOT_SET_UP`.

To turn client memory on, apply the migration: `cd server && npm run db:migrate` (dry run), then `npm run db:migrate -- --apply`.

**Known limits (model behaviour, not hidden):**
- **Edits are not guaranteed pixel-perfect.** Image models redraw the whole picture, so small unrequested changes can happen. The change check reports how much changed, but it can't prove only the requested detail changed.
- **No automatic masking.** There is no automatic object or background masking yet: the edit API supports masks, but no segmentation model is configured.
- **Some files can't be used.** Old .doc and .xls files and ZIP files are not read. Pictures inside Word or PowerPoint files are not looked at; only their text is.
- **No retrieval index yet.** Very long documents are cut at 60,000 characters per file, and the reply says so. There is no search index (RAG) over all past files yet.
- **Answers are not streamed.** They appear when complete, after *Thinking…*.

### API additions for the chat (backward compatible)

| Change | Request | Notes |
| --- | --- | --- |
| Replace an earlier message | `replacesMessageId` on `POST /ai/writing/generate`, `/ai/images/generate`, `/ai/images/edit` (needs `conversationId`) | One transaction hides that user message and every later one (`metadata.supersededAt`), then stores the new prompt. Returns 404 for another chat's message or an AI message, 409 if the message was already changed, and 409 `CONVERSATION_BUSY` while an answer is still running. |
| Edit an exact image version | `versionId` on `/ai/images/edit`, or `options.editVersionId` on `/ai/images/generate` | The version must belong to that output (404 otherwise). The edit starts from that version's pixels and size. |
| Which version a message produced | Messages now include `versionIds` (aligned with `outputIds`) and `editedFromId` | Older messages have none. The UI falls back to message order. |
| All versions of a chat's outputs | `GET /outputs?conversationId=…&withVersions=true` | `withVersions` is honoured only together with `conversationId`. |
| The chat message | `POST /ai/assistant/message` `{ taskId, conversationId?, prompt, attachmentIds?, imageRefs?: [{ fileId } \| { outputId, versionId }], options?: { format, tone, presetId, width, height }, replacesMessageId? }` | 202 `{ generationId, conversation, userMessage }` when work was started; 200 `{ status: 'answered' \| 'clarify', assistantMessage }` for a question back or a limitation. If the router fails, the request fails (502) and nothing is stored. Messages carry `intent`. Edited image versions carry `image.changeCheck`, `editedFrom`, `sourceFileId` / `sourceVersionId` and `inputFidelity`. |
| Router model | `OPENAI_ROUTER_MODEL` (optional, defaults to `OPENAI_TEXT_MODEL`) | Must support vision and structured outputs. |

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
