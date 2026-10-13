import { created, handler, ok } from '../utils/response.js';
import * as approvals from '../services/approvals.service.js';

/** POST /outputs/:id/versions/:versionId/approve → updated Output DTO */
export const approveOutputVersion = handler(async (req, res) =>
  ok(res, await approvals.approveOutputVersion(req.user, req.params.id, req.params.versionId, req.body.notes), { message: 'Version approved.' }),
);

/** GET /outputs/:id/approvals */
export const outputHistory = handler(async (req, res) => ok(res, await approvals.outputApprovalHistory(req.user, req.params.id)));

/** GET /approvals */
export const list = handler(async (req, res) => {
  const { data, meta } = await approvals.listApprovals(req.user, req.validatedQuery);
  return ok(res, data, { meta });
});

/** POST /approvals */
export const create = handler(async (req, res) => created(res, await approvals.createApproval(req.user, req.body), { message: 'Approved.' }));

/** GET /approvals/:id */
export const get = handler(async (req, res) => ok(res, await approvals.getApproval(req.user, req.params.id)));

/** GET /approved */
export const listApproved = handler(async (req, res) => {
  const { data, meta } = await approvals.listApproved(req.user, req.validatedQuery);
  return ok(res, data, { meta });
});
