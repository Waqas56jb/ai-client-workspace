import { Router } from 'express';
import * as c from '../controllers/activity.controller.js';
import { validate } from '../middleware/validate.js';
import { listActivityQuery } from '../validators/activity.validators.js';

const router = Router();

router.get('/activity', validate({ query: listActivityQuery }), c.list);

export default router;
