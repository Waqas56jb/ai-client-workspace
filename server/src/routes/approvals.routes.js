import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as c from '../controllers/approvals.controller.js';
import { approveBody, idParams, versionParams } from '../validators/files.validators.js';
import { createApprovalBody, listApprovalsQuery, listApprovedQuery } from '../validators/approvals.validators.js';

/** Approvals & Approved Work (mounted at /api/v1, authenticated). */
const router = Router();

router.post('/outputs/:id/versions/:versionId/approve', validate({ params: versionParams, body: approveBody }), c.approveOutputVersion);
router.get('/outputs/:id/approvals', validate({ params: idParams }), c.outputHistory);
router.get('/approvals', validate({ query: listApprovalsQuery }), c.list);
router.post('/approvals', validate({ body: createApprovalBody }), c.create);
router.get('/approvals/:id', validate({ params: idParams }), c.get);
router.get('/approved', validate({ query: listApprovedQuery }), c.listApproved);

export default router;
