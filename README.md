# StudioFlow AI — AI Client Workspace

A shared workspace for a three-person team to manage clients, jobs and tasks, and to create, revise and approve AI-generated client work: emails, SMS, WhatsApp messages, advertising copy, vehicle descriptions and images.

```
ai-client-workspace/
├── client/   React + Vite frontend (complete; runs in demo mode with no backend)
├── server/   Reserved for the future Node.js backend (see server/README.md)
└── README.md
```

## Quick start

```bash
cd client
npm install
cp .env.example .env     # optional — the defaults run demo mode
npm run dev              # http://localhost:5173
```

Sign in with any demo account (the password for all three is `studioflow`):

| Name | Email | Role |
| --- | --- | --- |
| Amelia Hart | amelia@studioflow.demo | Creative Director |
| Jordan Reyes | jordan@studioflow.demo | Senior Copywriter |
| Sam Okafor | sam@studioflow.demo | Designer & Production |

See [client/README.md](client/README.md) for the architecture, demo-mode limitations and the Vercel deployment steps.

## Current phase

- ✅ Frontend: every route, the four AI tool interfaces, revisions, approvals, search, presets, AI instructions, team and settings.
- ⏳ Backend (next phase): Node.js API on Railway, Supabase database and storage, real authentication, and real OpenAI generation.

> **Demo mode is not production.** Authentication, AI responses, file storage and persistence are all simulated in the browser until the backend is integrated.
