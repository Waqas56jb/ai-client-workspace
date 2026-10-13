import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/instructions.validators.js';
import * as ctrl from '../controllers/instructions.controller.js';

const router = Router();
const save = validate({ params: v.toolParams, body: v.updateInstructionBody });

router.get('/ai-instructions', ctrl.list);
router.get('/ai-instructions/:toolType', validate({ params: v.toolParams }), ctrl.get);
router.patch('/ai-instructions/:toolType', save, ctrl.update);
// The existing frontend service calls PUT; same partial-update semantics.
router.put('/ai-instructions/:toolType', save, ctrl.update);
router.post('/ai-instructions/:toolType/reset', validate({ params: v.toolParams }), ctrl.reset);

export default router;
