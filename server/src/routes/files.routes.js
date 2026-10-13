import { Router } from 'express';
import { uploadSingle } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import * as c from '../controllers/files.controller.js';
import { approveBody, downloadQuery, idParams, listFilesQuery, updateFileBody, uploadBody, versionParams } from '../validators/files.validators.js';

/** Files & storage routes (mounted at /api/v1, authenticated). */
const router = Router();

router.get('/files', validate({ query: listFilesQuery }), c.list);
router.post('/files/upload', uploadSingle, validate({ body: uploadBody }), c.upload);
router.get('/files/:id', validate({ params: idParams }), c.get);
router.get('/files/:id/download', validate({ params: idParams, query: downloadQuery }), c.download);
router.get('/files/:id/preview', validate({ params: idParams }), c.preview);
router.patch('/files/:id', validate({ params: idParams, body: updateFileBody }), c.update);
router.post('/files/:id/archive', validate({ params: idParams }), c.archive);
router.get('/files/:id/versions', validate({ params: idParams }), c.versions);
router.post('/files/:id/versions/:versionId/approve', validate({ params: versionParams, body: approveBody }), c.approveVersion);

export default router;
