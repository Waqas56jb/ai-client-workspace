import { handler, ok } from '../utils/response.js';
import * as service from '../services/instructions.service.js';

/** GET /ai-instructions */
export const list = handler(async (req, res) => ok(res, await service.list(req.user.id)));

/** GET /ai-instructions/:toolType */
export const get = handler(async (req, res) => ok(res, await service.get(req.user.id, req.params.toolType)));

/** PATCH|PUT /ai-instructions/:toolType */
export const update = handler(async (req, res) => ok(res, await service.update(req.user.id, req.params.toolType, req.body), { message: 'Instructions saved.' }));

/** POST /ai-instructions/:toolType/reset */
export const reset = handler(async (req, res) => ok(res, await service.reset(req.user.id, req.params.toolType), { message: 'Instructions reset to defaults.' }));
