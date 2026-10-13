import * as svc from '../services/dashboard.service.js';
import { handler, ok } from '../utils/response.js';

/** HTTP adapters for /dashboard. */
export const summary = handler(async (req, res) => ok(res, await svc.summary(req.user.id)));
export const recentActivity = handler(async (req, res) => ok(res, await svc.recentActivity(req.user.id, req.validatedQuery)));
export const recentFiles = handler(async (req, res) => ok(res, await svc.recentFileList(req.user.id, req.validatedQuery)));
export const recentJobs = handler(async (req, res) => ok(res, await svc.recentJobList(req.user.id, req.validatedQuery)));
