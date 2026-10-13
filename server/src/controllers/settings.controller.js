import * as svc from '../services/settings.service.js';
import { handler, ok } from '../utils/response.js';

/** HTTP adapters for /settings. */
export const getWorkspace = handler(async (req, res) => ok(res, await svc.getWorkspace(req.user.id)));
export const updateWorkspace = handler(async (req, res) => ok(res, await svc.updateWorkspace(req.user.id, req.body), { message: 'Settings saved.' }));
export const storage = handler(async (req, res) => ok(res, await svc.storage(req.user.id)));
