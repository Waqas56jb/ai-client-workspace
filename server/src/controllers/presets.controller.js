import { created, handler, ok } from '../utils/response.js';
import * as service from '../services/presets.service.js';

/** GET /image-presets */
export const list = handler(async (req, res) => ok(res, await service.list(req.user.id, req.validatedQuery)));

/** GET /image-presets/:id */
export const get = handler(async (req, res) => ok(res, await service.get(req.user.id, req.params.id)));

/** POST /image-presets */
export const create = handler(async (req, res) => created(res, await service.create(req.user.id, req.body)));

/** PATCH /image-presets/:id */
export const update = handler(async (req, res) => ok(res, await service.update(req.user.id, req.params.id, req.body)));

/** POST /image-presets/:id/duplicate */
export const duplicate = handler(async (req, res) => created(res, await service.duplicate(req.user.id, req.params.id)));

/** POST /image-presets/:id/archive */
export const archive = handler(async (req, res) => ok(res, await service.setArchived(req.user.id, req.params.id, true)));

/** POST /image-presets/:id/restore */
export const restore = handler(async (req, res) => ok(res, await service.setArchived(req.user.id, req.params.id, false)));
