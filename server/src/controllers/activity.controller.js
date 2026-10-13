import * as svc from '../services/activity.service.js';
import { handler, ok } from '../utils/response.js';

/** GET /activity */
export const list = handler(async (req, res) => ok(res, await svc.listActivity(req.user.id, req.validatedQuery)));
