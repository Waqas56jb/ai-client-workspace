import { created, handler, ok } from '../utils/response.js';
import * as service from '../services/conversations.service.js';

/** GET /tasks/:taskId/conversations */
export const listForTask = handler(async (req, res) => ok(res, await service.listForTask(req.user.id, req.params.taskId, req.validatedQuery)));

/** POST /tasks/:taskId/conversations */
export const create = handler(async (req, res) => created(res, await service.create(req.user.id, req.params.taskId, req.body)));

/** GET /conversations/:id */
export const get = handler(async (req, res) => ok(res, await service.getWithMessages(req.user.id, req.params.id)));

/** PATCH /conversations/:id */
export const update = handler(async (req, res) => ok(res, await service.update(req.user.id, req.params.id, req.body)));

/** GET /conversations/:id/messages */
export const listMessages = handler(async (req, res) => {
  const { messages, meta } = await service.listMessages(req.user.id, req.params.id, req.validatedQuery);
  return ok(res, messages, { meta });
});

/** POST /conversations/:id/messages — plain user note, no AI generation. */
export const addMessage = handler(async (req, res) => created(res, await service.addNote(req.user.id, req.params.id, req.body)));

/** GET /conversations */
export const listAll = handler(async (req, res) => {
  const { items, meta } = await service.listAll(req.user.id, req.validatedQuery);
  return ok(res, items, { meta });
});

/** POST /assistant/session */
export const assistantSession = handler(async (req, res) => ok(res, await service.assistantSession(req.user, req.body.clientId)));
