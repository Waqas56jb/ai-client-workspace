import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as c from '../controllers/versions.controller.js';
import { idParams, versionParams } from '../validators/files.validators.js';
import { listOutputsQuery, renameOutputBody, restoreBody, revisionBody } from '../validators/versions.validators.js';

/** Outputs & immutable output versions (mounted at /api/v1, authenticated). */
const router = Router();

router.get('/outputs', validate({ query: listOutputsQuery }), c.list);
router.get('/outputs/:id', validate({ params: idParams }), c.get);
router.patch('/outputs/:id', validate({ params: idParams, body: renameOutputBody }), c.rename);
router.get('/outputs/:id/versions', validate({ params: idParams }), c.listVersions);
router.post('/outputs/:id/revisions', validate({ params: idParams, body: revisionBody }), c.createRevision);
router.get('/outputs/:id/versions/:versionId', validate({ params: versionParams }), c.getVersion);
router.post('/outputs/:id/versions/:versionId/restore', validate({ params: versionParams, body: restoreBody }), c.restore);
router.get('/outputs/:id/versions/:versionId/download', validate({ params: versionParams }), c.download);

export default router;
