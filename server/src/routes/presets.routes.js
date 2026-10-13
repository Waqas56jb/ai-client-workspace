import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/presets.validators.js';
import * as ctrl from '../controllers/presets.controller.js';

const router = Router();
const byId = validate({ params: v.presetParams });

router.get('/image-presets', validate({ query: v.listPresetsQuery }), ctrl.list);
router.post('/image-presets', validate({ body: v.createPresetBody }), ctrl.create);
router.get('/image-presets/:id', byId, ctrl.get);
router.patch('/image-presets/:id', validate({ params: v.presetParams, body: v.updatePresetBody }), ctrl.update);
router.post('/image-presets/:id/duplicate', byId, ctrl.duplicate);
router.post('/image-presets/:id/archive', byId, ctrl.archive);
router.post('/image-presets/:id/restore', byId, ctrl.restore);

export default router;
