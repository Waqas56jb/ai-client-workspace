import * as svc from '../services/jobs.service.js';
import { created, handler, ok } from '../utils/response.js';

/** HTTP adapters for /jobs. */
export const list = handler(async (req, res) => {
  const { items, meta } = await svc.listJobs(req.user.id, req.validatedQuery);
  ok(res, items, { meta });
});
export const get = handler(async (req, res) => ok(res, await svc.getJob(req.user.id, req.params.jobId)));
export const create = handler(async (req, res) => created(res, await svc.createJob(req.user.id, req.body), { message: 'Job created.' }));
export const update = handler(async (req, res) => ok(res, await svc.updateJob(req.user.id, req.params.jobId, req.body), { message: 'Job updated.' }));
export const archive = handler(async (req, res) => ok(res, await svc.archiveJob(req.user.id, req.params.jobId), { message: 'Job archived.' }));
export const remove = handler(async (req, res) => ok(res, await svc.removeJob(req.user.id, req.params.jobId), { message: 'Job archived. Its tasks have been kept.' }));
export const tasks = handler(async (req, res) => {
  const { items, meta } = await svc.jobTasks(req.user.id, req.params.jobId, req.validatedQuery);
  ok(res, items, { meta });
});
export const files = handler(async (req, res) => {
  const { items, meta } = await svc.jobFiles(req.user.id, req.params.jobId, req.validatedQuery);
  ok(res, items, { meta });
});
export const activity = handler(async (req, res) => ok(res, await svc.jobActivity(req.user.id, req.params.jobId, req.validatedQuery)));
