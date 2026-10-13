import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import health from './health.routes.js';
import auth from './auth.routes.js';
import users from './users.routes.js';
import clients from './clients.routes.js';
import jobs from './jobs.routes.js';
import tasks from './tasks.routes.js';
import conversations from './conversations.routes.js';
import ai from './ai.routes.js';
import files from './files.routes.js';
import versions from './versions.routes.js';
import approvals from './approvals.routes.js';
import presets from './presets.routes.js';
import instructions from './instructions.routes.js';
import search from './search.routes.js';
import activity from './activity.routes.js';
import dashboard from './dashboard.routes.js';
import settings from './settings.routes.js';

/**
 * /api/v1 router. Everything except /health requires an authenticated, active
 * workspace member. Each feature router declares its full paths (e.g. the
 * conversations router owns /tasks/:taskId/conversations and /conversations/*).
 */
const router = Router();

router.use('/health', health);
router.use(authenticate);
[auth, users, clients, jobs, tasks, conversations, ai, files, versions, approvals, presets, instructions, search, activity, dashboard, settings].forEach((r) =>
  router.use(r),
);

export default router;
