import * as svc from '../services/tasks.service.js';
import { created, handler, ok } from '../utils/response.js';

/** HTTP adapters for /tasks. */
export const list = handler(async (req, res) => {
  const { items, meta } = await svc.listTasks(req.user.id, req.validatedQuery);
  ok(res, items, { meta });
});
export const get = handler(async (req, res) => ok(res, await svc.getTask(req.user.id, req.params.taskId)));
export const create = handler(async (req, res) => created(res, await svc.createTask(req.user.id, req.body), { message: 'Task created.' }));
export const update = handler(async (req, res) => ok(res, await svc.updateTask(req.user.id, req.params.taskId, req.body), { message: 'Task updated.' }));
export const archive = handler(async (req, res) => ok(res, await svc.archiveTask(req.user.id, req.params.taskId), { message: 'Task archived.' }));
export const remove = handler(async (req, res) => ok(res, await svc.removeTask(req.user.id, req.params.taskId), { message: 'Task archived.' }));
export const files = handler(async (req, res) => {
  const { items, meta } = await svc.taskFiles(req.user.id, req.params.taskId, req.validatedQuery);
  ok(res, items, { meta });
});
export const activity = handler(async (req, res) => ok(res, await svc.taskActivity(req.user.id, req.params.taskId, req.validatedQuery)));
