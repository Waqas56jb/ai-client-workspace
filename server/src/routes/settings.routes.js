import { Router } from 'express';
import * as c from '../controllers/settings.controller.js';
import { validate } from '../middleware/validate.js';
import { updateWorkspaceSchema } from '../validators/settings.validators.js';

const router = Router();

router.get('/settings/workspace', c.getWorkspace);
router.patch('/settings/workspace', validate({ body: updateWorkspaceSchema }), c.updateWorkspace);
router.get('/settings/storage', c.storage);

export default router;
